from typing import Annotated, Any

from fastapi import APIRouter, BackgroundTasks, Depends
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from .. import payouts
from ..db import get_session
from ..ledger import write_ledger_entries

router = APIRouter(prefix="/daraja", tags=["daraja"], include_in_schema=False)

ACK = {"ResultCode": 0, "ResultDesc": "Accepted"}


@router.post("/stk-callback")
async def stk_callback(payload: dict[str, Any], session: Annotated[AsyncSession, Depends(get_session)]) -> dict:
    """Real Daraja STK callback (CLAUDE.md section 6 step 2), replacing stage 4's
    coordinator-triggered fake-confirm. Always acks 200 so Daraja doesn't retry
    forever — our own idempotency guard (status = 'initiated' in the UPDATE) is what
    actually protects against a redelivered callback double-crediting (rule 7),
    proven first in stage 4's fake-confirm/cash-confirm paths."""
    stk = payload.get("Body", {}).get("stkCallback", {})
    checkout_request_id = stk.get("CheckoutRequestID")
    result_code = stk.get("ResultCode")

    row = (
        await session.execute(
            text("select * from transactions where checkout_request_id = :crid"), {"crid": checkout_request_id}
        )
    ).one_or_none()
    if row is None or row.status != "initiated":
        return ACK  # unknown reference, or already handled — idempotent no-op either way

    if str(result_code) != "0":
        # Rule 6: failed/timed-out STK — no ledger entry, no auto-retry.
        await session.execute(
            text("update transactions set status = 'failed' where id = :id and status = 'initiated'"),
            {"id": row.id},
        )
        await session.commit()
        return ACK

    items = {item["Name"]: item["Value"] for item in stk.get("CallbackMetadata", {}).get("Item", [])}
    receipt = items.get("MpesaReceiptNumber")

    updated = (
        await session.execute(
            text(
                "update transactions set status = 'confirmed', stk_receipt = :receipt "
                "where id = :id and status = 'initiated' returning *"
            ),
            {"receipt": receipt, "id": row.id},
        )
    ).one_or_none()
    if updated is None:
        await session.commit()
        return ACK  # a redelivered callback lost the race — already handled

    await write_ledger_entries(
        session,
        transaction_id=updated.id,
        producer_id=updated.producer_id,
        driver_id=updated.driver_id,
        maker_amount=updated.maker_amount,
        driver_amount=updated.driver_amount,
    )
    await session.commit()
    return ACK


@router.post("/b2c-callback")
async def b2c_callback(
    payload: dict[str, Any], session: Annotated[AsyncSession, Depends(get_session)], background: BackgroundTasks
) -> dict:
    """Real Daraja B2C result callback (CLAUDE.md section 6 step 5). Correlates back to
    withdrawal_requests via OriginatorConversationID, which we set to our own
    idempotency_key at request time — no extra column needed for that linkage."""
    result = payload.get("Result", {})
    originator_conversation_id = result.get("OriginatorConversationID")
    result_code = result.get("ResultCode")

    row = (
        await session.execute(
            text("select * from withdrawal_requests where idempotency_key = :key"),
            {"key": originator_conversation_id},
        )
    ).one_or_none()
    if row is None or row.status not in ("requested", "processing"):
        return ACK  # unknown reference, or already handled

    if str(result_code) != "0":
        # Rule 11: funds simply stay 'available' — they were never moved out of it,
        # so "return to available" is automatic. The one automatic retry runs after
        # this callback is acknowledged, so Daraja isn't kept waiting on a new B2C call.
        await session.execute(
            text("update withdrawal_requests set status = 'failed', resolved_at = now() where id = :id"),
            {"id": row.id},
        )
        await session.commit()
        background.add_task(payouts.retry_after_callback_failure, row.id)
        return ACK

    params = {p["Key"]: p["Value"] for p in result.get("ResultParameters", {}).get("ResultParameter", [])}
    receipt = params.get("TransactionReceipt")

    updated = (
        await session.execute(
            text(
                "update withdrawal_requests set status = 'paid', b2c_receipt = :receipt, resolved_at = now() "
                "where id = :id and status in ('requested', 'processing') returning *"
            ),
            {"receipt": receipt, "id": row.id},
        )
    ).one_or_none()
    if updated is None:
        await session.commit()
        return ACK

    # Claim exactly `amount` worth of the oldest 'available' entries for this recipient —
    # avoids needing a withdrawal_request_id column on wallet_ledger_entries, and
    # correctly leaves alone any entries that became available after this withdrawal
    # was already requested.
    await session.execute(
        text(
            """
            with ranked as (
                select id, sum(amount) over (order by created_at) as running_total
                from wallet_ledger_entries
                where recipient_type = :rtype and recipient_id = :rid and status = 'available'
            )
            update wallet_ledger_entries set status = 'paid'
            where id in (select id from ranked where running_total <= :amount)
            """
        ),
        {"rtype": updated.recipient_type, "rid": updated.recipient_id, "amount": updated.amount},
    )
    await session.commit()
    return ACK


@router.post("/b2c-timeout")
async def b2c_timeout(payload: dict[str, Any]) -> dict:
    # Daraja requires a QueueTimeOutURL to accept the B2C request at all; the real
    # result (success or failure) always arrives via b2c-callback instead in sandbox.
    return ACK
