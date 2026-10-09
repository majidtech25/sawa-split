"""Coordinator-only: reconciliation (CLAUDE.md section 6 step 6) and disputes (rule 13)."""

from decimal import Decimal
from urllib.parse import urlencode
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from .. import links
from ..db import get_session
from .public import build_checkout
from ..security import require_admin

router = APIRouter(prefix="/admin", tags=["admin"])

class Totals(BaseModel):
    collected: Decimal          # M-Pesa money received (confirmed + disputed); cash never reaches the account
    disbursed: Decimal          # paid out by B2C
    pending: Decimal            # M-Pesa money still owed to makers and drivers (pending + available + frozen)
    frozen: Decimal             # the part of `pending` held by disputes
    ledger_paid: Decimal        # ledger entries marked paid
    balanced: bool              # collected == ledger_paid + pending, and ledger_paid == disbursed
    needs_attention: int        # expired cash sales + payouts waiting for a coordinator retry
    cash_recorded: Decimal      # confirmed cash sales (disputed included): held by makers, never paid out by B2C
    debts_outstanding: Decimal  # drivers' shares of cash sales that makers still owe


class TransactionRow(BaseModel):
    id: str
    created_at: str
    producer_name: str
    driver_name: str | None
    payment_method: str
    status: str
    total_amount: Decimal
    maker_amount: Decimal
    driver_amount: Decimal
    confirmation_deadline: str | None


class WithdrawalRow(BaseModel):
    id: str
    requested_at: str
    recipient_type: str
    recipient_name: str
    amount: Decimal
    status: str
    retry_of: str | None
    b2c_receipt: str | None
    awaiting_coordinator: bool


class DebtRow(BaseModel):
    id: str
    created_at: str
    producer_name: str
    driver_name: str
    amount: Decimal
    disputed: bool


class ReconciliationResponse(BaseModel):
    totals: Totals
    debts: list[DebtRow]
    transactions: list[TransactionRow]
    withdrawals: list[WithdrawalRow]


