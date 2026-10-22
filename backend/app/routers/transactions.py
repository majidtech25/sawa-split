import secrets
import time
from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Header, HTTPException, status
from pydantic import BaseModel, model_validator
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from .. import daraja, lifecycle, links, sales, supabase_auth
from ..caller import normalize_phone
from ..config import settings
from ..db import get_session
from ..ledger import compute_split, record_cash_sale

router = APIRouter(prefix="/transactions", tags=["transactions"])

MIN_TRANSACTION_AMOUNT = Decimal("50")  # CLAUDE.md section 4 rule 5 — business floor, not Daraja's own KES 1 floor.

# M-Pesa charges whole shillings (the STK Push sends int(amount)), so a price with cents
# would charge less than the ledger credits. Prices are refused unless whole.
WHOLE_SHILLINGS = "Prices must be whole shillings, with no cents (for example 150, not 150.50)."


def require_whole_shillings(*amounts) -> None:
    for amount in amounts:
        if amount is not None and Decimal(amount) != Decimal(amount).to_integral_value():
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, WHOLE_SHILLINGS)


# CLAUDE.md section 5: the public pay-initiate endpoint is rate-limited per phone
# number, so nobody can flood a stranger's phone with STK prompts. In-process memory
# is enough for the one API process this runs as (app/scheduler.py says why one).
STK_LIMIT_PER_PHONE = 5
STK_LIMIT_WINDOW_SECONDS = 600
_stk_attempts: dict[str, deque] = defaultdict(deque)


def _check_stk_rate_limit(phone: str) -> None:
    now = time.monotonic()
    attempts = _stk_attempts[normalize_phone(phone).removeprefix("0")[-9:]]
    while attempts and now - attempts[0] > STK_LIMIT_WINDOW_SECONDS:
        attempts.popleft()
    if len(attempts) >= STK_LIMIT_PER_PHONE:
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            "Too many payment requests to this phone number. Wait a few minutes, then try again.",
        )
    attempts.append(now)


class InitiateTransactionRequest(BaseModel):
    producer_id: str
    driver_id: str | None = None
    payment_method: Literal["mpesa", "cash"]
    phone: str | None = None  # required for mpesa — where Daraja sends the STK prompt
    product_enabled: bool = False
    product_amount: Decimal | None = None
    photo_enabled: bool = False
    photo_amount: Decimal | None = None
    # The price card's link signature (app/links.py): the stall, prices and driver
    # being paid for must be exactly the ones the API signed.
    link_sig: str | None = None

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
        if self.payment_method == "mpesa" and not self.phone:
            raise ValueError("phone is required for payment_method 'mpesa' (where the STK prompt is sent).")
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


