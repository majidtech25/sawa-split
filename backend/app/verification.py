"""STK callbacks and STK Push Query verification (CLAUDE.md section 6 step 2).

A successful STK callback has to clear three checks before anything is credited:
  1. its URL carries this transaction's signed token (app/links.py), so a POST to the
     public callback endpoint can't pose as Daraja;
  2. its Amount is exactly what the STK Push asked the tourist to pay;
  3. Safaricom itself confirms the payment when asked (STK Push Query). How that
     check gates the money depends on STK_QUERY_MODE:
       flag    - credit at once, query in the background with retries, and flag a
                 mismatch or a query that never answers to the coordinator;
       enforce - mark the sale 'verifying' (shown as "Payment being verified") and
                 credit nobody until Safaricom confirms. If it never answers, the sale
                 stays verifying, flagged to the coordinator, who can check again.
     Production must use enforce. flag exists for the sandbox, whose query is
     unreliable, and for the demo.

"Still being processed" (ResultCode 4999, or a message saying so) is never a verdict,
in either mode: it's asked again later.

A payment with no final result (migration 0019): an M-Pesa sale still 'initiated' (no
callback came) or 'verifying' (enforce: Safaricom hasn't confirmed) 10 minutes after it
started is marked 'unresolved'. Its open sale is released so the maker can carry on,
the coordinator sees it under Payment checks, and Safaricom is asked again every 15
minutes for 48 hours (after that, only the coordinator's "Check again"). A later "paid"
credits it as normal ('paid_late', still shown, since the tourist may have paid that
sale again); a later "not paid" closes it as failed ('failed_late').
"""

import json
import logging
from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
from typing import Any, Awaitable, Callable

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from . import daraja, links, sales
from .config import settings
from .db import async_session
from .ledger import settle_debts, write_ledger_entries

log = logging.getLogger("sawa.verification")

ACK = {"ResultCode": 0, "ResultDesc": "Accepted"}
REJECTED = {"ResultCode": 1, "ResultDesc": "Rejected"}

FIRST_CHECK_SECONDS = 15
# Seconds before each retry while Safaricom has no answer yet; after the last, the
# check is 'unanswered' (about 19 minutes in all).
RETRY_DELAYS = [30, 60, 120, 300, 600]

UNRESOLVED_AFTER_MINUTES = 10
UNRESOLVED_RECHECK_SECONDS = 15 * 60
UNRESOLVED_QUERY_HOURS = 48
# Safaricom's "the payment hasn't finished yet", which isn't a "no".
STILL_PROCESSING_CODES = {"4999"}

Query = Callable[[str], Awaitable[dict[str, Any]]]


def classify(answer: dict[str, Any]) -> tuple[str, str]:
    """Reads an STK Push Query answer as ('paid' | 'not_paid' | 'unknown', description).
    'not_paid' is Safaricom definitely saying no: a final non-zero ResultCode (cancelled,
    timed out, insufficient funds...) or no such transaction. Anything else, including
    "still being processed" (4999) and network errors, is 'unknown' and asked again."""
    if "ResultCode" in answer:
        code = str(answer["ResultCode"])
        result = str(answer.get("ResultDesc", ""))
        description = f"{code}: {result}".strip()
        if code == "0":
            return "paid", description
        if code in STILL_PROCESSING_CODES or "processing" in result.lower():
            return "unknown", description
        return "not_paid", description
    message = str(answer.get("errorMessage") or answer.get("errorCode") or "no answer")
    if "does not exist" in message.lower():
        return "not_paid", message
    return "unknown", message


