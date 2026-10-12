import hmac
import logging
import time
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from . import login_limits
from .config import settings
from .db import engine
from .pin import hash_pin, verify_pin_async
from .routers import account_admin, accounts, admin, auth, daraja, public, transactions, withdrawals
from .scheduler import build_scheduler

logging.basicConfig(level=logging.INFO)

# A hash made once at start-up, so /health times a real bcrypt check like login does.
_HEALTH_HASH = hash_pin("1357")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    scheduler = build_scheduler()
    scheduler.start()
    yield
    scheduler.shutdown(wait=False)


app = FastAPI(title="Sawa Split API", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.cors_origins.split(",") if o.strip()],
    allow_methods=["GET", "POST"],
    allow_headers=["Authorization", "Content-Type"],
)
app.include_router(auth.router)
app.include_router(transactions.router)
app.include_router(daraja.router)
app.include_router(withdrawals.router)
app.include_router(withdrawals.admin_router)
app.include_router(public.router)
app.include_router(admin.router)
app.include_router(accounts.router)
app.include_router(account_admin.router)


@app.get("/")
async def hello():
    return {"message": "hello from sawa-split backend"}


@app.get("/health")
async def health(request: Request):
    """Public: a cheap check that the API and its database answer (the keep-awake ping).
    With the X-Health-Timing-Key header matching HEALTH_TIMING_KEY, it also times where a
    login's time goes, measured from wherever the API runs (Render has no shell on the
    free tier): a fresh database connection, a query, a bcrypt PIN check, a Supabase Auth
    round trip, and which client IP the login limits would see. Never anything secret."""
    start = time.perf_counter()
    async with engine.connect() as conn:
        connected = time.perf_counter()
        await conn.execute(text("select 1"))
        queried = time.perf_counter()
    key = request.headers.get("x-health-timing-key", "")
    if not (settings.health_timing_key and hmac.compare_digest(key, settings.health_timing_key)):
        return {"ok": True}

    timings = {
        "db_connect_ms": round((connected - start) * 1000),
        "db_query_ms": round((queried - connected) * 1000),
    }
    b = time.perf_counter()
    await verify_pin_async("0000", _HEALTH_HASH)
    timings["bcrypt_verify_ms"] = round((time.perf_counter() - b) * 1000)
    a = time.perf_counter()
    async with httpx.AsyncClient(base_url=settings.supabase_url, timeout=10) as client:
        await client.get("/auth/v1/health", headers={"apikey": settings.supabase_service_role_key})
    timings["supabase_auth_ms"] = round((time.perf_counter() - a) * 1000)
    timings["total_ms"] = round((time.perf_counter() - start) * 1000)
    # Which address the per-IP login limit would use, and the raw headers it comes
    # from, so the rule can be checked on Render itself. The caller's own IP: not secret.
    timings["login_limit_ip"] = login_limits.client_ip(request)
    timings["ip_headers"] = {
        h: request.headers.get(h) for h in ("cf-connecting-ip", "true-client-ip", "x-forwarded-for", "x-real-ip", "forwarded")
        if h in request.headers
    }
    timings["socket_peer"] = request.client.host if request.client else None
    return timings
