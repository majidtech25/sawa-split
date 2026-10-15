"""Coordinator-only: reconciliation (CLAUDE.md section 6 step 6) and disputes (rule 13)."""

import uuid
from decimal import Decimal
from urllib.parse import urlencode
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from .. import links, payouts, verification
from .. import tours as tours_lib
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
    needs_attention: int        # expired cash sales + payouts waiting for a coordinator retry + flagged payment checks
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


class PaymentCheck(BaseModel):
    transaction_id: str
    created_at: str
    producer_name: str
    total_amount: Decimal
    transaction_status: str     # 'confirmed' (credited, flag mode), 'verifying' (enforce), 'initiated', 'failed'
    state: str                  # pending (enforce only), mismatch, unanswered, amount_mismatch,
                                # unresolved (no final result; sale released), paid_late (credited late)
    mode: str
    attempts: int
    callback_amount: Decimal | None
    last_result: str | None     # Safaricom's last answer, in words


class PayoutPause(BaseModel):
    result_code: str
    reason: str
    paused_at: str


class ReferrerRow(BaseModel):
    name: str
    referral_code: str
    referrer_type: str          # driver, tour_guide or agent (MUST 15)
    sales: int                  # referred sales that went through (M-Pesa confirmed, cash confirmed, disputed)
    commission: Decimal         # their shares of those sales


class TourRow(BaseModel):
    id: str
    referrer_name: str
    referral_code: str
    started_at: str
    ended_at: str | None        # None while it's running
    group_size: int
    joined: int
    sales: int                  # referred sales on the tour that went through
    commission: Decimal


class ReconciliationResponse(BaseModel):
    totals: Totals
    referrers: list[ReferrerRow]  # SCOPE_V2 MUST 9
    tours: list[TourRow]          # SCOPE_V2 MUST 17, newest first
    payouts_paused: PayoutPause | None  # set while every payout is stopped (migration 0015)
    payment_checks: list[PaymentCheck]
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
                    + (select count(*) from withdrawal_requests where status = 'failed')
                    + (select count(*) from stk_verifications
                         where state in ('mismatch', 'unanswered', 'amount_mismatch', 'unresolved')) as needs_attention
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

    # STK Push Query checks a coordinator should see: anything Safaricom contradicted,
    # never answered, or a callback with the wrong amount, plus sales still verifying,
    # payments with no final result, and payments confirmed only after their sale was
    # released (the tourist may have paid that sale twice).
    checks = (
        await session.execute(
            text(
                """
                select v.*, t.created_at as txn_created_at, t.total_amount, t.status as txn_status, p.name as producer_name
                from stk_verifications v
                join transactions t on t.id = v.transaction_id
                join producers p on p.id = t.producer_id
                where v.state in ('mismatch', 'unanswered', 'amount_mismatch', 'unresolved', 'paid_late')
                   or t.status = 'verifying'
                order by t.created_at desc
                limit 200
                """
            )
        )
    ).all()

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

    referrers = (
        await session.execute(
            text(
                """
                select d.name, d.referral_code, d.referrer_type, count(t.id) as sales,
                       coalesce(sum(t.driver_amount), 0) as commission
                from drivers d
                left join transactions t on t.driver_id = d.id and t.status in ('confirmed', 'cash_confirmed', 'disputed')
                group by d.id, d.name, d.referral_code, d.referrer_type
                order by commission desc, d.name
                """
            )
        )
    ).all()
    await tours_lib.close_past(session)
    await session.commit()
    tour_rows = (
        await session.execute(
            text(
                """
                select tr.id, d.name, d.referral_code, tr.started_at, tr.ended_at, tr.group_size,
                       (select count(*) from tour_joins j where j.tour_id = tr.id) as joined,
                       (select count(*) from transactions t where t.tour_id = tr.id
                          and t.status in ('confirmed', 'cash_confirmed', 'disputed')) as sales,
                       (select coalesce(sum(t.driver_amount), 0) from transactions t where t.tour_id = tr.id
                          and t.status in ('confirmed', 'cash_confirmed', 'disputed')) as commission
                from tours tr join drivers d on d.id = tr.driver_id
                order by tr.started_at desc
                limit 100
                """
            )
        )
    ).all()
    pause = await payouts.active_pause(session)
    return ReconciliationResponse(
        totals=totals,
        referrers=[
            ReferrerRow(name=r.name, referral_code=r.referral_code, referrer_type=r.referrer_type, sales=r.sales, commission=r.commission)
            for r in referrers
        ],
        tours=[
            TourRow(
                id=str(r.id), referrer_name=r.name, referral_code=r.referral_code, started_at=r.started_at.isoformat(),
                ended_at=r.ended_at.isoformat() if r.ended_at else None, group_size=r.group_size, joined=r.joined,
                sales=r.sales, commission=r.commission,
            )
            for r in tour_rows
        ],
        payouts_paused=PayoutPause(result_code=pause.result_code, reason=pause.reason, paused_at=pause.paused_at.isoformat())
        if pause else None,
        payment_checks=[
            PaymentCheck(
                transaction_id=str(c.transaction_id), created_at=c.txn_created_at.isoformat(),
                producer_name=c.producer_name, total_amount=c.total_amount, transaction_status=c.txn_status,
                state=c.state, mode=c.mode, attempts=c.attempts, callback_amount=c.callback_amount,
                last_result=(c.last_result or {}).get("description"),
            )
            for c in checks
        ],
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


class PaymentCheckResult(BaseModel):
    transaction_id: str
    state: str
    transaction_status: str


@router.post("/transactions/{transaction_id}/check-payment", response_model=PaymentCheckResult)
async def check_payment_now(
    transaction_id: str,
    _admin: Annotated[dict[str, Any], Depends(require_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> PaymentCheckResult:
    """Asks Safaricom again, now, whether an M-Pesa sale was paid (STK Push Query).
    For a sale stuck "Payment being verified" (enforce mode) a yes credits it at once;
    a no fails it. In flag mode it re-checks a flagged sale."""
    exists = (
        await session.execute(
            text("select 1 from stk_verifications where transaction_id = cast(:id as uuid)"), {"id": transaction_id}
        )
    ).one_or_none() if _is_uuid(transaction_id) else None
    if exists is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "This sale has no payment check.")
    await session.commit()
    state = await verification.check_payment(session, transaction_id, force=True)
    txn_status = (
        await session.execute(text("select status from transactions where id = cast(:id as uuid)"), {"id": transaction_id})
    ).scalar_one()
    return PaymentCheckResult(transaction_id=transaction_id, state=state, transaction_status=txn_status)


def _is_uuid(value: str) -> bool:
    try:
        uuid.UUID(value)
        return True
    except ValueError:
        return False


class ResumeResult(BaseModel):
    resumed: bool


@router.post("/payouts/resume", response_model=ResumeResult)
async def resume_payouts(
    admin: Annotated[dict[str, Any], Depends(require_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> ResumeResult:
    """Ends a payout pause (migration 0015), once the B2C credential has been fixed.
    Payouts that failed while paused are retried from the Payouts table as usual."""
    return ResumeResult(resumed=await payouts.resume_payouts(session, admin["id"]))


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
