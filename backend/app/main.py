import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .routers import accounts, admin, auth, daraja, public, transactions, withdrawals
from .scheduler import build_scheduler

logging.basicConfig(level=logging.INFO)


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


@app.get("/")
async def hello():
    return {"message": "hello from sawa-split backend"}
