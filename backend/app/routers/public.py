"""Public, no-login reads for the tourist's screens (CLAUDE.md section 5: the
tourist has no account). Each returns only what the price card or receipt shows —
never a phone number, Till, or another party's balance."""

import uuid
from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from .. import links, sales, tours
from ..config import settings
from ..db import get_session
from ..ledger import compute_split
from .transactions import MIN_TRANSACTION_AMOUNT, require_whole_shillings

router = APIRouter(prefix="/public", tags=["public"])


class Party(BaseModel):
    id: str
    name: str


class ProductComponent(BaseModel):
    amount: Decimal
    maker_amount: Decimal
    driver_amount: Decimal
    fund_amount: Decimal = Decimal(0)   # the Conservation fund's 5% (fixed split, migration 0020)


class PhotoComponent(BaseModel):
    amount: Decimal


class CheckoutResponse(BaseModel):
    producer: Party
    site: str | None
    driver: Party | None
    driver_split_pct: Decimal
    product: ProductComponent | None
    photo: PhotoComponent | None
    total_amount: Decimal
    maker_amount: Decimal
    driver_amount: Decimal
    fund_amount: Decimal = Decimal(0)
    split_model: str = "legacy"         # 'fixed': 80% creator, 15% site intermediary, 5% fund


class ConfigResponse(BaseModel):
    split_model: str


@router.get("/config", response_model=ConfigResponse)
async def config() -> ConfigResponse:
    """What the screens need to know about this deployment: the split model, so
    registration can show "Fixed: 15%" instead of the coordinator-set %."""
    return ConfigResponse(split_model=settings.split_model)


@router.get("/checkout/{producer_id}", response_model=CheckoutResponse)
async def checkout(
    producer_id: str,
    session: Annotated[AsyncSession, Depends(get_session)],
    product: Annotated[Decimal | None, Query(gt=0)] = None,
    photo: Annotated[Decimal | None, Query(gt=0)] = None,
    driver_qr: str | None = None,
    sig: str | None = None,
) -> CheckoutResponse:
    """The price-transparency card's data, computed by the same split the ledger
    uses, so the card shows exactly what will be charged and recorded. Only a link
    signed by the API (app/links.py) is accepted, so nobody can edit its prices or
    driver. Rejects an inactive producer or an unregistered/inactive driver QR here,
    at scan time, before any payment starts (rule 8)."""
    if not links.is_valid(sig, producer_id, product, photo, driver_qr):
        raise HTTPException(status.HTTP_403_FORBIDDEN, links.INVALID_CARD)
    return await build_checkout(session, producer_id, product, photo, driver_qr)


async def build_checkout(session: AsyncSession, producer_id: str, product, photo, driver_qr) -> CheckoutResponse:
    """Validates a stall, its prices and driver, and computes the card. Shared by the
    public checkout and the coordinator's price-card generator."""
    producer = (
        await session.execute(
            text(
                "select id, name, site, default_split_driver_pct, charges_product, charges_photo, active "
                "from producers where id = cast(:id as uuid)"
            ),
            {"id": producer_id},
        )
    ).one_or_none() if _is_uuid(producer_id) else None
    if producer is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "This stall isn't registered with Sawa Split.")
    if not producer.active:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "This creator isn't taking payments through Sawa Split right now.")

    driver = None
    if driver_qr:
        driver = (
            await session.execute(text("select id, name, active from drivers where qr_code = :qr"), {"qr": driver_qr})
        ).one_or_none()
        if driver is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "This site intermediary QR code isn't registered.")
        if not driver.active:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "This site intermediary isn't active, so the referral can't be recorded.")

    if product is None and photo is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "No price was given for the product or photo consent.")
    require_whole_shillings(product, photo)
    if product is not None and not producer.charges_product:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "This creator doesn't charge for a product.")
    if photo is not None and not producer.charges_photo:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "This creator doesn't charge for photo consent.")

    split = compute_split(
        product_amount=product,
        photo_amount=photo,
        driver_pct=Decimal(producer.default_split_driver_pct),
        has_driver=driver is not None,
    )
    if split["total_amount"] < MIN_TRANSACTION_AMOUNT:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"The total must be at least KSh {MIN_TRANSACTION_AMOUNT}.")

    return CheckoutResponse(
        producer=Party(id=str(producer.id), name=producer.name),
        site=producer.site,
        driver=Party(id=str(driver.id), name=driver.name) if driver else None,
        driver_split_pct=Decimal(producer.default_split_driver_pct) if driver else Decimal(0),
        product=ProductComponent(
            amount=product, maker_amount=split["product_maker_amount"], driver_amount=split["product_driver_amount"]
        )
        if product is not None
        else None,
        photo=PhotoComponent(amount=photo) if photo is not None else None,
        total_amount=split["total_amount"],
        maker_amount=split["maker_amount"],
        driver_amount=split["driver_amount"],
    )