@router.get("/reconciliation", response_model=ReconciliationResponse)
async def reconciliation(
    _admin: Annotated[dict[str, Any], Depends(require_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> ReconciliationResponse:
    """M-Pesa collected vs. disbursed vs. still owed. There is no platform fee (rule 4),
    so every M-Pesa shilling is either already paid out or still owed, and `balanced`
    checks exactly that. Cash is reported beside it, not in it: it never reaches the
    M-Pesa account, so these totals match the account's real balance (rule 12)."""
    t = (
        await session.execute(
            text(
                """
                select
                  (select coalesce(sum(total_amount), 0) from transactions
                     where payment_method = 'mpesa' and status in ('confirmed', 'disputed')) as collected,
                  (select coalesce(sum(total_amount), 0) from transactions
                     where payment_method = 'cash' and status in ('cash_confirmed', 'disputed')) as cash_recorded,
                  (select coalesce(sum(amount), 0) from cash_debts where status = 'outstanding') as debts_outstanding,
                  (select coalesce(sum(amount), 0) from withdrawal_requests where status = 'paid') as disbursed,
                  (select coalesce(sum(amount), 0) from wallet_ledger_entries where status in ('pending', 'available', 'frozen')) as pending,
                  (select coalesce(sum(amount), 0) from wallet_ledger_entries where status = 'frozen') as frozen,
                  (select coalesce(sum(amount), 0) from wallet_ledger_entries where status = 'paid') as ledger_paid,
                  (select count(*) from transactions where status = 'cash_expired')
                    + (select count(*) from withdrawal_requests where status = 'failed') as needs_attention
                """
            )
        )
    ).one()
    totals = Totals(
        collected=t.collected,
        disbursed=t.disbursed,
        pending=t.pending,
        frozen=t.frozen,
        ledger_paid=t.ledger_paid,
        balanced=t.collected == t.ledger_paid + t.pending and t.ledger_paid == t.disbursed,
        needs_attention=t.needs_attention,
        cash_recorded=t.cash_recorded,
        debts_outstanding=t.debts_outstanding,
    )

    debts = (
        await session.execute(
            text(
                """
                select d.id, d.created_at, d.amount, p.name as producer_name, dr.name as driver_name,
                       t.status = 'disputed' as disputed
                from cash_debts d
                join producers p on p.id = d.producer_id
                join drivers dr on dr.id = d.driver_id
                join transactions t on t.id = d.transaction_id
                where d.status = 'outstanding'
                order by d.created_at
                """
            )
        )
    ).all()

    txns = (
        await session.execute(
            text(
                """
                select t.id, t.created_at, p.name as producer_name, d.name as driver_name, t.payment_method,
                       t.status, t.total_amount, t.maker_amount, t.driver_amount, t.confirmation_deadline
                from transactions t
                join producers p on p.id = t.producer_id
                left join drivers d on d.id = t.driver_id
                -- expired-unconfirmed cash is what a coordinator should notice first (CLAUDE.md section 7)
                order by (t.status = 'cash_expired') desc, t.created_at desc
                limit 200
                """
            )
        )
    ).all()

    withdrawals = (
        await session.execute(
            text(
                """
                select w.*, coalesce(p.name, d.name) as recipient_name
                from withdrawal_requests w
                left join producers p on w.recipient_type = 'maker' and p.id = w.recipient_id
                left join drivers d on w.recipient_type = 'driver' and d.id = w.recipient_id
                order by (w.status = 'failed') desc, w.requested_at desc
                limit 200
                """
            )
        )
    ).all()

    return ReconciliationResponse(
        totals=totals,
        debts=[
            DebtRow(
                id=str(d.id), created_at=d.created_at.isoformat(), producer_name=d.producer_name,
                driver_name=d.driver_name, amount=d.amount, disputed=d.disputed,
            )
            for d in debts
        ],
        transactions=[
            TransactionRow(
                id=str(r.id), created_at=r.created_at.isoformat(), producer_name=r.producer_name,
                driver_name=r.driver_name, payment_method=r.payment_method, status=r.status,
                total_amount=r.total_amount, maker_amount=r.maker_amount, driver_amount=r.driver_amount,
                confirmation_deadline=r.confirmation_deadline.isoformat() if r.confirmation_deadline else None,
            )
            for r in txns
        ],
        withdrawals=[
            WithdrawalRow(
                id=str(w.id), requested_at=w.requested_at.isoformat(), recipient_type=w.recipient_type,
                recipient_name=w.recipient_name or "Unknown", amount=w.amount, status=w.status,
                retry_of=str(w.retry_of) if w.retry_of else None, b2c_receipt=w.b2c_receipt,
                awaiting_coordinator=w.status == "failed",
            )
            for w in withdrawals
        ],
    )


class DisputeResponse(BaseModel):
    id: str
    status: str
    ledger_entries_changed: int


@router.post("/transactions/{transaction_id}/dispute", response_model=DisputeResponse)
async def flag_dispute(
    transaction_id: str,
    _admin: Annotated[dict[str, Any], Depends(require_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> DisputeResponse:
    """Rule 13: freeze a transaction's unpaid ledger entries, excluding them from
    every withdrawal and the sweep until a coordinator clears the dispute. Entries
    already paid out can't be frozen — that money has left."""
    txn = (
        await session.execute(text("select * from transactions where id = :id"), {"id": transaction_id})
    ).one_or_none()
    if txn is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Transaction not found")
    if txn.status not in ("confirmed", "cash_confirmed"):
        raise HTTPException(
            status.HTTP_409_CONFLICT, f"Only a confirmed transaction can be disputed (this one is '{txn.status}')."
        )

    # A payout in flight was sized from balances that include these entries; freezing
    # them now would leave the paid-out amount larger than the entries it marks paid.
    in_flight = (
        await session.execute(
            text(
                """
                select 1 from withdrawal_requests w
                join wallet_ledger_entries e on e.recipient_type = w.recipient_type and e.recipient_id = w.recipient_id
                where e.transaction_id = :id and w.status in ('requested', 'processing')
                limit 1
                """
            ),
            {"id": transaction_id},
        )
    ).one_or_none()
    if in_flight is not None:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "A payout to this maker or driver is in progress. Flag the dispute once it has finished.",
        )

    frozen = await session.execute(
        text(
            "update wallet_ledger_entries set status = 'frozen' "
            "where transaction_id = :id and status in ('pending', 'available')"
        ),
        {"id": transaction_id},
    )
    await session.execute(text("update transactions set status = 'disputed' where id = :id"), {"id": transaction_id})
    await session.commit()
    return DisputeResponse(id=transaction_id, status="disputed", ledger_entries_changed=frozen.rowcount)


@router.post("/transactions/{transaction_id}/resolve", response_model=DisputeResponse)
async def clear_dispute(
    transaction_id: str,
    _admin: Annotated[dict[str, Any], Depends(require_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> DisputeResponse:
    """A coordinator clears a dispute by hand (there's no automatic resolution, rule
    14): frozen entries become available again and the transaction returns to its
    confirmed state."""
    txn = (
        await session.execute(text("select * from transactions where id = :id"), {"id": transaction_id})
    ).one_or_none()
    if txn is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Transaction not found")
    if txn.status != "disputed":
        raise HTTPException(status.HTTP_409_CONFLICT, "This transaction isn't disputed.")
    restored = "confirmed" if txn.payment_method == "mpesa" else "cash_confirmed"
    thawed = await session.execute(
        text("update wallet_ledger_entries set status = 'available' where transaction_id = :id and status = 'frozen'"),
        {"id": transaction_id},
    )
    await session.execute(text("update transactions set status = :s where id = :id"), {"s": restored, "id": transaction_id})
    await session.commit()
    return DisputeResponse(id=transaction_id, status=restored, ledger_entries_changed=thawed.rowcount)


class PriceCardRequest(BaseModel):
    producer_id: str
    product_amount: Decimal | None = None
    photo_amount: Decimal | None = None
    driver_qr: str | None = None


class PriceCardResponse(BaseModel):
    path: str            # the frontend route, e.g. /pay/<id>?product=100&photo=10&driver=...&sig=...
    total_amount: Decimal


@router.post("/price-cards", response_model=PriceCardResponse)
async def create_price_card(
    body: PriceCardRequest,
    _admin: Annotated[dict[str, Any], Depends(require_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> PriceCardResponse:
    """Signs a price card's link (app/links.py) after the same checks the public
    checkout runs, so only a card that would actually work gets printed."""
    checkout = await build_checkout(session, body.producer_id, body.product_amount, body.photo_amount, body.driver_qr)
    params = {}
    if body.product_amount is not None:
        params["product"] = f"{body.product_amount:f}"
    if body.photo_amount is not None:
        params["photo"] = f"{body.photo_amount:f}"
    if body.driver_qr:
        params["driver"] = body.driver_qr
    params["sig"] = links.sign(body.producer_id, body.product_amount, body.photo_amount, body.driver_qr)
    return PriceCardResponse(path=f"/pay/{body.producer_id}?{urlencode(params)}", total_amount=checkout.total_amount)
