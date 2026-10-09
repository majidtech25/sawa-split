from fastapi import HTTPException, status
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from . import lifecycle, supabase_auth


def normalize_phone(phone: str) -> str:
    # Supabase Auth strips the leading '+' from phone claims; our tables store it with
    # one (whatever the coordinator typed at onboarding) — normalize before comparing.
    return phone.lstrip("+")


async def resolve_producer_or_driver(
    session: AsyncSession, authorization: str | None
) -> tuple[str, str]:
    """Returns (role, id) — role is 'producer' or 'driver' — from a Bearer token.
    Refuses (403, with the reason) a suspended or closed account (rule 17)."""
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

    for role, party_type, table in (("producer", "maker", "producers"), ("driver", "driver", "drivers")):
        row = (
            await session.execute(text(f"select id, account_status from {table} where phone = :phone"), {"phone": phone})
        ).one_or_none()
        if row is not None:
            refusal = await lifecycle.login_refusal(session, party_type, row.id, row.account_status)
            if refusal:
                raise HTTPException(status.HTTP_403_FORBIDDEN, refusal)
            return role, str(row.id)

    raise HTTPException(status.HTTP_403_FORBIDDEN, "Account is not a registered producer or driver")
