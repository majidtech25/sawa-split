"""Payout pipeline shared by on-demand withdrawals, the 18:00 EAT sweep, and retries
(CLAUDE.md section 4 rules 9-11, section 6 steps 4-5).

Funds never leave 'available' until a B2C success callback marks them 'paid'
(app/routers/daraja.py), so a failed payout needs no ledger write to "return funds
to available" — rule 11's first clause holds by construction. What this module adds
is the retry policy: a first failure is retried once automatically; a failed retry
waits for a coordinator.

Only M-Pesa money is ever paid out (rule 12, migration 0010): a maker is paid their
available balance minus what they owe drivers from cash sales, and _initiate refuses,
loudly, any B2C call that would send out more than M-Pesa has collected.
"""

import logging
import uuid
from datetime import datetime
from decimal import Decimal
from zoneinfo import ZoneInfo

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from . import daraja, sales
from .ledger import (
    available_balance, blocking_withdrawal, fund_held, lock_money, outstanding_debt, payable_balance, settle_debts,
)
from .config import settings
from .db import async_session

log = logging.getLogger("sawa.payouts")

MIN_WITHDRAWAL_AMOUNT = Decimal("500")  # CLAUDE.md rule 9
EAT = ZoneInfo("Africa/Nairobi")


class PayoutRefused(Exception):
    """The recipient can't be paid out right now; the message says why."""


# B2C callback ResultCodes that mean the initiator can't pay anyone (8006: credential
# locked; 2001: initiator information invalid). Retrying would only extend the lock.
PAUSE_RESULT_CODES = {"8006", "2001"}


async def active_pause(session: AsyncSession):
    return (
        await session.execute(text("select id, result_code, reason, paused_at from payout_pauses where resumed_at is null"))
    ).one_or_none()


async def pause_payouts(session: AsyncSession, result_code: str, reason: str) -> None:
    """Stops every payout until a coordinator resumes them (migration 0015). Commits."""
    await session.execute(
        text(
            "insert into payout_pauses (result_code, reason) select :code, :reason "
            "where not exists (select 1 from payout_pauses where resumed_at is null)"
        ),
        {"code": str(result_code), "reason": reason or ""},
    )
    await session.commit()
    log.critical("PAYOUTS PAUSED: B2C ResultCode %s (%s). Fix the credential, then resume payouts.", result_code, reason)


async def resume_payouts(session: AsyncSession, resumed_by=None) -> bool:
    ended = (
        await session.execute(
            text("update payout_pauses set resumed_at = now(), resumed_by = :by where resumed_at is null returning id"),
            {"by": resumed_by},
        )
    ).one_or_none()
    await session.commit()
    return ended is not None


class PayoutCapExceeded(RuntimeError):
    """A B2C payout would send more than the M-Pesa money behind it. Never expected:
    raised (and logged as critical) instead of paying, so a ledger bug can't turn into
    paying one person with money owed to others."""


