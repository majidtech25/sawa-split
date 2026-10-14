"""The signed-in maker's or driver's own account: balances as the payout rules see
them (rule 12: only M-Pesa money is payable; a maker's cash-sale debts to drivers come
first), and their own closure request (rule 17)."""

from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from .. import lifecycle
from ..caller import resolve_producer_or_driver
from ..db import get_session
from ..ledger import available_balance, outstanding_debt, payable_balance

router = APIRouter(prefix="/accounts", tags=["accounts"])


class ClosureRequest(BaseModel):
    id: str
    status: str                 # pending, cancelled, rejected, approved (final payout in progress), closed
    reason: str
    requested_at: str
    decided_at: str | None
    decision_reason: str | None


def _closure(row) -> ClosureRequest | None:
    if row is None:
        return None
    return ClosureRequest(
        id=str(row.id), status=row.status, reason=row.reason, requested_at=row.requested_at.isoformat(),
        decided_at=row.decided_at.isoformat() if row.decided_at else None, decision_reason=row.decision_reason,
    )


async def _latest_closure(session: AsyncSession, party_type: str, party_id):
    return (
        await session.execute(
            text(
                "select * from closure_requests where party_type = :ptype and party_id = :pid "
                "order by requested_at desc limit 1"
            ),
            {"ptype": party_type, "pid": party_id},
        )
    ).one_or_none()


class AccountSummary(BaseModel):
    role: str                   # 'producer' or 'driver'
    available: Decimal          # available M-Pesa-sourced entries
    payable: Decimal            # what a withdrawal or the sweep would send now
    owed_to_drivers: Decimal    # maker: cash-sale debts not yet settled (disputed sales left out)
    owed_by_makers: Decimal     # driver: their shares of cash sales that makers still owe
    cash_held: Decimal          # maker: their shares of confirmed cash sales, already in hand
    account_status: str         # active or closing (suspended and closed accounts are refused with a 403)
    referral_code: str | None   # driver: their code, for their personal QR (SCOPE_V2)
    stall_code: str | None      # maker: their stand QR's code
    photo_fee: Decimal | None   # maker: their photo-consent fee, if any
    closure: ClosureRequest | None  # their latest closure request, if any


@router.get("/me", response_model=AccountSummary)
async def my_account(
    session: Annotated[AsyncSession, Depends(get_session)],
    authorization: Annotated[str | None, Header()] = None,
) -> AccountSummary:
    role, party_id = await resolve_producer_or_driver(session, authorization)
    rtype = "maker" if role == "producer" else "driver"
    owed_to_drivers = await outstanding_debt(session, party_id) if rtype == "maker" else Decimal(0)
    owed_by_makers = (
        await session.execute(
            text("select coalesce(sum(amount), 0) from cash_debts where driver_id = :id and status = 'outstanding'"),
            {"id": party_id},
        )
    ).scalar_one() if rtype == "driver" else Decimal(0)
    cash_held = (
        await session.execute(
            text(
                "select coalesce(sum(amount), 0) from wallet_ledger_entries "
                "where recipient_type = 'maker' and recipient_id = :id and status = 'cash_held'"
            ),
            {"id": party_id},
        )
    ).scalar_one() if rtype == "maker" else Decimal(0)
    return AccountSummary(
        role=role,
        available=await available_balance(session, rtype, party_id),
        payable=await payable_balance(session, rtype, party_id),
        owed_to_drivers=owed_to_drivers,
        owed_by_makers=owed_by_makers,
        cash_held=cash_held,
        account_status=(await lifecycle.party(session, rtype, party_id)).account_status,
        **(await _codes(session, rtype, party_id)),
        closure=_closure(await _latest_closure(session, rtype, party_id)),
    )


async def _codes(session: AsyncSession, rtype: str, party_id) -> dict:
    if rtype == "driver":
        code = (await session.execute(text("select referral_code from drivers where id = :id"), {"id": party_id})).scalar_one()
        return {"referral_code": code, "stall_code": None, "photo_fee": None}
    row = (await session.execute(text("select stall_code, photo_fee from producers where id = :id"), {"id": party_id})).one()
    return {"referral_code": None, "stall_code": row.stall_code, "photo_fee": row.photo_fee}


class ClosureRequestBody(BaseModel):
    reason: str = Field(min_length=1, max_length=1000)


class CancelBody(BaseModel):
    reason: str | None = Field(default=None, max_length=1000)


@router.post("/me/closure", response_model=ClosureRequest, status_code=status.HTTP_201_CREATED)
async def request_closure(
    body: ClosureRequestBody,
    session: Annotated[AsyncSession, Depends(get_session)],
    authorization: Annotated[str | None, Header()] = None,
) -> ClosureRequest:
    """A maker or driver asks to close their account (rule 17). A coordinator decides."""
    role, party_id = await resolve_producer_or_driver(session, authorization)
    rtype = "maker" if role == "producer" else "driver"
    reason = body.reason.strip()
    if not reason:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Say why you want to close your account.")
    me = await lifecycle.party(session, rtype, party_id)
    if me.account_status != "active":
        raise HTTPException(status.HTTP_409_CONFLICT, "This account is already being closed.")
    latest = await _latest_closure(session, rtype, party_id)
    if latest is not None and latest.status in ("pending", "approved"):
        raise HTTPException(status.HTTP_409_CONFLICT, "You already have a closure request open.")
    row = (
        await session.execute(
            text(
                "insert into closure_requests (party_type, party_id, reason) values (:ptype, :pid, :reason) returning *"
            ),
            {"ptype": rtype, "pid": party_id, "reason": reason},
        )
    ).one()
    await lifecycle.audit(
        session, "closure_requested", rtype, party_id, actor_role=rtype, actor_id=party_id, actor_phone=me.phone,
        reason=reason, details={"closure_request_id": str(row.id)},
    )
    await session.commit()
    return _closure(row)


@router.post("/me/closure/cancel", response_model=ClosureRequest)
async def cancel_closure(
    body: CancelBody,
    session: Annotated[AsyncSession, Depends(get_session)],
    authorization: Annotated[str | None, Header()] = None,
) -> ClosureRequest:
    """Withdraws a closure request that a coordinator hasn't decided yet."""
    role, party_id = await resolve_producer_or_driver(session, authorization)
    rtype = "maker" if role == "producer" else "driver"
    me = await lifecycle.party(session, rtype, party_id)
    row = (
        await session.execute(
            text(
                "update closure_requests set status = 'cancelled', decided_at = now() "
                "where party_type = :ptype and party_id = :pid and status = 'pending' returning *"
            ),
            {"ptype": rtype, "pid": party_id},
        )
    ).one_or_none()
    if row is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "There's no pending closure request to cancel.")
    reason = (body.reason or "").strip() or None
    await lifecycle.audit(
        session, "closure_cancelled", rtype, party_id, actor_role=rtype, actor_id=party_id, actor_phone=me.phone,
        reason=reason, details={"closure_request_id": str(row.id)},
    )
    await session.commit()
    return _closure(row)
