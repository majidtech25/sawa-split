import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI

from .routers import auth, daraja, transactions, withdrawals
from .scheduler import build_scheduler

logging.basicConfig(level=logging.INFO)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    scheduler = build_scheduler()
    scheduler.start()
    yield
    scheduler.shutdown(wait=False)


app = FastAPI(title="Sawa Split API", lifespan=lifespan)
app.include_router(auth.router)
app.include_router(transactions.router)
app.include_router(daraja.router)
app.include_router(withdrawals.router)
app.include_router(withdrawals.admin_router)


@app.get("/")
async def hello():
    return {"message": "hello from sawa-split backend"}
