from typing import Any

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from . import supabase_auth

bearer_scheme = HTTPBearer()


async def require_admin(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
) -> dict[str, Any]:
    try:
        user = await supabase_auth.get_user_from_token(credentials.credentials)
    except supabase_auth.SupabaseAuthError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired token")
    if not (user.get("app_metadata") or {}).get("is_admin"):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Coordinator access required")
    return user
