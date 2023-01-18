import logging
from fastapi import FastAPI
import pymongo

async def connect_to_db(app: FastAPI) :
    logging.info("Connecting to database...")
    try:
        app.mongodb_client = pymongo.MongoClient("mongodb://learnhouse:learnhouse@mongo:27017/") # type: ignore
        app.db = app.mongodb_client["learnhouse"] # type: ignore
        logging.info("Connected to database!")
    except Exception as e:
        logging.error("Failed to connect to database!")
        logging.error(e)

async def close_database(app: FastAPI):
    app.mongodb_client.close() # type: ignore
    logging.info("LearnHouse has been shut down.")
    return app