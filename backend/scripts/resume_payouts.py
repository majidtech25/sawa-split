"""Ends a payout pause from the terminal (migration 0015), once the Daraja B2C
credential is fixed. Same as the coordinator's Resume payouts button.

Usage (from backend/):
  .venv/bin/python scripts/resume_payouts.py --env-file .env.demo

--env-file picks the project (.env.demo for the live demo; default .env, the test
project), loaded as written. The database connection allows 60s.
"""

import argparse
import asyncio
import os
import sys
from pathlib import Path

parser = argparse.ArgumentParser(description="Resume payouts after a pause.")
parser.add_argument("--env-file", default=".env")
args = parser.parse_args()
for line in Path(args.env_file).read_text().splitlines():
    line = line.strip()
    if line and not line.startswith("#") and "=" in line:
        key, value = line.split("=", 1)
        os.environ[key.strip()] = value.strip()
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine  # noqa: E402
from sqlalchemy.pool import NullPool  # noqa: E402

from app import db, payouts  # noqa: E402
from app.config import settings  # noqa: E402


async def main() -> None:
    engine = create_async_engine(
        db._to_asyncpg_url(settings.database_url), poolclass=NullPool,
        connect_args={"ssl": db._pooler_ssl_context(), "timeout": 60, "statement_cache_size": 0},
    )
    async with async_sessionmaker(engine, expire_on_commit=False)() as session:
        resumed = await payouts.resume_payouts(session)
    print("Payouts resumed." if resumed else "Payouts weren't paused.")
    await engine.dispose()


asyncio.run(main())