async def _credit(session: AsyncSession, transaction_id, from_status: str) -> bool:
    """Confirms the sale and writes its ledger split, then settles any cash debts the
    new balance covers (rule 12). Commits. False if it was already handled."""
    updated = (
        await session.execute(
            text("update transactions set status = 'confirmed' where id = :id and status = :from returning *"),
            {"id": transaction_id, "from": from_status},
        )
    ).one_or_none()
    if updated is None:
        await session.commit()
        return False
    await sales.payment_finished(session, updated.id, paid=True)
    await sales.paid_late(session, updated.id)  # a sale released while this payment was unresolved
    await write_ledger_entries(
        session,
        transaction_id=updated.id,
        producer_id=updated.producer_id,
        driver_id=updated.driver_id,
        maker_amount=updated.maker_amount,
        driver_amount=updated.driver_amount,
    )
    await session.commit()
    await settle_debts(session, updated.producer_id)
    await session.commit()
    return True


async def _record(session: AsyncSession, transaction_id, *, mode: str, state: str, callback_amount, first_check: bool):
    await session.execute(
        text(
            f"""
            insert into stk_verifications (transaction_id, mode, state, callback_amount, next_check_at)
            values (:id, :mode, :state, :amount, now() + make_interval(secs => :delay))
            on conflict (transaction_id) do update
              set state = excluded.state, callback_amount = excluded.callback_amount, updated_at = now()
            """
        ),
        {"id": transaction_id, "mode": mode, "state": state, "amount": callback_amount,
         "delay": FIRST_CHECK_SECONDS if first_check else 0},
    )


async def handle_stk_callback(
    session: AsyncSession, token: str, payload: dict[str, Any], *, mode: str | None = None
) -> tuple[int, dict]:
    """Returns (HTTP status, body) for Daraja. A redelivered callback is a no-op
    (rule 7): only an 'initiated' sale is ever moved on."""
    mode = mode or settings.stk_query_mode
    stk = payload.get("Body", {}).get("stkCallback", {})
    checkout_request_id = stk.get("CheckoutRequestID")
    log.info("STK callback for %s: ResultCode %s, %s", checkout_request_id, stk.get("ResultCode"), stk.get("ResultDesc"))
    txn = (
        await session.execute(
            text(
                "select t.* from transactions t join transaction_secrets s on s.transaction_id = t.id "
                "where s.checkout_request_id = :crid"
            ),
            {"crid": checkout_request_id},
        )
    ).one_or_none()
    # Unknown sale and wrong token get the same answer, so a forger learns nothing.
    if txn is None or not links.callback_token_valid(token, txn.id):
        log.warning("Refused an STK callback without a valid token (CheckoutRequestID %s)", checkout_request_id)
        return 403, REJECTED
    if txn.status != "initiated":
        return 200, ACK

    if str(stk.get("ResultCode")) != "0":
        # Rule 6: failed/timed-out STK — no ledger entry, no auto-retry.
        await session.execute(
            text("update transactions set status = 'failed' where id = :id and status = 'initiated'"), {"id": txn.id}
        )
        await sales.payment_finished(session, txn.id, paid=False)  # the open sale can be paid again
        await session.commit()
        return 200, ACK

    items = {i.get("Name"): i.get("Value") for i in stk.get("CallbackMetadata", {}).get("Item", [])}
    try:
        amount = Decimal(str(items.get("Amount")))
    except (InvalidOperation, ValueError):
        amount = None
    # The STK Push asked for the whole-shilling total (app/daraja.py), so that's what
    # a genuine callback reports.
    if amount is None or amount != Decimal(int(txn.total_amount)):
        log.warning("Refused an STK callback for %s: Amount %s, expected %s", txn.id, items.get("Amount"), int(txn.total_amount))
        await _record(session, txn.id, mode=mode, state="amount_mismatch", callback_amount=amount, first_check=False)
        await session.commit()
        return 400, REJECTED

    receipt = items.get("MpesaReceiptNumber")
    if mode == "enforce":
        moved = (
            await session.execute(
                text(
                    "update transactions set status = 'verifying', stk_receipt = :receipt "
                    "where id = :id and status = 'initiated' returning id"
                ),
                {"receipt": receipt, "id": txn.id},
            )
        ).one_or_none()
        if moved is not None:
            await _record(session, txn.id, mode=mode, state="pending", callback_amount=amount, first_check=True)
        await session.commit()
        return 200, ACK

    moved = (
        await session.execute(
            text("update transactions set stk_receipt = :receipt where id = :id and status = 'initiated' returning id"),
            {"receipt": receipt, "id": txn.id},
        )
    ).one_or_none()
    if moved is None:
        await session.commit()
        return 200, ACK
    await _record(session, txn.id, mode=mode, state="pending", callback_amount=amount, first_check=True)
    await _credit(session, txn.id, "initiated")
    return 200, ACK


