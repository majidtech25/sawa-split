"""Clears a login lockout from the terminal (CLAUDE.md section 5), e.g. if a presenter
locks themselves out during the pitch. Same code as the coordinator's Unlock button
(app/login_limits.clear_lockouts); audit-logged as login_unlocked by "system".

Usage (from backend/):
  .venv/bin/python scripts/clear_login_lockout.py --env-file .env.demo +254799999001
  .venv/bin/python scripts/clear_login_lockout.py --env-file .env.demo --ip 203.0.113.7

--env-file picks the project (.env.demo for the live demo; default .env, the test
project). Its values are loaded as written, with no shell expansion. The database
connection allows 60s, for slow links to the pooler.
"""

import argparse
import asyncio
import os
import sys
from pathlib import Path

parser = argparse.ArgumentParser(description="Clear a login lockout.")
parser.add_argument("--env-file", default=".env")
target = parser.add_mutually_exclusive_group(required=True)
target.add_argument("phone", nargs="?", help="the locked phone, any format (+2547..., 07...)")
target.add_argument("--ip", help="a locked IP address instead of a phone")
args = parser.parse_args()

for line in Path(args.env_file).read_text().splitlines():
    line = line.strip()
    if line and not line.startswith("#") and "=" in line:
        key, value = line.split("=", 1)
        os.environ[key.strip()] = value.strip()
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine  # noqa: E402
from sqlalchemy.pool import NullPool  # noqa: E402

from app import db, login_limits  # noqa: E402
from app.config import settings  # noqa: E402


async def main() -> None:
    engine = create_async_engine(
        db._to_asyncpg_url(settings.database_url), poolclass=NullPool,
        connect_args={"ssl": db._pooler_ssl_context(), "timeout": 60, "statement_cache_size": 0},
    )
    kind, key = ("ip", args.ip) if args.ip else ("phone", args.phone)
    async with async_sessionmaker(engine, expire_on_commit=False)() as session:
        ended = await login_limits.clear_lockouts(
            session, kind, key, actor_role="system", reason="Cleared from the terminal (scripts/clear_login_lockout.py)"
        )
    shown = login_limits.phone_key(key) if kind == "phone" else key
    print(f"{kind} {shown}: {'unlocked' if ended else 'was not locked'}; its failed attempts are cleared.")
    await engine.dispose()


asyncio.run(main())
