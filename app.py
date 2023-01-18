import logging
from fastapi import FastAPI, Request
from src.main import global_router
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi_jwt_auth.exceptions import AuthJWTException
from src.services.mocks.initial import create_initial_data
import pymongo

########################
# Pre-Alpha Version 0.1.0
# Author: @swve
# (c) LearnHouse 2022
########################


# Global Config
app = FastAPI(
    title="LearnHouse",
    description="LearnHouse is a new open-source platform tailored for learning experiences.",
    version="0.1.0",
    root_path="/"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:3001"],
    allow_methods=["*"],
    allow_credentials=True,
    allow_headers=["*"]
)

# Static Files
app.mount("/content", StaticFiles(directory="content"), name="content")


# Lifecycle Events
@app.on_event("startup")
def startup_event():
    logging.info("Starting LearnHouse...")
    # Database Connection
    logging.info("Connecting to database...")
    try:
        app.mongodb_client = pymongo.MongoClient("mongodb://learnhouse:learnhouse@mongo:27017/") # type: ignore
        app.db = app.mongodb_client["learnhouse"] # type: ignore
        logging.info("Connected to database!")
    except Exception as e:
        logging.error("Failed to connect to database!")
        logging.error(e)

@app.on_event("shutdown")
def shutdown_event():
    app.mongodb_client.close() # type: ignore
    logging.info("LearnHouse has been shut down.")

# JWT Exception Handler
@app.exception_handler(AuthJWTException)
def authjwt_exception_handler(request: Request, exc: AuthJWTException):
    return JSONResponse(
        status_code=exc.status_code,  # type: ignore
        content={"detail": exc.message}  # type: ignore
    )

# Global Routes
app.include_router(global_router)

# General Routes
@app.get("/")
async def root():
    return {"Message": "Welcome to LearnHouse ✨"}


@app.get("/initial_data")
async def initial_data(request: Request):

    await create_initial_data(request)
    return {"Message": "Initial data created 🤖"}
