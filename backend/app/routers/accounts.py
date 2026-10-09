"""The signed-in maker's or driver's own account: balances as the payout rules see
them (rule 12: only M-Pesa money is payable; a maker's cash-sale debts to drivers come
first)."""

from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Depends, Header
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ..caller import resolve_producer_or_driver
from ..db import get_session
from ..ledger import available_balance, outstanding_debt, payable_balance

router = APIRouter(prefix="/accounts", tags=["accounts"])


class AccountSummary(BaseModel):
    role: str                   # 'producer' or 'driver'
    available: Decimal          # available M-Pesa-sourced entries
    payable: Decimal            # what a withdrawal or the sweep would send now
    owed_to_drivers: Decimal    # maker: cash-sale debts not yet settled (disputed sales left out)
    owed_by_makers: Decimal     # driver: their shares of cash sales that makers still owe
    cash_held: Decimal          # maker: their shares of confirmed cash sales, already in hand


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
    )
