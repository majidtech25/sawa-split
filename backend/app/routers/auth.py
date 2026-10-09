import secrets
from typing import Annotated, Any, Literal, Union

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from .. import lifecycle, supabase_auth
from ..db import get_session
from ..pin import hash_pin, verify_pin
from ..security import require_admin

router = APIRouter(prefix="/auth", tags=["auth"])

Pin = Annotated[str, Field(pattern=r"^\d{4}$")]


class OnboardProducer(BaseModel):
    role: Literal["producer"]
    phone: str
    pin: Pin
    name: str
    till: str
    site: str | None = None
    default_split_driver_pct: float = Field(le=40)
    charges_product: bool = True
    charges_photo: bool = False


class OnboardDriver(BaseModel):
    role: Literal["driver"]
    phone: str
    pin: Pin
    name: str
    till: str
    qr_code: str


class OnboardCoordinator(BaseModel):
    role: Literal["coordinator"]
    phone: str
    pin: Pin


OnboardRequest = Annotated[
    Union[OnboardProducer, OnboardDriver, OnboardCoordinator], Field(discriminator="role")
]


class OnboardResponse(BaseModel):
    role: str
    id: str | None = None
    auth_user_id: str


async def _create_auth_account(session: AsyncSession, *, phone: str, pin: str, is_admin: bool) -> str:
    """Creates the Supabase Auth user (with a random password the human never sees,
    since Supabase Cloud's password minimum can't go below 6 chars) and stores the
    bcrypt-hashed PIN in auth_credentials. Returns the new auth_user_id."""
    auth_password = secrets.token_urlsafe(32)
    app_metadata = {"is_admin": True} if is_admin else {}
    auth_user = await supabase_auth.create_user(phone=phone, pin=auth_password, app_metadata=app_metadata)
    auth_user_id = auth_user["id"]
    try:
        await session.execute(
            text(
                """
                insert into auth_credentials (auth_user_id, phone, pin_hash, auth_password)
                values (:auth_user_id, :phone, :pin_hash, :auth_password)
                """
            ),
            {
                "auth_user_id": auth_user_id,
                "phone": phone,
                "pin_hash": hash_pin(pin),
                "auth_password": auth_password,
            },
        )
    except Exception:
        await supabase_auth.delete_user(auth_user_id)
        raise
    return auth_user_id


@router.post("/onboard", response_model=OnboardResponse)
async def onboard(
    body: OnboardRequest,
    _admin: Annotated[dict[str, Any], Depends(require_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> OnboardResponse:
    # CLAUDE.md rule 3: the 60% maker floor is validated when the split is set, not just at
    # transaction time — the >40 case is already rejected by OnboardProducer's Field(le=40)
    # above, before any Auth or DB side effect.
    if body.role == "producer" and not (body.charges_product or body.charges_photo):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Must charge for product, photo, or both.")

    try:
        auth_user_id = await _create_auth_account(
            session, phone=body.phone, pin=body.pin, is_admin=body.role == "coordinator"
        )
    except supabase_auth.SupabaseAuthError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, exc.detail) from exc
    except Exception as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Could not create credentials: {exc}") from exc

    if body.role == "coordinator":
        await session.commit()
        return OnboardResponse(role="coordinator", auth_user_id=auth_user_id)

    try:
        if body.role == "producer":
            row = (
                await session.execute(
                    text(
                        """
                        insert into producers
                            (name, phone, till, site, default_split_driver_pct, charges_product, charges_photo)
                        values
                            (:name, :phone, :till, :site, :default_split_driver_pct, :charges_product, :charges_photo)
                        returning id
                        """
                    ),
                    body.model_dump(exclude={"role", "pin"}),
                )
            ).one()
        else:
            row = (
                await session.execute(
                    text(
                        """
                        insert into drivers (name, phone, till, qr_code)
                        values (:name, :phone, :till, :qr_code)
                        returning id
                        """
                    ),
                    body.model_dump(exclude={"role", "pin"}),
                )
            ).one()
        await session.commit()
    except Exception as exc:
        await session.rollback()
        # Best-effort compensation: don't leave a login-capable account with no domain row.
        await supabase_auth.delete_user(auth_user_id)
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Could not create {body.role} record: {exc}") from exc

    return OnboardResponse(role=body.role, id=str(row.id), auth_user_id=auth_user_id)


class LoginRequest(BaseModel):
    phone: str
    pin: Pin


class LoginResponse(BaseModel):
    access_token: str
    refresh_token: str
    role: Literal["producer", "driver", "coordinator"]
    producer_id: str | None = None
    driver_id: str | None = None


@router.post("/login", response_model=LoginResponse)
async def login(
    body: LoginRequest, session: Annotated[AsyncSession, Depends(get_session)]
) -> LoginResponse:
    credentials = (
        await session.execute(
            text("select pin_hash, auth_password from auth_credentials where phone = :phone"),
            {"phone": body.phone},
        )
    ).one_or_none()
    if credentials is None or not verify_pin(body.pin, credentials.pin_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid phone or PIN")

    # Rule 17: a suspended or closed maker/driver can't log in, and is told why. Checked
    # only after the PIN, so a wrong PIN learns nothing about the account.
    for party_type, table in (("maker", "producers"), ("driver", "drivers")):
        row = (
            await session.execute(text(f"select id, account_status from {table} where phone = :phone"), {"phone": body.phone})
        ).one_or_none()
        if row is not None:
            refusal = await lifecycle.login_refusal(session, party_type, row.id, row.account_status)
            if refusal:
                raise HTTPException(status.HTTP_403_FORBIDDEN, refusal)

    try:
        auth_response = await supabase_auth.sign_in_with_password(
            phone=body.phone, pin=credentials.auth_password
        )
    except supabase_auth.SupabaseAuthError as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid phone or PIN") from exc

    user = auth_response["user"]
    if (user.get("app_metadata") or {}).get("is_admin"):
        return LoginResponse(
            access_token=auth_response["access_token"],
            refresh_token=auth_response["refresh_token"],
            role="coordinator",
        )

    producer = (
        await session.execute(text("select id from producers where phone = :phone"), {"phone": body.phone})
    ).one_or_none()
    if producer:
        return LoginResponse(
            access_token=auth_response["access_token"],
            refresh_token=auth_response["refresh_token"],
            role="producer",
            producer_id=str(producer.id),
        )

    driver = (
        await session.execute(text("select id from drivers where phone = :phone"), {"phone": body.phone})
    ).one_or_none()
    if driver:
        return LoginResponse(
            access_token=auth_response["access_token"],
            refresh_token=auth_response["refresh_token"],
            role="driver",
            driver_id=str(driver.id),
        )

    raise HTTPException(status.HTTP_403_FORBIDDEN, "Account exists but is not fully provisioned")
