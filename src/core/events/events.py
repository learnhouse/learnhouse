from typing import Callable
from fastapi import FastAPI
from src.core.events.database import close_database, connect_to_db
from src.core.events.logs import create_logs_dir


def startup_app(app: FastAPI) -> Callable:
    async def start_app() -> None:
        # Connect to database
        await connect_to_db(app)

        # Create logs directory
        await create_logs_dir()

    return start_app


def shutdown_app(app: FastAPI) -> Callable:
    async def close_app() -> None:
        await close_database(app)
    return close_app
