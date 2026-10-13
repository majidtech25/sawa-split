import logging
from typing import Annotated, Any

from fastapi import APIRouter, BackgroundTasks, Depends
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from .. import lifecycle, payouts, verification
from ..db import get_session

router = APIRouter(prefix="/daraja", tags=["daraja"], include_in_schema=False)
log = logging.getLogger("sawa.daraja")

ACK = {"ResultCode": 0, "ResultDesc": "Accepted"}


@router.post("/stk-callback/{token}")
async def stk_callback(
    token: str, payload: dict[str, Any], session: Annotated[AsyncSession, Depends(get_session)]
) -> JSONResponse:
    """Real Daraja STK callback (CLAUDE.md section 6 step 2), at the per-transaction
    signed URL the STK Push gave Daraja. A callback without this sale's token, or for a
    different amount, is refused and credits nothing; app/verification.py then has
    Safaricom confirm the payment (STK_QUERY_MODE). Redelivery is a no-op (rule 7)."""
    code, body = await verification.handle_stk_callback(session, token, payload)
    return JSONResponse(body, status_code=code)


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
    # Safaricom's verdict, for the Render logs (no secrets in these fields).
    log.info("B2C callback for %s: ResultCode %s, %s", originator_conversation_id, result_code, result.get("ResultDesc"))

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
        if str(result_code) in payouts.PAUSE_RESULT_CODES:
            # The initiator itself can't pay (locked or invalid): no retry, and every
            # other payout stops too, until a coordinator resumes them (migration 0015).
            await payouts.pause_payouts(session, str(result_code), result.get("ResultDesc"))
            return ACK
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
    # A closing account's final payout (rule 17): now it can be closed.
    await lifecycle.finish_closure_if_paid_out(session, updated.recipient_type, updated.recipient_id, updated.id)
    return ACK


@router.post("/b2c-timeout")
async def b2c_timeout(payload: dict[str, Any]) -> dict:
    # Daraja requires a QueueTimeOutURL to accept the B2C request at all; the real
    # result (success or failure) always arrives via b2c-callback instead in sandbox.
    return ACK
