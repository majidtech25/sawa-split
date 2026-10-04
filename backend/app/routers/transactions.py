import secrets
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, Header, HTTPException, status
from pydantic import BaseModel, model_validator
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from .. import supabase_auth
from ..config import settings
from ..db import get_session
from ..ledger import compute_split, write_ledger_entries
from ..security import require_admin

router = APIRouter(prefix="/transactions", tags=["transactions"])

MIN_TRANSACTION_AMOUNT = Decimal("50")  # CLAUDE.md section 4 rule 5 — business floor, not Daraja's own KES 1 floor.


def _normalize_phone(phone: str) -> str:
    # Supabase Auth strips the leading '+' from phone claims; our tables store it with
    # one (whatever the coordinator typed at onboarding) — normalize before comparing.
    return phone.lstrip("+")


class InitiateTransactionRequest(BaseModel):
    producer_id: str
    driver_id: str | None = None
    payment_method: Literal["mpesa", "cash"]
    product_enabled: bool = False
    product_amount: Decimal | None = None
    photo_enabled: bool = False
    photo_amount: Decimal | None = None

    @model_validator(mode="after")
    def _validate_components(self):
        if not (self.product_enabled or self.photo_enabled):
            raise ValueError("Must enable product, photo, or both.")
        if self.product_enabled and self.product_amount is None:
            raise ValueError("product_amount is required when product_enabled.")
        if not self.product_enabled and self.product_amount is not None:
            raise ValueError("product_amount must be omitted when product is not enabled.")
        if self.photo_enabled and self.photo_amount is None:
            raise ValueError("photo_amount is required when photo_enabled.")
        if not self.photo_enabled and self.photo_amount is not None:
            raise ValueError("photo_amount must be omitted when photo is not enabled.")
        return self


class InitiateTransactionResponse(BaseModel):
    id: str
    status: str
    payment_method: str
    product_amount: Decimal | None = None
    product_maker_amount: Decimal | None = None
    product_driver_amount: Decimal | None = None
    photo_amount: Decimal | None = None
    total_amount: Decimal
    maker_amount: Decimal
    driver_amount: Decimal
    confirmation_deadline: str | None = None
    tourist_confirm_token: str | None = None


@router.post("/initiate", response_model=InitiateTransactionResponse, status_code=status.HTTP_201_CREATED)
async def initiate_transaction(
    body: InitiateTransactionRequest, session: Annotated[AsyncSession, Depends(get_session)]
) -> InitiateTransactionResponse:
    producer = (
        await session.execute(
            text(
                "select default_split_driver_pct, charges_product, charges_photo, active "
                "from producers where id = :id"
            ),
            {"id": body.producer_id},
        )
    ).one_or_none()
    if producer is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Producer not found")
    if not producer.active:
        # CLAUDE.md rule 8: rejected at scan time, before payment initiation.
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Producer is inactive")
    if body.product_enabled and not producer.charges_product:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "This producer does not charge for product.")
    if body.photo_enabled and not producer.charges_photo:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "This producer does not charge for photo consent.")

    if body.driver_id is not None:
        driver = (
            await session.execute(text("select active from drivers where id = :id"), {"id": body.driver_id})
        ).one_or_none()
        if driver is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Driver not found")
        if not driver.active:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Driver is inactive")

    split = compute_split(
        product_amount=body.product_amount,
        photo_amount=body.photo_amount,
        driver_pct=producer.default_split_driver_pct,
        has_driver=body.driver_id is not None,
    )
    if split["total_amount"] < MIN_TRANSACTION_AMOUNT:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY, f"Total must be at least KES {MIN_TRANSACTION_AMOUNT}."
        )

    confirmation_deadline = None
    tourist_confirm_token = None
    if body.payment_method == "mpesa":
        txn_status = "initiated"
    else:
        txn_status = "cash_unconfirmed"
        confirmation_deadline = datetime.now(timezone.utc) + timedelta(
            minutes=settings.cash_confirm_window_minutes
        )
        if body.driver_id is None:
            # Case B (walk-up, no driver) — tourist confirms via this opaque token
            # instead of a login she doesn't have (see migration 0005).
            tourist_confirm_token = secrets.token_urlsafe(32)

    row = (
        await session.execute(
            text(
                """
                insert into transactions
                    (producer_id, driver_id, payment_method, product_enabled, product_amount,
                     product_maker_amount, product_driver_amount, photo_enabled, photo_amount,
                     total_amount, maker_amount, driver_amount, status, confirmation_deadline,
                     tourist_confirm_token)
                values
                    (:producer_id, :driver_id, :payment_method, :product_enabled, :product_amount,
                     :product_maker_amount, :product_driver_amount, :photo_enabled, :photo_amount,
                     :total_amount, :maker_amount, :driver_amount, :status, :confirmation_deadline,
                     :tourist_confirm_token)
                returning id
                """
            ),
            {
                "producer_id": body.producer_id,
                "driver_id": body.driver_id,
                "payment_method": body.payment_method,
                "product_enabled": body.product_enabled,
                "product_amount": body.product_amount,
                "product_maker_amount": split["product_maker_amount"],
                "product_driver_amount": split["product_driver_amount"],
                "photo_enabled": body.photo_enabled,
                "photo_amount": body.photo_amount,
                "total_amount": split["total_amount"],
                "maker_amount": split["maker_amount"],
                "driver_amount": split["driver_amount"],
                "status": txn_status,
                "confirmation_deadline": confirmation_deadline,
                "tourist_confirm_token": tourist_confirm_token,
            },
        )
    ).one()
    await session.commit()

    return InitiateTransactionResponse(
        id=str(row.id),
        status=txn_status,
        payment_method=body.payment_method,
        product_amount=body.product_amount,
        product_maker_amount=split["product_maker_amount"],
        product_driver_amount=split["product_driver_amount"],
        photo_amount=body.photo_amount,
        total_amount=split["total_amount"],
        maker_amount=split["maker_amount"],
        driver_amount=split["driver_amount"],
        confirmation_deadline=confirmation_deadline.isoformat() if confirmation_deadline else None,
        tourist_confirm_token=tourist_confirm_token,
    )