class DriverVerification(BaseModel):
    first_name: str
    referral_code: str          # for the tourist's tour pass, whichever code was scanned
    referrer_type: str          # driver, tour_guide or agent (MUST 15)
    active: bool                # False: suspended or closed; the badge says "Not active", no reason (MUST 12)
    tour_running: bool          # MUST 17: whether a tourist can join right now
    tour_full: bool


@router.get("/drivers/{qr_code}", response_model=DriverVerification)
async def verify_driver(
    qr_code: str, session: Annotated[AsyncSession, Depends(get_session)]
) -> DriverVerification:
    """What a camera scan of a driver's QR card opens: proof the referrer is registered,
    and whether they're active and running a tour. Takes the referral code
    (case-insensitive, e.g. JAMES) or the old QR code (QR-DRIVER-001). First name only:
    no phone, Till, earnings, or why an account isn't active."""
    driver = await sales.referrer_by_code(session, qr_code, active_only=False)
    if driver is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "This isn't a registered Sawa Split site intermediary.")
    tour = await tours.open_tour(session, driver.id) if driver.active else None
    full = tour is not None and await tours.joined(session, tour.id) >= tour.group_size
    await session.commit()  # keeps a just-closed past tour
    return DriverVerification(
        first_name=sales.first_name(driver.name), referral_code=driver.referral_code,
        referrer_type=driver.referrer_type, active=driver.active, tour_running=tour is not None, tour_full=full,
    )


class JoinResponse(BaseModel):
    join_token: str             # kept in the tourist's tour pass; only its hash is stored
    first_name: str
    referral_code: str
    ends_at: str                # the tour's midnight EAT


@router.post("/drivers/{code}/join", response_model=JoinResponse, status_code=status.HTTP_201_CREATED)
async def join_tour(code: str, session: Annotated[AsyncSession, Depends(get_session)]) -> JoinResponse:
    """A tourist joins the referrer's running tour ("Use X as my guide today", or the
    code typed at checkout). Counted here, on the server (MUST 17). Refused with the
    reason when there's no tour running or it's full."""
    driver = await sales.referrer_by_code(session, code)
    if driver is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "That intermediary code isn't registered with Sawa Split.")
    try:
        token, tour = await tours.join(session, driver)
    except tours.TourRefused as exc:
        await session.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from exc
    await session.commit()
    return JoinResponse(
        join_token=token, first_name=sales.first_name(driver.name), referral_code=driver.referral_code,
        ends_at=tour.ends_at.isoformat(),
    )


class ReceiptResponse(BaseModel):
    id: str
    status: str
    payment_method: str
    producer_name: str
    site: str | None
    driver_name: str | None
    business_type: str
    product_amount: Decimal | None
    product_maker_amount: Decimal | None
    product_driver_amount: Decimal | None
    fund_amount: Decimal               # the Conservation fund's share, as stored (0 for legacy)
    split_model: str
    photo_amount: Decimal | None
    total_amount: Decimal
    stk_receipt: str | None
    created_at: str
    confirmation_deadline: str | None
    maker_confirmed: bool
    driver_confirmed: bool
    tourist_confirmed: bool


@router.get("/transactions/{transaction_id}", response_model=ReceiptResponse)
async def receipt(transaction_id: str, session: Annotated[AsyncSession, Depends(get_session)]) -> ReceiptResponse:
    """The tourist's confirmation screen polls this. The id is an unguessable UUID
    handed to the tourist's own browser by /transactions/initiate."""
    row = (
        await session.execute(
            text(
                """
                select t.*, p.name as producer_name, p.site, p.business_type, d.name as driver_name
                from transactions t
                join producers p on p.id = t.producer_id
                left join drivers d on d.id = t.driver_id
                where t.id = cast(:id as uuid)
                """
            ),
            {"id": transaction_id},
        )
    ).one_or_none() if _is_uuid(transaction_id) else None
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Payment not found.")
    return ReceiptResponse(
        id=str(row.id),
        status=row.status,
        payment_method=row.payment_method,
        producer_name=row.producer_name,
        site=row.site,
        driver_name=sales.first_name(row.driver_name) if row.driver_name else None,  # first name only, as at checkout
        business_type=row.business_type,
        product_amount=row.product_amount,
        product_maker_amount=row.product_maker_amount,
        product_driver_amount=row.product_driver_amount,
        fund_amount=row.fund_amount,
        split_model=row.split_model,
        photo_amount=row.photo_amount,
        total_amount=row.total_amount,
        stk_receipt=row.stk_receipt,
        created_at=row.created_at.isoformat(),
        confirmation_deadline=row.confirmation_deadline.isoformat() if row.confirmation_deadline else None,
        maker_confirmed=row.maker_confirmed_at is not None,
        driver_confirmed=row.driver_confirmed_at is not None,
        tourist_confirmed=row.tourist_confirmed_at is not None,
    )


def _is_uuid(value: str) -> bool:
    try:
        uuid.UUID(value)
    except ValueError:
        return False
    return True
