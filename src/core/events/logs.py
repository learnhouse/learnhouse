import logging
import os


async def create_logs_dir():
    if not os.path.exists("logs"):
        os.mkdir("logs")

# Initiate logging
async def init_logging():
    await create_logs_dir()

    # Logging
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
        datefmt="%d-%b-%y %H:%M:%S",
        handlers=[
            logging.FileHandler("logs/learnhouse.log"),
            logging.StreamHandler()
        ]
    )

    logging.info("Logging initiated")
