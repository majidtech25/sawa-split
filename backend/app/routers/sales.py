"""Open sales (SCOPE_V2.md): the maker types a sale, the tourist pays it from the stall's
stand QR. Logic and the split's rounding rule live in app/sales.py.

Public (no login; each returns only what the stall page shows: never a phone, Till or
balance): the stall's current sale, a sale's server-computed breakdown for a referral
code, and paying it. Maker (logged in): create, see the current sale, cancel.
"""

import uuid
from decimal import Decimal
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Header, HTTPException, status
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from .. import sales, tours
from ..caller import resolve_producer_or_driver
from ..db import get_session
from .public import CheckoutResponse, Party, PhotoComponent, ProductComponent
from .transactions import MIN_TRANSACTION_AMOUNT, InitiateTransactionResponse, start_payment

public_router = APIRouter(prefix="/public", tags=["public"])
router = APIRouter(prefix="/sales", tags=["sales"])

REFUSALS = {
    "paid": "This sale has already been paid.",
    "expired": "This sale has expired. Ask the seller to enter it again.",
    "cancelled": "The seller cancelled this sale.",
    "paying": "A payment for this sale is already in progress.",
}
UNKNOWN_CODE = "That intermediary code isn't registered with Sawa Split."


def _is_uuid(value: str) -> bool:
    try:
        uuid.UUID(value)
        return True
    except ValueError:
        return False


class SaleView(BaseModel):
    id: str
    amount: Decimal
    description: str | None
    photo_fee: Decimal | None
    total_amount: Decimal
    status: str                 # open, paying, paid, expired, cancelled
    expires_at: str


def _view(s) -> SaleView:
    return SaleView(
        id=str(s.id), amount=s.amount, description=s.description, photo_fee=s.photo_fee,
        total_amount=s.amount + (s.photo_fee or 0), status=s.status, expires_at=s.expires_at.isoformat(),
    )


async def _sale(session: AsyncSession, sale_id: str, *, lock: bool = False):
    if not _is_uuid(sale_id):
        return None
    await sales.expire_due(session)
    return (
        await session.execute(
            text("select * from open_sales where id = cast(:id as uuid)" + (" for update" if lock else "")), {"id": sale_id}
        )
    ).one_or_none()


# --- Public: the stall page --------------------------------------------------------------


class Stall(BaseModel):
    maker: Party
    site: str | None
    stall_code: str
    business_type: str          # product or service (a service includes photography, MUST 15)
    sale: SaleView | None       # the open (or being-paid) sale; None = waiting for the seller


@public_router.get("/stalls/{stall_code}", response_model=Stall)
async def stall(stall_code: str, session: Annotated[AsyncSession, Depends(get_session)]) -> Stall:
    maker = await sales.maker_by_stall_code(session, stall_code)
    if maker is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "This stall isn't registered with Sawa Split.")
    if not maker.active:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "This creator isn't taking payments through Sawa Split right now.")
    await sales.expire_due(session, maker.id)
    await session.commit()
    current = (
        await session.execute(
            text("select * from open_sales where producer_id = :pid and status in ('open', 'paying')"), {"pid": maker.id}
        )
    ).one_or_none()
    return Stall(
        maker=Party(id=str(maker.id), name=maker.name), site=maker.site, stall_code=maker.stall_code,
        business_type=maker.business_type, sale=_view(current) if current else None,
    )


class Quote(CheckoutResponse):
    sale: SaleView
    business_type: str          # product or service
    referrer_type: str | None   # driver, tour_guide or agent, when the referral applies
    referral_error: str | None  # set when the code given can't earn a referral: unknown or
                                # inactive, no tour running, or the tour is full (MUST 17)


async def _quote(session: AsyncSession, s, referral_code: str | None, join_token: str | None = None) -> Quote:
    maker = (
        await session.execute(
            text("select id, name, site, default_split_driver_pct, business_type from producers where id = :id"),
            {"id": s.producer_id},
        )
    ).one()
    referrer, error = None, None
    if referral_code and referral_code.strip():
        referrer = await sales.referrer_by_code(session, referral_code)
        if referrer is None:
            error = UNKNOWN_CODE
        else:
            tour, error = await tours.check_referral(session, referrer, join_token)
            if tour is None:
                referrer = None
            await session.commit()  # keeps a just-closed past tour
    split = sales.compute_sale_split(s.amount, s.photo_fee, Decimal(maker.default_split_driver_pct), referrer is not None)
    pct = sales.FIXED_REFERRER_PCT if split["split_model"] == "fixed" else Decimal(maker.default_split_driver_pct)
    return Quote(
        producer=Party(id=str(maker.id), name=maker.name),
        site=maker.site,
        # The referrer's first name only; the code itself is what the tourist typed.
        driver=Party(id=str(referrer.id), name=sales.first_name(referrer.name)) if referrer else None,
        driver_split_pct=pct if referrer else Decimal(0),
        product=ProductComponent(
            amount=s.amount, maker_amount=split["product_maker_amount"], driver_amount=split["product_driver_amount"],
            fund_amount=split["fund_amount"],
        ),
        photo=PhotoComponent(amount=s.photo_fee) if s.photo_fee else None,
        total_amount=split["total_amount"], maker_amount=split["maker_amount"], driver_amount=split["driver_amount"],
        fund_amount=split["fund_amount"], split_model=split["split_model"],
        sale=_view(s), business_type=maker.business_type,
        referrer_type=referrer.referrer_type if referrer else None, referral_error=error,
    )


