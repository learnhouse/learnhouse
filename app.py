from fastapi import FastAPI
from src.main import global_router
from fastapi.middleware.cors import CORSMiddleware


# Init
app = FastAPI(
    title="LearnHouse",
    description="LearnHouse is a new open-source platform tailored for learning experiences.",
    version="0.1.0",
    root_path="/"
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_credentials=True,
    allow_headers=["*"],
)

app.include_router(global_router)



@app.get("/")
async def root():
    return {"Message": "Welcome to LearnHouse ✨"}

