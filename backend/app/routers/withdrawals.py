import uuid
from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from .. import daraja
from ..caller import resolve_producer_or_driver
from ..config import settings
from ..db import get_session

router = APIRouter(prefix="/withdrawals", tags=["withdrawals"])

MIN_WITHDRAWAL_AMOUNT = Decimal("500")  # CLAUDE.md rule 9


class WithdrawalResponse(BaseModel):
    id: str
    status: str
    amount: Decimal


@router.post("/request", response_model=WithdrawalResponse, status_code=status.HTTP_201_CREATED)
async def request_withdrawal(
    session: Annotated[AsyncSession, Depends(get_session)],
    authorization: Annotated[str | None, Header()] = None,
) -> WithdrawalResponse:
    """On-demand withdrawal (CLAUDE.md rule 9: always full balance, never partial,
    >= KES 500) triggering a real Daraja B2C payout. The daily 18:00 EAT sweep that
    calls this same path automatically is stage 6 — this endpoint is what it will
    call, built now so B2C's mechanics (section 6 steps 4-5) are actually exercised."""
    recipient_type, recipient_id = await resolve_producer_or_driver(session, authorization)
    recipient_type = "maker" if recipient_type == "producer" else "driver"

    balance_row = (
        await session.execute(
            text(
                "select coalesce(sum(amount), 0) as total from wallet_ledger_entries "
                "where recipient_type = :rtype and recipient_id = :rid and status = 'available'"
            ),
            {"rtype": recipient_type, "rid": recipient_id},
        )
    ).one()
    balance = balance_row.total
    if balance < MIN_WITHDRAWAL_AMOUNT:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            f"Available balance (KES {balance}) is below the KES {MIN_WITHDRAWAL_AMOUNT} withdrawal threshold.",
        )

    in_flight = (
        await session.execute(
            text(
                "select id from withdrawal_requests where recipient_type = :rtype and recipient_id = :rid "
                "and status in ('requested', 'processing')"
            ),
            {"rtype": recipient_type, "rid": recipient_id},
        )
    ).one_or_none()
    if in_flight is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "A withdrawal is already in progress.")

    idempotency_key = uuid.uuid4()
    row = (
        await session.execute(
            text(
                """
                insert into withdrawal_requests (recipient_type, recipient_id, amount, idempotency_key, status)
                values (:rtype, :rid, :amount, :key, 'requested')
                returning id
                """
            ),
            {"rtype": recipient_type, "rid": recipient_id, "amount": balance, "key": idempotency_key},
        )
    ).one()
    await session.commit()

    phone_row = (
        await session.execute(
            text(f"select phone from {'producers' if recipient_type == 'maker' else 'drivers'} where id = :id"),
            {"id": recipient_id},
        )
    ).one()

    try:
        b2c_response = await daraja.b2c_payment(
            phone=phone_row.phone,
            amount=balance,
            remarks="Sawa Split payout",
            occasion="Payout",
            result_url=f"{settings.daraja_callback_base_url}/daraja/b2c-callback",
            timeout_url=f"{settings.daraja_callback_base_url}/daraja/b2c-timeout",
            originator_conversation_id=str(idempotency_key),
        )
        if str(b2c_response.get("ResponseCode")) != "0":
            raise RuntimeError(b2c_response.get("ResponseDescription", "B2C request rejected"))
    except Exception as exc:
        await session.execute(
            text("update withdrawal_requests set status = 'failed', resolved_at = now() where id = :id"),
            {"id": row.id},
        )
        await session.commit()
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"Could not initiate payout: {exc}") from exc

    await session.execute(
        text("update withdrawal_requests set status = 'processing' where id = :id"), {"id": row.id}
    )
    await session.commit()
    return WithdrawalResponse(id=str(row.id), status="processing", amount=balance)