async def check_payment(session: AsyncSession, transaction_id, *, query: Query | None = None, force: bool = False) -> str:
    """Asks Safaricom about one sale and acts on the answer. Returns the check's state.
    The scheduler checks pending ones when due; a coordinator can force a check of an
    unanswered or mismatched one. Commits."""
    query = query or daraja.stk_query
    row = (
        await session.execute(
            text(
                """
                select v.*, t.status as txn_status, t.created_at as txn_created_at, s.checkout_request_id
                from stk_verifications v
                join transactions t on t.id = v.transaction_id
                join transaction_secrets s on s.transaction_id = v.transaction_id
                where v.transaction_id = :id
                for update of v skip locked
                """
            ),
            {"id": transaction_id},
        )
    ).one_or_none()
    if row is None:
        await session.rollback()
        return "busy"
    if row.state in ("verified", "amount_mismatch", "paid_late", "failed_late") or (
        row.state not in ("pending", "unresolved") and not force
    ):
        await session.rollback()
        return row.state
    if row.state == "unresolved":
        return await _check_unresolved(session, row, query)

    try:
        answer = await query(row.checkout_request_id)
    except Exception as exc:  # network trouble is "no answer yet", never a verdict
        answer = {"errorMessage": f"no answer: {exc}"}
    outcome, description = classify(answer)
    log.info("STK Push Query for %s: %s (%s)", transaction_id, outcome, description)
    attempts = row.attempts + 1
    next_delay = 0

    if outcome == "paid":
        state = "verified"
    elif outcome == "not_paid":
        state = "mismatch"
        log.warning("STK Push Query contradicts the callback for %s: %s", transaction_id, description)
    elif row.state == "pending" and attempts <= len(RETRY_DELAYS):
        state, next_delay = "pending", RETRY_DELAYS[attempts - 1]
    else:
        state = "unanswered" if row.state == "pending" else row.state

    await session.execute(
        text(
            """
            update stk_verifications
            set state = :state, attempts = :attempts, last_result = cast(:result as jsonb),
                next_check_at = now() + make_interval(secs => :delay), updated_at = now()
            where transaction_id = :id
            """
        ),
        {"state": state, "attempts": attempts, "delay": next_delay, "id": transaction_id,
         "result": json.dumps({"outcome": outcome, "description": description, "answer": answer}, default=str)},
    )
    if row.txn_status == "verifying" and state == "mismatch":
        # Enforce mode: Safaricom says it wasn't paid, so nobody is credited.
        await session.execute(
            text("update transactions set status = 'failed' where id = :id and status = 'verifying'"), {"id": transaction_id}
        )
        await sales.payment_finished(session, transaction_id, paid=False)
    await session.commit()
    if row.txn_status == "verifying" and state == "verified":
        await _credit(session, transaction_id, "verifying")
    return state


