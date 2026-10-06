"""Payout pipeline shared by on-demand withdrawals, the 18:00 EAT sweep, and retries
(CLAUDE.md section 4 rules 9-11, section 6 steps 4-5).

Funds never leave 'available' until a B2C success callback marks them 'paid'
(app/routers/daraja.py), so a failed payout needs no ledger write to "return funds
to available" — rule 11's first clause holds by construction. What this module adds
is the retry policy: a first failure is retried once automatically; a failed retry
waits for a coordinator.
"""

import logging
import uuid
from datetime import datetime
from decimal import Decimal
from zoneinfo import ZoneInfo

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from . import daraja
from .config import settings
from .db import async_session

log = logging.getLogger("sawa.payouts")

MIN_WITHDRAWAL_AMOUNT = Decimal("500")  # CLAUDE.md rule 9
EAT = ZoneInfo("Africa/Nairobi")


class PayoutRefused(Exception):
    """The recipient can't be paid out right now; the message says why."""


async def available_balance(session: AsyncSession, recipient_type: str, recipient_id) -> Decimal:
    row = (
        await session.execute(
            text(
                "select coalesce(sum(amount), 0) as total from wallet_ledger_entries "
                "where recipient_type = :rtype and recipient_id = :rid and status = 'available'"
            ),
            {"rtype": recipient_type, "rid": recipient_id},
        )
    ).one()
    return row.total


async def _blocking_withdrawal(session: AsyncSession, recipient_type: str, recipient_id):
    """A withdrawal that must resolve before another starts: one still in flight, or
    a failed retry (retry_of set) that now waits for a coordinator. A failed first
    attempt doesn't block — it gets its automatic retry straight away, and if that
    never happened (refused, or the process restarted first) a later on-demand
    withdrawal or sweep is the next attempt."""
    return (
        await session.execute(
            text(
                "select id, status from withdrawal_requests where recipient_type = :rtype and recipient_id = :rid "
                "and (status in ('requested', 'processing') or (status = 'failed' and retry_of is not null)) limit 1"
            ),
            {"rtype": recipient_type, "rid": recipient_id},
        )
    ).one_or_none()


async def start_payout(session: AsyncSession, recipient_type: str, recipient_id):
    """A first payout attempt: the full available balance (rule 9), >= KES 500, via
    B2C. Raises PayoutRefused if the recipient can't be paid now. If B2C initiation
    itself fails, the one automatic retry (rule 11) runs here, straight away; a
    failure the B2C callback reports later gets its retry from the callback instead.
    Returns the latest attempt's row."""
    blocking = await _blocking_withdrawal(session, recipient_type, recipient_id)
    if blocking is not None:
        if blocking.status == "failed":
            raise PayoutRefused("A previous payout failed and is waiting for the coordinator to retry it.")
        raise PayoutRefused("A withdrawal is already in progress.")

    balance = await available_balance(session, recipient_type, recipient_id)
    if balance < MIN_WITHDRAWAL_AMOUNT:
        raise PayoutRefused(
            f"Available balance (KES {balance}) is below the KES {MIN_WITHDRAWAL_AMOUNT} withdrawal threshold."
        )
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
                insert into withdrawal_requests (recipient_type, recipient_id, amount, idempotency_key, status, retry_of)
                values (:rtype, :rid, :amount, :key, 'requested', :retry_of)
                returning id
                """
            ),
            {"rtype": recipient_type, "rid": recipient_id, "amount": amount, "key": idempotency_key, "retry_of": retry_of},
        )
    ).one()
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


async def run_daily_sweep() -> list[dict]:
    """Rule 10: at 18:00 EAT, pay out everyone with >= KES 500 available who hasn't
    already withdrawn today (EAT). Frozen entries never count — they aren't
    'available'. A recipient with a payout in flight or awaiting a coordinator's
    retry is skipped, so the sweep never becomes a second automatic retry."""
    today_eat = datetime.now(EAT).date()
    results = []
    async with async_session() as session:
        candidates = (
            await session.execute(
                text(
                    """
                    select recipient_type, recipient_id, sum(amount) as balance
                    from wallet_ledger_entries
                    where status = 'available'
                    group by recipient_type, recipient_id
                    having sum(amount) >= :min
                    """
                ),
                {"min": MIN_WITHDRAWAL_AMOUNT},
            )
        ).all()

        for c in candidates:
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
        result = await session.execute(
            text(
                "update transactions set status = 'cash_expired' "
                "where status = 'cash_unconfirmed' and confirmation_deadline <= now()"
            )
        )
        await session.commit()
        return result.rowcount
