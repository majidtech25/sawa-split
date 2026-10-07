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

from .. import links
from ..db import get_session
from ..ledger import compute_split
from .transactions import MIN_TRANSACTION_AMOUNT

router = APIRouter(prefix="/public", tags=["public"])


class Party(BaseModel):
    id: str
    name: str


class ProductComponent(BaseModel):
    amount: Decimal
    maker_amount: Decimal
    driver_amount: Decimal


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
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "This maker isn't taking payments through Sawa Split right now.")

    driver = None
    if driver_qr:
        driver = (
            await session.execute(text("select id, name, active from drivers where qr_code = :qr"), {"qr": driver_qr})
        ).one_or_none()
        if driver is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "This driver QR code isn't registered.")
        if not driver.active:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "This driver isn't active, so the referral can't be recorded.")

    if product is None and photo is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "No price was given for the product or photo consent.")
    if product is not None and not producer.charges_product:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "This maker doesn't charge for a product.")
    if photo is not None and not producer.charges_photo:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "This maker doesn't charge for photo consent.")

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


class ReceiptResponse(BaseModel):
    id: str
    status: str
    payment_method: str
    producer_name: str
    site: str | None
    driver_name: str | None
    product_amount: Decimal | None
    product_maker_amount: Decimal | None
    product_driver_amount: Decimal | None
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
                select t.*, p.name as producer_name, p.site, d.name as driver_name
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
        driver_name=row.driver_name,
        product_amount=row.product_amount,
        product_maker_amount=row.product_maker_amount,
        product_driver_amount=row.product_driver_amount,
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
