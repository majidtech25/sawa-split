from fastapi import FastAPI

from .routers import auth, transactions

app = FastAPI(title="Sawa Split API")
app.include_router(auth.router)
app.include_router(transactions.router)


@app.get("/")
async def hello():
    return {"message": "hello from sawa-split backend"}
