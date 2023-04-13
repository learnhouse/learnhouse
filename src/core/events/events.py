from typing import Callable
from fastapi import FastAPI
from config.config import LearnHouseConfig, get_learnhouse_config
from src.core.events.database import close_database, connect_to_db
from src.core.events.logs import create_logs_dir
from src.core.events.sentry import init_sentry


def startup_app(app: FastAPI) -> Callable:
    async def start_app() -> None:
        # Get LearnHouse Config
        learnhouse_config: LearnHouseConfig = get_learnhouse_config()
        app.learnhouse_config = learnhouse_config # type: ignore

        # Init Sentry
        await init_sentry(app)

        # Connect to database
        await connect_to_db(app)

        # Create logs directory
        await create_logs_dir()

    return start_app


def shutdown_app(app: FastAPI) -> Callable:
    async def close_app() -> None:
        await close_database(app)
    return close_app
