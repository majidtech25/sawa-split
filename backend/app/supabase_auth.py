from typing import Any

import httpx

from .config import settings


class SupabaseAuthError(Exception):
    def __init__(self, status_code: int, detail: Any):
        self.status_code = status_code
        self.detail = detail
        super().__init__(f"Supabase Auth error {status_code}: {detail}")


def _headers() -> dict[str, str]:
    # Backend-only: the Secret key is never exposed to the frontend (CLAUDE.md section 5).
    return {
        "apikey": settings.supabase_service_role_key,
        "Authorization": f"Bearer {settings.supabase_service_role_key}",
        "Content-Type": "application/json",
    }


async def create_user(
    *, phone: str, pin: str, app_metadata: dict[str, Any] | None = None
) -> dict[str, Any]:
    """Coordinator-onboarded account creation via the Supabase Auth admin API."""
    async with httpx.AsyncClient(base_url=settings.supabase_url) as client:
        resp = await client.post(
            "/auth/v1/admin/users",
            headers=_headers(),
            json={
                "phone": phone,
                "password": pin,
                "phone_confirm": True,
                "app_metadata": app_metadata or {},
            },
        )
    if resp.status_code >= 400:
        raise SupabaseAuthError(resp.status_code, resp.json())
    return resp.json()


async def delete_user(auth_user_id: str) -> None:
    async with httpx.AsyncClient(base_url=settings.supabase_url) as client:
        await client.delete(f"/auth/v1/admin/users/{auth_user_id}", headers=_headers())


async def sign_in_with_password(*, phone: str, pin: str) -> dict[str, Any]:
    """Verifies phone+PIN against Supabase Auth and returns a session (access/refresh tokens)."""
    async with httpx.AsyncClient(base_url=settings.supabase_url) as client:
        resp = await client.post(
            "/auth/v1/token",
            params={"grant_type": "password"},
            headers=_headers(),
            json={"phone": phone, "password": pin},
        )
    if resp.status_code >= 400:
        raise SupabaseAuthError(resp.status_code, resp.json())
    return resp.json()


async def get_user_from_token(access_token: str) -> dict[str, Any]:
    """Introspects a Supabase access token via GoTrue — used to verify the caller's
    identity/claims (e.g. is_admin) without needing the project's raw JWT secret."""
    async with httpx.AsyncClient(base_url=settings.supabase_url) as client:
        resp = await client.get(
            "/auth/v1/user",
            headers={
                "apikey": settings.supabase_service_role_key,
                "Authorization": f"Bearer {access_token}",
            },
        )
    if resp.status_code >= 400:
        raise SupabaseAuthError(resp.status_code, resp.json())
    return resp.json()