async def start_payout(session: AsyncSession, recipient_type: str, recipient_id, *, minimum=MIN_WITHDRAWAL_AMOUNT):
    """A first payout attempt: the full payable balance (rule 9), >= KES 500, via
    B2C. `minimum` is lowered only for a closing account's final payout. Raises
    PayoutRefused if the recipient can't be paid now. If B2C initiation itself
    fails, the one automatic retry (rule 11) runs here, straight away; a failure the
    B2C callback reports later gets its retry from the callback instead. Returns the
    latest attempt's row."""
    if recipient_type not in ("maker", "driver"):
        # The Conservation fund is ring-fenced: never paid out by B2C (migration 0020).
        raise PayoutRefused("Only a creator or a site intermediary can be paid out.")
    if recipient_type == "maker":
        # Drivers are owed first: settle what the maker can cover, and keep it even
        # if this payout is then refused.
        await settle_debts(session, recipient_id)
        await session.commit()

    await lock_money(session)
    blocking = await blocking_withdrawal(session, recipient_type, recipient_id)
    if blocking is not None:
        if blocking.status == "failed":
            raise PayoutRefused("A previous payout failed and is waiting for the coordinator to retry it.")
        raise PayoutRefused("A withdrawal is already in progress.")

    balance = await payable_balance(session, recipient_type, recipient_id)
    owed = await outstanding_debt(session, recipient_id) if recipient_type == "maker" else Decimal(0)
    if balance <= 0 or balance < minimum:
        creditors = "site intermediaries"
        if owed:
            kinds = set(
                (
                    await session.execute(
                        text("select distinct creditor_type from cash_debts where producer_id = :pid and status = 'outstanding'"),
                        {"pid": recipient_id},
                    )
                ).scalars()
            )
            if kinds == {"fund"}:
                creditors = "the Conservation fund"
            elif "fund" in kinds:
                creditors = "site intermediaries and the Conservation fund"
        reason = (
            f"Payable balance (KES {balance}) is below the KES {minimum} withdrawal threshold."
            if balance > 0 or not owed
            else f"KES {owed} from cash sales is still owed to {creditors}, and is paid from your M-Pesa earnings first."
        )
        raise PayoutRefused(reason)
    row, initiated = await _initiate(session, recipient_type, recipient_id, balance)
    if not initiated:
        try:
            row = await retry_payout(session, row.id, automatic=True) or row
        except PayoutRefused as exc:
            log.warning("Automatic retry of withdrawal %s refused: %s", row.id, exc)
    return row


async def retry_payout(session: AsyncSession, failed_id, *, automatic: bool):
    """Retries a failed withdrawal for the same amount. Automatic retries (rule 11)
    apply only to a first attempt; a coordinator's manual retry applies to any failed
    withdrawal. The retry claims the failed row ('failed' -> 'retried') in the same
    transaction that creates the retry, so two callers racing to retry one failure
    (a fast callback and the code that started the payout, or a redelivered
    callback) can't both succeed: the loser gets None. Raises PayoutRefused if the
    funds are no longer available (e.g. frozen by a dispute)."""
    await lock_money(session)
    failed = await _withdrawal(session, failed_id)
    if failed.status != "failed" or (automatic and failed.retry_of is not None):
        return None
    balance = await available_balance(session, failed.recipient_type, failed.recipient_id)
    if balance < failed.amount:
        raise PayoutRefused(
            f"Only KES {balance} is available now, less than the KES {failed.amount} this payout was for."
        )
    row, _initiated = await _initiate(
        session, failed.recipient_type, failed.recipient_id, failed.amount, retry_of=failed.id
    )
    if row is None:
        return None  # another caller retried it first
    log.info("Withdrawal %s retried (%s) as %s: %s", failed.id, "automatic" if automatic else "manual", row.id, row.status)
    return row