async def _check_unresolved(session: AsyncSession, row, query: Query) -> str:
    """One query for a payment with no final result (row locked by check_payment).
    Paid: credited as normal, 'paid_late'. Not paid: closed as failed, 'failed_late'.
    Unknown: asked again in 15 minutes, until 48 hours after the sale. Commits."""
    if row.txn_status not in ("initiated", "verifying"):
        # A late callback already settled it: record which way, without asking again.
        state = "failed_late" if row.txn_status == "failed" else "paid_late"
        await session.execute(
            text("update stk_verifications set state = :state, updated_at = now() where transaction_id = :id"),
            {"state": state, "id": row.transaction_id},
        )
        await session.commit()
        return state
    try:
        answer = await query(row.checkout_request_id)
    except Exception as exc:  # network trouble is "no answer yet", never a verdict
        answer = {"errorMessage": f"no answer: {exc}"}
    outcome, description = classify(answer)
    log.info("STK Push Query for unresolved %s: %s (%s)", row.transaction_id, outcome, description)
    state = {"paid": "paid_late", "not_paid": "failed_late"}.get(outcome, "unresolved")
    if state == "unresolved":
        give_up = row.txn_created_at + timedelta(hours=UNRESOLVED_QUERY_HOURS) <= datetime.now(timezone.utc)
        next_check = "infinity" if give_up else (datetime.now(timezone.utc) + timedelta(seconds=UNRESOLVED_RECHECK_SECONDS)).isoformat()
    else:
        next_check = datetime.now(timezone.utc).isoformat()
    await session.execute(
        text(
            """
            update stk_verifications
            set state = :state, attempts = attempts + 1, last_result = cast(:result as jsonb),
                next_check_at = cast(:next as timestamptz), updated_at = now()
            where transaction_id = :id
            """
        ),
        {"state": state, "next": next_check, "id": row.transaction_id,
         "result": json.dumps({"outcome": outcome, "description": description, "answer": answer}, default=str)},
    )
    if state == "failed_late":
        await session.execute(
            text("update transactions set status = 'failed' where id = :id and status in ('initiated', 'verifying')"),
            {"id": row.transaction_id},
        )
        await sales.payment_finished(session, row.transaction_id, paid=False)  # no-op once released
    await session.commit()
    if state == "paid_late":
        await _credit(session, row.transaction_id, row.txn_status)  # split, ledger, and the sale paid
    return state


async def mark_unresolved() -> int:
    """Scheduler job: M-Pesa payments with no final result 10 minutes after they started
    become 'unresolved', and their held open sales are released. Returns how many."""
    async with async_session() as session:
        rows = (
            await session.execute(
                text(
                    f"""
                    select t.id, t.status
                    from transactions t
                    left join stk_verifications v on v.transaction_id = t.id
                    where t.payment_method = 'mpesa'
                      and t.created_at <= now() - interval '{UNRESOLVED_AFTER_MINUTES} minutes'
                      and ((t.status = 'initiated' and v.transaction_id is null)
                           or (t.status = 'verifying' and v.state in ('pending', 'unanswered')))
                    order by t.created_at
                    limit 50
                    """
                )
            )
        ).all()
        for r in rows:
            await session.execute(
                text(
                    """
                    insert into stk_verifications (transaction_id, mode, state, next_check_at)
                    values (:id, :mode, 'unresolved', now())
                    on conflict (transaction_id) do update
                      set state = 'unresolved', next_check_at = now(), updated_at = now()
                      where stk_verifications.state in ('pending', 'unanswered')
                    """
                ),
                {"id": r.id, "mode": settings.stk_query_mode},
            )
            await sales.payment_finished(session, r.id, paid=False)  # the maker can carry on
            log.warning("M-Pesa payment %s (%s) has no final result after %s minutes: unresolved, sale released",
                        r.id, r.status, UNRESOLVED_AFTER_MINUTES)
        await session.commit()
        return len(rows)


async def run_due_checks() -> int:
    """Scheduler job: checks every pending or unresolved verification that's due."""
    async with async_session() as session:
        due = (
            await session.execute(
                text(
                    "select transaction_id from stk_verifications where state in ('pending', 'unresolved') "
                    "and next_check_at <= now() order by next_check_at limit 20"
                )
            )
        ).scalars().all()
        await session.commit()
        for transaction_id in due:
            try:
                await check_payment(session, transaction_id)
            except Exception:
                log.exception("STK Push Query check failed for %s", transaction_id)
                await session.rollback()
        return len(due)