class TransactionStateResponse(BaseModel):
    id: str
    status: str


@router.post("/{transaction_id}/fake-confirm", response_model=TransactionStateResponse)
async def fake_confirm(
    transaction_id: str,
    _admin: Annotated[dict[str, Any], Depends(require_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> TransactionStateResponse:
    """Stands in for POST /daraja/stk-callback until stage 5's real Daraja integration —
    coordinator-triggered only, since a real webhook would never be publicly callable."""
    row = (
        await session.execute(text("select * from transactions where id = :id"), {"id": transaction_id})
    ).one_or_none()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Transaction not found")
    if row.payment_method != "mpesa":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "fake-confirm only applies to mpesa transactions")
    if row.status == "confirmed":
        return TransactionStateResponse(id=str(row.id), status=row.status)  # idempotent, rule 7
    if row.status != "initiated":
        raise HTTPException(status.HTTP_409_CONFLICT, f"Cannot confirm a transaction in status '{row.status}'")

    fake_receipt = "FAKE" + secrets.token_hex(4).upper()
    updated = (
        await session.execute(
            text(
                "update transactions set status = 'confirmed', stk_receipt = :receipt "
                "where id = :id and status = 'initiated' returning *"
            ),
            {"receipt": fake_receipt, "id": transaction_id},
        )
    ).one_or_none()
    if updated is None:
        # Lost a race to a concurrent confirm — already handled, no-op.
        return TransactionStateResponse(id=str(row.id), status="confirmed")

    await write_ledger_entries(
        session,
        transaction_id=updated.id,
        producer_id=updated.producer_id,
        driver_id=updated.driver_id,
        maker_amount=updated.maker_amount,
        driver_amount=updated.driver_amount,
    )
    await session.commit()
    return TransactionStateResponse(id=str(updated.id), status=updated.status)


class ConfirmCashRequest(BaseModel):
    tourist_token: str | None = None


@router.post("/{transaction_id}/confirm", response_model=TransactionStateResponse)
async def confirm_cash(
    transaction_id: str,
    body: ConfirmCashRequest,
    session: Annotated[AsyncSession, Depends(get_session)],
    authorization: Annotated[str | None, Header()] = None,
) -> TransactionStateResponse:
    """Cash dual confirmation (CLAUDE.md section 4 rule 12). Case A (driver_id set)
    needs driver + maker; Case B (no driver) needs tourist + maker. The maker and
    driver authenticate with their normal dashboard session; the tourist (no account)
    uses the opaque token minted at /transactions/initiate."""
    row = (
        await session.execute(text("select * from transactions where id = :id"), {"id": transaction_id})
    ).one_or_none()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Transaction not found")
    if row.payment_method != "cash":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "confirm only applies to cash transactions")

    now = datetime.now(timezone.utc)
    if row.status == "cash_unconfirmed" and row.confirmation_deadline is not None and row.confirmation_deadline <= now:
        # Check-on-read expiry (CLAUDE.md rule 12) — no background sweep yet (stage 6).
        await session.execute(
            text("update transactions set status = 'cash_expired' where id = :id and status = 'cash_unconfirmed'"),
            {"id": transaction_id},
        )
        await session.commit()
        raise HTTPException(status.HTTP_409_CONFLICT, "Confirmation window has expired.")
    if row.status == "cash_expired":
        raise HTTPException(status.HTTP_409_CONFLICT, "Confirmation window has expired.")
    if row.status == "cash_confirmed":
        return TransactionStateResponse(id=str(row.id), status=row.status)  # idempotent
    if row.status != "cash_unconfirmed":
        raise HTTPException(status.HTTP_409_CONFLICT, f"Cannot confirm a transaction in status '{row.status}'")

    role: str
    if authorization is not None:
        token = authorization.removeprefix("Bearer ").strip()
        try:
            user = await supabase_auth.get_user_from_token(token)
        except supabase_auth.SupabaseAuthError as exc:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired token") from exc
        caller_phone = _normalize_phone(user.get("phone") or "")

        producer = (
            await session.execute(text("select phone from producers where id = :id"), {"id": row.producer_id})
        ).one_or_none()
        driver = None
        if row.driver_id is not None:
            driver = (
                await session.execute(text("select phone from drivers where id = :id"), {"id": row.driver_id})
            ).one_or_none()

        if producer is not None and _normalize_phone(producer.phone) == caller_phone:
            role = "maker"
        elif driver is not None and _normalize_phone(driver.phone) == caller_phone:
            role = "driver"
        else:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Not a party to this transaction")
    elif body.tourist_token is not None:
        if row.driver_id is not None:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "This transaction has a driver referral (Case A) — tourist confirmation doesn't apply.",
            )
        if row.tourist_confirm_token != body.tourist_token:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Invalid confirmation token")
        role = "tourist"
    else:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Authentication or a tourist confirmation token is required")

    confirmed_at_column = {"maker": "maker_confirmed_at", "driver": "driver_confirmed_at", "tourist": "tourist_confirmed_at"}[
        role
    ]
    await session.execute(
        text(f"update transactions set {confirmed_at_column} = coalesce({confirmed_at_column}, now()) where id = :id"),
        {"id": transaction_id},
    )

    refreshed = (
        await session.execute(text("select * from transactions where id = :id"), {"id": transaction_id})
    ).one()
    required_second_party = "driver_confirmed_at" if refreshed.driver_id is not None else "tourist_confirmed_at"
    is_complete = refreshed.maker_confirmed_at is not None and getattr(refreshed, required_second_party) is not None

    if not is_complete:
        await session.commit()
        return TransactionStateResponse(id=str(refreshed.id), status=refreshed.status)

    updated = (
        await session.execute(
            text(
                "update transactions set status = 'cash_confirmed' "
                "where id = :id and status = 'cash_unconfirmed' returning *"
            ),
            {"id": transaction_id},
        )
    ).one_or_none()
    if updated is None:
        # A concurrent call already completed it — idempotent, don't double-write the ledger.
        await session.commit()
        return TransactionStateResponse(id=str(refreshed.id), status="cash_confirmed")

    await write_ledger_entries(
        session,
        transaction_id=updated.id,
        producer_id=updated.producer_id,
        driver_id=updated.driver_id,
        maker_amount=updated.maker_amount,
        driver_amount=updated.driver_amount,
    )
    await session.commit()
    return TransactionStateResponse(id=str(updated.id), status=updated.status)