@public_router.get("/sales/{sale_id}", response_model=Quote)
async def quote(
    sale_id: str,
    session: Annotated[AsyncSession, Depends(get_session)],
    ref: str | None = None,
    join: str | None = None,
) -> Quote:
    """The sale and its breakdown, computed here (SCOPE_V2 MUST 6), for an optional
    referral code and the tourist's tour join token. A code that can't earn a referral
    (unknown, inactive, no tour, tour full) is reported, not applied. Uses up no join."""
    s = await _sale(session, sale_id)
    await session.commit()
    if s is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Sale not found.")
    return await _quote(session, s, ref, join)


class PayRequest(BaseModel):
    payment_method: Literal["mpesa", "cash"]
    phone: str | None = None
    referral_code: str | None = None
    join_token: str | None = None   # from the tourist's tour pass (MUST 17)

    @model_validator(mode="after")
    def _phone(self):
        if self.payment_method == "mpesa" and not self.phone:
            raise ValueError("phone is required for M-Pesa (where the STK prompt is sent).")
        return self


@public_router.post("/sales/{sale_id}/pay", response_model=InitiateTransactionResponse, status_code=status.HTTP_201_CREATED)
async def pay(
    sale_id: str, body: PayRequest, session: Annotated[AsyncSession, Depends(get_session)]
) -> InitiateTransactionResponse:
    """Pays an open sale by M-Pesa or cash (the same flows as a price card). The sale is
    held while the payment runs, so it can't be paid twice. A referral code earns its
    share only through the referrer's running tour (MUST 17): with the tourist's join, or
    by joining now if there's a seat; otherwise the payment is refused with the reason,
    and the tourist can pay without the code."""
    s = await _sale(session, sale_id, lock=True)
    if s is None:
        await session.rollback()
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Sale not found.")
    if s.status != "open":
        await session.commit()  # keeps a just-applied expiry
        raise HTTPException(status.HTTP_409_CONFLICT, REFUSALS[s.status])
    maker = (
        await session.execute(text("select active, default_split_driver_pct from producers where id = :id"), {"id": s.producer_id})
    ).one()
    if not maker.active:
        await session.rollback()
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "This creator isn't taking payments through Sawa Split right now.")
    referrer, tour = None, None
    if body.referral_code and body.referral_code.strip():
        referrer = await sales.referrer_by_code(session, body.referral_code)
        if referrer is None:
            await session.rollback()
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, UNKNOWN_CODE)
        try:
            tour = await tours.referral_for_payment(session, referrer, body.join_token)
        except tours.TourRefused as exc:
            await session.rollback()
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc)) from exc
    split = sales.compute_sale_split(s.amount, s.photo_fee, Decimal(maker.default_split_driver_pct), referrer is not None)
    await session.execute(text("update open_sales set status = 'paying' where id = :id"), {"id": s.id})
    return await start_payment(
        session,
        producer_id=s.producer_id,
        driver_id=referrer.id if referrer else None,
        payment_method=body.payment_method,
        phone=body.phone,
        product_amount=s.amount,
        photo_amount=s.photo_fee,
        split=split,
        open_sale_id=s.id,
        tour_id=tour.id if tour else None,
    )


# --- Maker: create, current, cancel ------------------------------------------------------


class NewSale(BaseModel):
    amount: Decimal = Field(gt=0)
    description: str | None = Field(default=None, max_length=200)
    photo: bool = False


class MakerSale(SaleView):
    referrer_first_name: str | None   # once a payment has started
    payment_method: str | None
    payment_status: str | None        # the latest payment's transaction status
    transaction_id: str | None        # the latest payment, for the Confirm button in the sale card
    maker_amount: Decimal | None      # the latest payment's split: "You get X · <Guide> Y"
    driver_amount: Decimal | None
    maker_confirmed: bool = False     # cash: who has confirmed so far
    driver_confirmed: bool = False


