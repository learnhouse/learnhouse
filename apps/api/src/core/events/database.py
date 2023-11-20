import logging
from fastapi import FastAPI
import motor.motor_asyncio
from sqlmodel import SQLModel, Session, create_engine


engine = create_engine(
    "postgresql://learnhouse:learnhouse@db:5432/learnhouse", echo=True
)
SQLModel.metadata.create_all(engine)


async def connect_to_db(app: FastAPI):
    app.db_engine = engine  # type: ignore
    logging.info("LearnHouse database has been started.")

    SQLModel.metadata.create_all(engine)

    # mongodb
    app.mongodb_client = motor.motor_asyncio.AsyncIOMotorClient(  # type: ignore
        app.learnhouse_config.database_config.mongodb_connection_string  # type: ignore
    )  # type: ignore
    app.db = app.mongodb_client["learnhouse"]  # type: ignore


def get_db_session():
    with Session(engine) as session:
        yield session


async def close_database(app: FastAPI):
    app.mongodb_client.close()  # type: ignore
    logging.info("LearnHouse has been shut down.")
    return app
