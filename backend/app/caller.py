from fastapi import HTTPException, status
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from . import supabase_auth


def normalize_phone(phone: str) -> str:
    # Supabase Auth strips the leading '+' from phone claims; our tables store it with
    # one (whatever the coordinator typed at onboarding) — normalize before comparing.
    return phone.lstrip("+")


async def resolve_producer_or_driver(
    session: AsyncSession, authorization: str | None
) -> tuple[str, str]:
    """Returns (role, id) — role is 'producer' or 'driver' — from a Bearer token."""
    if authorization is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Authentication required")
    token = authorization.removeprefix("Bearer ").strip()
    if not token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Authentication required")
    try:
        user = await supabase_auth.get_user_from_token(token)
    except supabase_auth.SupabaseAuthError as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired token") from exc
    phone = "+" + normalize_phone(user.get("phone") or "")

    producer = (
        await session.execute(text("select id from producers where phone = :phone"), {"phone": phone})
    ).one_or_none()
    if producer is not None:
        return "producer", str(producer.id)

    driver = (
        await session.execute(text("select id from drivers where phone = :phone"), {"phone": phone})
    ).one_or_none()
    if driver is not None:
        return "driver", str(driver.id)

    raise HTTPException(status.HTTP_403_FORBIDDEN, "Account is not a registered producer or driver")