async def _producer_id(session: AsyncSession, authorization: str | None) -> str:
    role, party_id = await resolve_producer_or_driver(session, authorization)
    if role != "producer":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only a creator can do this.")
    return party_id


async def _maker_sale(session: AsyncSession, s) -> MakerSale:
    payment = (
        await session.execute(
            text(
                "select t.id, t.payment_method, t.status, t.maker_amount, t.driver_amount, t.maker_confirmed_at, "
                "t.driver_confirmed_at, d.name as driver_name from transactions t "
                "left join drivers d on d.id = t.driver_id where t.open_sale_id = :id order by t.created_at desc limit 1"
            ),
            {"id": s.id},
        )
    ).one_or_none()
    return MakerSale(
        **_view(s).model_dump(),
        referrer_first_name=sales.first_name(payment.driver_name) if payment and payment.driver_name else None,
        payment_method=payment.payment_method if payment else None,
        payment_status=payment.status if payment else None,
        transaction_id=str(payment.id) if payment else None,
        maker_amount=payment.maker_amount if payment else None,
        driver_amount=payment.driver_amount if payment else None,
        maker_confirmed=bool(payment and payment.maker_confirmed_at),
        driver_confirmed=bool(payment and payment.driver_confirmed_at),
    )


@router.post("", response_model=MakerSale, status_code=status.HTTP_201_CREATED)
async def create_sale(
    body: NewSale, session: Annotated[AsyncSession, Depends(get_session)], authorization: Annotated[str | None, Header()] = None
) -> MakerSale:
    pid = await _producer_id(session, authorization)
    if body.amount != body.amount.to_integral_value():
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Enter the amount in whole shillings, with no cents.")
    maker = (await session.execute(text("select photo_fee, business_type from producers where id = :id"), {"id": pid})).one()
    if body.photo and maker.business_type == "service":
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Photography is included in a service's price.")
    if body.photo and not maker.photo_fee:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "You don't have a photo-consent fee set.")
    photo_fee = maker.photo_fee if body.photo else None
    if body.amount + (photo_fee or 0) < MIN_TRANSACTION_AMOUNT:  # rule 5
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"The total must be at least KSh {MIN_TRANSACTION_AMOUNT}.")
    await sales.expire_due(session, pid)
    active = (
        await session.execute(text("select status from open_sales where producer_id = :pid and status in ('open', 'paying')"), {"pid": pid})
    ).one_or_none()
    if active is not None:
        await session.commit()
        raise HTTPException(status.HTTP_409_CONFLICT, "You already have an open sale. Cancel it, or wait until it's paid or expires.")
    s = (
        await session.execute(
            text(
                "insert into open_sales (producer_id, amount, description, photo_fee, expires_at) "
                "values (:pid, :amount, :description, :photo_fee, :expires) returning *"
            ),
            {"pid": pid, "amount": body.amount, "description": (body.description or "").strip() or None,
             "photo_fee": photo_fee, "expires": sales.new_expiry()},
        )
    ).one()
    await session.commit()
    return await _maker_sale(session, s)


@router.get("/current", response_model=MakerSale | None)
async def current_sale(
    session: Annotated[AsyncSession, Depends(get_session)], authorization: Annotated[str | None, Header()] = None
) -> MakerSale | None:
    """The maker's latest sale, whatever its status, for the New sale screen's live status."""
    pid = await _producer_id(session, authorization)
    await sales.expire_due(session, pid)
    await session.commit()
    s = (
        await session.execute(text("select * from open_sales where producer_id = :pid order by created_at desc limit 1"), {"pid": pid})
    ).one_or_none()
    return await _maker_sale(session, s) if s else None


@router.post("/{sale_id}/cancel", response_model=MakerSale)
async def cancel_sale(
    sale_id: str, session: Annotated[AsyncSession, Depends(get_session)], authorization: Annotated[str | None, Header()] = None
) -> MakerSale:
    pid = await _producer_id(session, authorization)
    s = await _sale(session, sale_id, lock=True)
    if s is None or str(s.producer_id) != pid:
        await session.rollback()
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Sale not found.")
    if s.status != "open":
        await session.commit()
        raise HTTPException(status.HTTP_409_CONFLICT, REFUSALS.get(s.status, "This sale can't be cancelled."))
    s = (
        await session.execute(
            text("update open_sales set status = 'cancelled', cancelled_at = now() where id = :id returning *"), {"id": s.id}
        )
    ).one()
    await session.commit()
    return await _maker_sale(session, s)