async def start_payment(
    session: AsyncSession,
    *,
    producer_id,
    driver_id,
    payment_method: str,
    phone: str | None,
    product_amount: Decimal | None,
    photo_amount: Decimal | None,
    split: dict,
    open_sale_id=None,
    tour_id=None,
) -> InitiateTransactionResponse:
    """Creates the transaction and starts the payment: the M-Pesa STK Push, or a cash sale
    waiting for its two confirmations (rule 12). Shared by the signed price card
    (initiate, below) and an open sale (app/routers/sales.py), which have already
    checked the stall, the referrer and the amounts."""
    confirmation_deadline = None
    tourist_confirm_token = None
    if payment_method == "mpesa":
        _check_stk_rate_limit(phone)
        txn_status = "initiated"
    else:
        txn_status = "cash_unconfirmed"
        confirmation_deadline = datetime.now(timezone.utc) + timedelta(
            minutes=settings.cash_confirm_window_minutes
        )
        if driver_id is None:
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
                     total_amount, maker_amount, driver_amount, status, confirmation_deadline, open_sale_id, tour_id)
                values
                    (:producer_id, :driver_id, :payment_method, :product_enabled, :product_amount,
                     :product_maker_amount, :product_driver_amount, :photo_enabled, :photo_amount,
                     :total_amount, :maker_amount, :driver_amount, :status, :confirmation_deadline, :open_sale_id, :tour_id)
                returning id
                """
            ),
            {
                "producer_id": producer_id,
                "driver_id": driver_id,
                "payment_method": payment_method,
                "product_enabled": product_amount is not None,
                "product_amount": product_amount,
                "product_maker_amount": split["product_maker_amount"],
                "product_driver_amount": split["product_driver_amount"],
                "photo_enabled": photo_amount is not None,
                "photo_amount": photo_amount,
                "total_amount": split["total_amount"],
                "maker_amount": split["maker_amount"],
                "driver_amount": split["driver_amount"],
                "status": txn_status,
                "confirmation_deadline": confirmation_deadline,
                "open_sale_id": open_sale_id,
                "tour_id": tour_id,
            },
        )
    ).one()
    # Secrets live where no browser can read them, not even the maker's (migration 0012).
    await session.execute(
        text("insert into transaction_secrets (transaction_id, tourist_confirm_token) values (:id, :token)"),
        {"id": row.id, "token": tourist_confirm_token},
    )
    await session.commit()

    if payment_method == "mpesa":
        # CLAUDE.md rule 6: a failed/undeliverable STK push gets no ledger entry and no
        # auto-retry — mark it failed immediately rather than leaving a dead "initiated"
        # row waiting on a callback that will never arrive.
        try:
            stk_response = await daraja.stk_push(
                phone=phone,
                amount=split["total_amount"],
                account_reference=str(row.id)[:12],
                transaction_desc="Sawa Split payment",
                # Signed per transaction, so only Daraja can call it back (app/links.py).
                callback_url=f"{settings.daraja_callback_base_url}/daraja/stk-callback/{links.callback_token(row.id)}",
            )
            if str(stk_response.get("ResponseCode")) != "0":
                raise RuntimeError(stk_response.get("ResponseDescription", "STK push rejected"))
        except Exception as exc:
            await session.execute(
                text("update transactions set status = 'failed' where id = :id"), {"id": row.id}
            )
            await sales.payment_finished(session, row.id, paid=False)  # an open sale can be paid again
            await session.commit()
            raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"Could not initiate M-Pesa payment: {exc}") from exc

        await session.execute(
            text("update transaction_secrets set checkout_request_id = :crid where transaction_id = :id"),
            {"crid": stk_response["CheckoutRequestID"], "id": row.id},
        )
        await session.commit()

    return InitiateTransactionResponse(
        id=str(row.id),
        status=txn_status,
        payment_method=payment_method,
        product_amount=product_amount,
        product_maker_amount=split["product_maker_amount"],
        product_driver_amount=split["product_driver_amount"],
        photo_amount=photo_amount,
        total_amount=split["total_amount"],
        maker_amount=split["maker_amount"],
        driver_amount=split["driver_amount"],
        confirmation_deadline=confirmation_deadline.isoformat() if confirmation_deadline else None,
        tourist_confirm_token=tourist_confirm_token,
    )


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
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Creator not found")
    if not producer.active:
        # CLAUDE.md rule 8: rejected at scan time, before payment initiation.
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Creator is inactive")
    if body.product_enabled and not producer.charges_product:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "This creator does not charge for product.")
    if body.photo_enabled and not producer.charges_photo:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "This creator does not charge for photo consent.")

    require_whole_shillings(body.product_amount, body.photo_amount)

    driver_qr = None
    if body.driver_id is not None:
        driver = (
            await session.execute(text("select active, qr_code from drivers where id = :id"), {"id": body.driver_id})
        ).one_or_none()
        if driver is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Site intermediary not found")
        if not driver.active:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Site intermediary is inactive")
        driver_qr = driver.qr_code

    if not links.is_valid(
        body.link_sig,
        body.producer_id,
        body.product_amount if body.product_enabled else None,
        body.photo_amount if body.photo_enabled else None,
        driver_qr,
    ):
        raise HTTPException(status.HTTP_403_FORBIDDEN, links.INVALID_CARD)

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

    return await start_payment(
        session,
        producer_id=body.producer_id,
        driver_id=body.driver_id,
        payment_method=body.payment_method,
        phone=body.phone,
        product_amount=body.product_amount,
        photo_amount=body.photo_amount,
        split=split,
    )


class TransactionStateResponse(BaseModel):
    id: str
    status: str


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
        await sales.payment_finished(session, transaction_id, paid=False)
        await session.commit()
        raise HTTPException(status.HTTP_409_CONFLICT, "Confirmation window has expired.")
    if row.status == "cash_expired":
        raise HTTPException(status.HTTP_409_CONFLICT, "Confirmation window has expired.")
    if row.status == "cash_confirmed":
        return TransactionStateResponse(id=str(row.id), status=row.status)  # idempotent
    if row.status != "cash_unconfirmed":
        raise HTTPException(status.HTTP_409_CONFLICT, f"Cannot confirm a transaction in status '{row.status}'")

    role: str
    if authorization is not None and authorization.removeprefix("Bearer ").strip():
        token = authorization.removeprefix("Bearer ").strip()
        try:
            user = await supabase_auth.get_user_from_token(token)
        except supabase_auth.SupabaseAuthError as exc:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired token") from exc
        caller_phone = normalize_phone(user.get("phone") or "")

        producer = (
            await session.execute(
                text("select id, phone, account_status from producers where id = :id"), {"id": row.producer_id}
            )
        ).one_or_none()
        driver = None
        if row.driver_id is not None:
            driver = (
                await session.execute(
                    text("select id, phone, account_status from drivers where id = :id"), {"id": row.driver_id}
                )
            ).one_or_none()

        if producer is not None and normalize_phone(producer.phone) == caller_phone:
            role, me = "maker", producer
        elif driver is not None and normalize_phone(driver.phone) == caller_phone:
            role, me = "driver", driver
        else:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Not a party to this transaction")
        refusal = await lifecycle.login_refusal(session, role, me.id, me.account_status)
        if refusal:
            raise HTTPException(status.HTTP_403_FORBIDDEN, refusal)
    elif body.tourist_token is not None:
        if row.driver_id is not None:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "This transaction has a site intermediary referral (Case A) — tourist confirmation doesn't apply.",
            )
        stored = (
            await session.execute(
                text("select tourist_confirm_token from transaction_secrets where transaction_id = :id"), {"id": row.id}
            )
        ).scalar_one_or_none()
        if not stored or not secrets.compare_digest(stored, body.tourist_token):
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

    # The cash never reaches the M-Pesa account: the maker's share is recorded as
    # held in cash and the driver's becomes a debt the maker owes (rule 12).
    await record_cash_sale(session, updated)
    await sales.payment_finished(session, updated.id, paid=True)
    await session.commit()
    return TransactionStateResponse(id=str(updated.id), status=updated.status)
