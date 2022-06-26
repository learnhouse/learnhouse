from typing import Union
from fastapi import FastAPI
from src import main
from fastapi.staticfiles import StaticFiles
from src.main import global_router
import pymongo

# Init
app = FastAPI(
    title="LearnHouse",
    description="LearnHouse is a new open-source platform tailored for learning experiences.",
    version="0.1.0",
    root_path="/"
)

app.include_router(global_router)

@app.get("/")
async def root():
    return {"Message": "Welcome to LearnHouse ✨"}