"""One-off bootstrap for the very first coordinator account.

No public self-registration exists for any role (CLAUDE.md section 5), and
/auth/onboard itself requires an existing coordinator to call it — so the
first one has to be created out of band, directly against Supabase Auth.
Run locally (never via Render shell, which doesn't exist on the free tier):

    cd backend && set -a && source .env && set +a
    python -m scripts.create_coordinator +254700000000 1234
"""

import asyncio
import sys

from app.db import async_session
from app.routers.auth import _create_auth_account


async def main(phone: str, pin: str) -> None:
    async with async_session() as session:
        auth_user_id = await _create_auth_account(session, phone=phone, pin=pin, is_admin=True)
        await session.commit()
    print(f"Coordinator created: auth_user_id={auth_user_id} phone={phone}")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("Usage: python -m scripts.create_coordinator <phone> <4-digit-pin>")
        sys.exit(1)
    asyncio.run(main(sys.argv[1], sys.argv[2]))
