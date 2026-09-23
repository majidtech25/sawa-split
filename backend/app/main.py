from fastapi import FastAPI

app = FastAPI(title="Sawa Split API")


@app.get("/")
async def hello():
    return {"message": "hello from sawa-split backend"}
