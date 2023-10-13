import logging
from fastapi import FastAPI
import motor.motor_asyncio


async def connect_to_db(app: FastAPI):
    logging.info("Connecting to database...")
    try:
        app.mongodb_client = motor.motor_asyncio.AsyncIOMotorClient(  # type: ignore
            app.learnhouse_config.database_config.mongodb_connection_string)  # type: ignore
        app.db = app.mongodb_client["learnhouse"]  # type: ignore
        logging.info("Connected to database!")
    except Exception as e:
        logging.error("Failed to connect to database!")
        logging.error(e)


async def close_database(app: FastAPI):
    app.mongodb_client.close()  # type: ignore
    logging.info("LearnHouse has been shut down.")
    return app
