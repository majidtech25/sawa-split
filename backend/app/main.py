from fastapi import FastAPI

from .routers import auth, daraja, transactions, withdrawals

app = FastAPI(title="Sawa Split API")
app.include_router(auth.router)
app.include_router(transactions.router)
app.include_router(daraja.router)
app.include_router(withdrawals.router)


@app.get("/")
async def hello():
    return {"message": "hello from sawa-split backend"}
