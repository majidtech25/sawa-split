import re
import ssl

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from .config import settings


def _to_asyncpg_url(database_url: str) -> str:
    # Supabase gives a plain postgresql:// DSN; SQLAlchemy needs the +asyncpg
    # driver in the scheme, and asyncpg wants an ssl connect_arg as a bool or
    # SSLContext, never the "?sslmode=require" string form (CLAUDE.md section 2 gotcha).
    url = re.sub(r"^postgresql(\+\w+)?://", "postgresql+asyncpg://", database_url, count=1)
    return url.split("?", 1)[0]


def _pooler_ssl_context() -> ssl.SSLContext:
    # Plain ssl=True (asyncpg's default context) does full cert-chain verification
    # and fails against Supabase's Supavisor pooler with "self-signed certificate in
    # certificate chain" — confirmed empirically, not just a config slip. The
    # connection is still TLS-encrypted; this only skips chain/hostname verification,
    # the standard trade-off for managed-Postgres poolers whose certs aren't always
    # in the system trust store. Extends CLAUDE.md section 2's asyncpg ssl gotcha.
    #
    # Must be built as a fresh SSLContext(PROTOCOL_TLS_CLIENT), not
    # ssl.create_default_context() with verification switched off after the fact —
    # the latter hangs indefinitely on asyncpg's start_tls against this pooler
    # (confirmed empirically), even though the same override works fine elsewhere.
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    return ctx


engine = create_async_engine(
    _to_asyncpg_url(settings.database_url),
    # NullPool: we already sit behind Supabase's own session pooler, which owns
    # connection reuse. Stacking SQLAlchemy's own long-lived pool on top produced
    # intermittent hangs / stale-connection wrong-answers under uvicorn (confirmed
    # empirically — same query, same code, correct standalone but flaky through the
    # running server). A fresh asyncpg connection per checkout costs a few hundred ms
    # more per request but removes that whole failure class; fine for this app's scale.
    poolclass=NullPool,
    # DATABASE_URL must be Supabase's Session pooler (port 5432), not the Transaction
    # pooler (port 6543) — the latter runs PgBouncer in transaction mode, which cannot
    # support prepared statements no matter how asyncpg/SQLAlchemy are configured
    # (confirmed empirically: DuplicatePreparedStatementError, unfixable client-side).
    # Session mode gives each connection a dedicated backend, so prepared statements
    # work normally; these two are left disabled anyway as a low-cost safety margin.
    connect_args={
        "ssl": _pooler_ssl_context(),
        "statement_cache_size": 0,
        "prepared_statement_cache_size": 0,
        # Bounds connection establishment so a bad network path fails fast and loud
        # instead of hanging the request indefinitely (seen from this dev sandbox to
        # the eu-central-1 pooler — not reproduced as a logic bug, just slow/jittery
        # egress here; expected to be a non-issue from Render's own network).
        "timeout": 10,
    },
)
async_session = async_sessionmaker(engine, expire_on_commit=False)


async def get_session() -> AsyncSession:
    async with async_session() as session:
        yield session
