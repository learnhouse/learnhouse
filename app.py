import asyncio
import logging
from fastapi import FastAPI, Request
import re
from config.config import LearnHouseConfig, get_learnhouse_config
from src.core.events.events import shutdown_app, startup_app
from src.main import global_router
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi_jwt_auth.exceptions import AuthJWTException
# from src.services.mocks.initial import create_initial_data

########################
# Pre-Alpha Version 0.1.0
# Author: @swve
# (c) LearnHouse 2022
########################

# Get LearnHouse Config
learnhouse_config: LearnHouseConfig = get_learnhouse_config()

# Global Config
app = FastAPI(
    title=learnhouse_config.site_name,
    description=learnhouse_config.site_description,
    version="0.1.0",
    root_path="/"
)

origin_regex = re.compile(r"^http://[\w.-]+\.localhost:3000$")

app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=str(origin_regex.pattern),
    allow_origins=["http://localhost:3000", "http://localhost:3001"],
    allow_methods=["*"],
    allow_credentials=True,
    allow_headers=["*"]
)

# Static Files
app.mount("/content", StaticFiles(directory="content"), name="content")


# Events
app.add_event_handler("startup", startup_app(app))
app.add_event_handler("shutdown", shutdown_app(app))


# JWT Exception Handler
@ app.exception_handler(AuthJWTException)
def authjwt_exception_handler(request: Request, exc: AuthJWTException):
    return JSONResponse(
        status_code=exc.status_code,  # type: ignore
        content={"detail": exc.message}  # type: ignore
    )


# Global Routes
app.include_router(global_router)

# General Routes


@ app.get("/")
async def root():
    return {"Message": "Welcome to LearnHouse ✨"}

# Get config


@ app.get("/config")
async def config():
    logging.info("Getting config")
    config = get_learnhouse_config()
    return config.dict()


# @app.get("/initial_data")
# async def initial_data(request: Request):

#     await create_initial_data(request)
#     return {"Message": "Initial data created 🤖"}