async def _initiate(session: AsyncSession, recipient_type: str, recipient_id, amount: Decimal, *, retry_of=None):
    """Creates the withdrawal row and fires B2C. Returns (row, initiated): initiated
    is False when B2C initiation itself failed (the row is then 'failed'). For a
    retry, returns (None, False) if the failed withdrawal was already claimed."""
    # Everything that can fail before Daraja is called happens before the withdrawal
    # row is committed: a row committed as 'requested' that never reaches B2C would
    # count as in flight and block this recipient indefinitely.
    pause = await active_pause(session)
    if pause is not None:
        await session.rollback()
        raise PayoutRefused(
            f"Payouts are paused: M-Pesa refused the payout credential (ResultCode {pause.result_code}). "
            "Your balance is safe; the coordinator will resume payouts."
        )
    await _check_mpesa_cover(session, recipient_type, recipient_id, amount)
    phone_row = (
        await session.execute(
            text(f"select phone from {'producers' if recipient_type == 'maker' else 'drivers'} where id = :id"),
            {"id": recipient_id},
        )
    ).one()

    if retry_of is not None:
        claimed = (
            await session.execute(
                text("update withdrawal_requests set status = 'retried' where id = :id and status = 'failed' returning id"),
                {"id": retry_of},
            )
        ).one_or_none()
        if claimed is None:
            await session.rollback()
            return None, False

    idempotency_key = uuid.uuid4()
    row = (
        await session.execute(
            text(
                """
                insert into withdrawal_requests (recipient_type, recipient_id, amount, status, retry_of)
                values (:rtype, :rid, :amount, 'requested', :retry_of)
                returning id
                """
            ),
            {"rtype": recipient_type, "rid": recipient_id, "amount": amount, "retry_of": retry_of},
        )
    ).one()
    # The key Daraja echoes back lives where no browser can read it (migration 0016).
    await session.execute(
        text("insert into withdrawal_secrets (withdrawal_id, idempotency_key) values (:id, :key)"),
        {"id": row.id, "key": idempotency_key},
    )
    await session.commit()

    try:
        b2c_response = await daraja.b2c_payment(
            phone=phone_row.phone,
            amount=amount,
            remarks="Sawa Split payout",
            occasion="Payout",
            result_url=f"{settings.daraja_callback_base_url}/daraja/b2c-callback",
            timeout_url=f"{settings.daraja_callback_base_url}/daraja/b2c-timeout",
            originator_conversation_id=str(idempotency_key),
        )
        if str(b2c_response.get("ResponseCode")) != "0":
            raise RuntimeError(b2c_response.get("ResponseDescription", "B2C request rejected"))
    except Exception as exc:
        log.warning("B2C initiation failed for withdrawal %s: %s", row.id, exc)
        await session.execute(
            text("update withdrawal_requests set status = 'failed', resolved_at = now() where id = :id"),
            {"id": row.id},
        )
        await session.commit()
        return await _withdrawal(session, row.id), False

    # Only 'requested' moves to 'processing': a fast callback may already have
    # resolved the row by the time Daraja's acceptance comes back here.
    await session.execute(
        text("update withdrawal_requests set status = 'processing' where id = :id and status = 'requested'"),
        {"id": row.id},
    )
    await session.commit()
    return await _withdrawal(session, row.id), True


async def _check_mpesa_cover(session: AsyncSession, recipient_type: str, recipient_id, amount: Decimal) -> None:
    """The last line of defence before B2C: everything sent or being sent, plus this
    payout, must fit within the M-Pesa money collected less the Conservation fund's
    (ring-fenced, migration 0020), and this payout within the recipient's own available
    entries. Runs under the money lock."""
    if recipient_type not in ("maker", "driver"):
        await session.rollback()
        log.critical("REFUSED B2C payout of KES %s to %s %s: not a creator or site intermediary", amount, recipient_type, recipient_id)
        raise PayoutCapExceeded(f"Refused a KES {amount} payout to {recipient_type}: only creators and site intermediaries are paid out.")
    t = (
        await session.execute(
            text(
                """
                select
                  (select coalesce(sum(total_amount), 0) from transactions
                     where payment_method = 'mpesa' and status in ('confirmed', 'disputed')) as collected,
                  (select coalesce(sum(amount), 0) from withdrawal_requests
                     where status in ('requested', 'processing', 'paid')) as committed
                """
            )
        )
    ).one()
    own = await available_balance(session, recipient_type, recipient_id)
    fund = await fund_held(session)
    problem = None
    if t.committed + amount > t.collected - fund:
        problem = (
            f"M-Pesa collected KES {t.collected}, of which KES {fund} is the Conservation fund's, "
            f"already paid or paying KES {t.committed}"
        )
    elif amount > own:
        problem = f"the recipient's available M-Pesa-sourced balance is only KES {own}"
    if problem:
        await session.rollback()
        log.critical("REFUSED B2C payout of KES %s to %s %s: %s", amount, recipient_type, recipient_id, problem)
        raise PayoutCapExceeded(f"Refused a KES {amount} payout: {problem}. Nothing was sent; check the ledger.")


async def _withdrawal(session: AsyncSession, withdrawal_id):
    return (
        await session.execute(text("select * from withdrawal_requests where id = :id"), {"id": withdrawal_id})
    ).one()


