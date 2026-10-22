from decimal import Decimal
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Header, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from .. import payouts
from ..caller import resolve_producer_or_driver
from ..db import get_session
from ..security import require_admin

router = APIRouter(prefix="/withdrawals", tags=["withdrawals"])
admin_router = APIRouter(prefix="/admin/withdrawals", tags=["admin"])


class WithdrawalResponse(BaseModel):
    id: str
    status: str
    amount: Decimal
    retry_of: str | None = None


def _response(row) -> WithdrawalResponse:
    return WithdrawalResponse(
        id=str(row.id), status=row.status, amount=row.amount, retry_of=str(row.retry_of) if row.retry_of else None
    )


@router.post("/request", response_model=WithdrawalResponse, status_code=status.HTTP_201_CREATED)
async def request_withdrawal(
    session: Annotated[AsyncSession, Depends(get_session)],
    authorization: Annotated[str | None, Header()] = None,
) -> WithdrawalResponse:
    """On-demand withdrawal (CLAUDE.md rule 9: always the full payable balance, >= KES 500)
    via a real Daraja B2C payout. The one automatic retry on failure (rule 11) is
    handled inside payouts.start_payout or by the B2C callback."""
    recipient_type, recipient_id = await resolve_producer_or_driver(session, authorization)
    recipient_type = "maker" if recipient_type == "producer" else "driver"

    try:
        row = await payouts.start_payout(session, recipient_type, recipient_id)
    except payouts.PayoutRefused as exc:
        balance_reason = "threshold" in str(exc) or "owed to site intermediaries" in str(exc)
        code = status.HTTP_422_UNPROCESSABLE_ENTITY if balance_reason else status.HTTP_409_CONFLICT
        raise HTTPException(code, str(exc)) from exc

    if row.status == "failed":
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            "Could not start the M-Pesa payout, and the automatic retry also failed. "
            "Your balance is unchanged; the coordinator can retry it.",
        )
    return _response(row)


@admin_router.post("/{withdrawal_id}/retry", response_model=WithdrawalResponse, status_code=status.HTTP_201_CREATED)
async def retry_withdrawal(
    withdrawal_id: str,
    _admin: Annotated[dict[str, Any], Depends(require_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> WithdrawalResponse:
    """Manual coordinator retry (rule 11) of a failed payout — normally one whose
    automatic retry also failed, but any failed withdrawal qualifies, so a payout
    whose automatic retry was refused can't get stuck. Pays the same amount again;
    the failed withdrawal becomes 'retried'."""
    failed = (
        await session.execute(text("select * from withdrawal_requests where id = :id"), {"id": withdrawal_id})
    ).one_or_none()
    if failed is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Withdrawal not found")
    if failed.status != "failed":
        raise HTTPException(status.HTTP_409_CONFLICT, f"Only a failed withdrawal can be retried (this one is '{failed.status}').")
    try:
        row = await payouts.retry_payout(session, failed.id, automatic=False)
    except payouts.PayoutRefused as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from exc
    if row is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "This withdrawal was already retried.")
    return _response(row)