async def retry_after_callback_failure(withdrawal_id) -> None:
    """Rule 11's automatic retry for a failure the B2C callback reported. Runs after
    the callback has been acknowledged (FastAPI background task)."""
    async with async_session() as session:
        try:
            await retry_payout(session, withdrawal_id, automatic=True)
        except PayoutRefused as exc:
            log.warning("Automatic retry of withdrawal %s refused: %s", withdrawal_id, exc)


async def sweep_candidates(session: AsyncSession):
    """Who the sweep tries to pay: creators and site intermediaries with >= KES 500
    available. Never the Conservation fund, which is ring-fenced (migration 0020)."""
    return (
        await session.execute(
            text(
                """
                select recipient_type, recipient_id, sum(amount) as balance
                from wallet_ledger_entries
                where status = 'available' and recipient_type in ('maker', 'driver')
                group by recipient_type, recipient_id
                having sum(amount) >= :min
                """
            ),
            {"min": MIN_WITHDRAWAL_AMOUNT},
        )
    ).all()


async def run_daily_sweep() -> list[dict]:
    """Rule 10: at 18:00 EAT, pay out everyone with >= KES 500 available who hasn't
    already withdrawn today (EAT). Frozen entries never count — they aren't
    'available'. A recipient with a payout in flight or awaiting a coordinator's
    retry is skipped, so the sweep never becomes a second automatic retry."""
    today_eat = datetime.now(EAT).date()
    results = []
    async with async_session() as session:
        # Rule 12: settle every maker -> driver cash debt that M-Pesa earnings now
        # cover, so drivers are paid in this same sweep.
        debtors = (
            await session.execute(text("select distinct producer_id from cash_debts where status = 'outstanding'"))
        ).scalars().all()
        for producer_id in debtors:
            await settle_debts(session, producer_id)
            await session.commit()

        for c in await sweep_candidates(session):
            withdrew_today = (
                await session.execute(
                    text(
                        "select 1 from withdrawal_requests where recipient_type = :rtype and recipient_id = :rid "
                        "and (requested_at at time zone 'Africa/Nairobi')::date = :today limit 1"
                    ),
                    {"rtype": c.recipient_type, "rid": c.recipient_id, "today": today_eat},
                )
            ).one_or_none()
            if withdrew_today is not None:
                results.append({"recipient_type": c.recipient_type, "recipient_id": str(c.recipient_id), "skipped": "withdrew today"})
                continue
            try:
                w = await start_payout(session, c.recipient_type, c.recipient_id)
            except PayoutRefused as exc:
                await session.rollback()  # releases the money lock
                results.append({"recipient_type": c.recipient_type, "recipient_id": str(c.recipient_id), "skipped": str(exc)})
                continue
            except Exception as exc:  # one recipient's error mustn't stop everyone else's payout
                log.exception("Sweep payout for %s %s failed", c.recipient_type, c.recipient_id)
                await session.rollback()
                results.append({"recipient_type": c.recipient_type, "recipient_id": str(c.recipient_id), "error": str(exc)})
                continue
            results.append(
                {"recipient_type": c.recipient_type, "recipient_id": str(c.recipient_id), "withdrawal_id": str(w.id),
                 "amount": str(w.amount), "status": w.status}
            )
    log.info("Daily sweep: %s", results)
    return results


async def expire_unconfirmed_cash() -> int:
    """Rule 12: a cash_unconfirmed transaction past its deadline becomes cash_expired.
    POST /transactions/:id/confirm already expires on read; this keeps the ledger and
    reconciliation view accurate for transactions nobody touches again."""
    async with async_session() as session:
        expired = (
            await session.execute(
                text(
                    "update transactions set status = 'cash_expired' "
                    "where status = 'cash_unconfirmed' and confirmation_deadline <= now() returning id"
                )
            )
        ).scalars().all()
        for transaction_id in expired:
            await sales.payment_finished(session, transaction_id, paid=False)  # release its open sale
        await session.commit()
        return len(expired)
