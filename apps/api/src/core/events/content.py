import logging
import os

logger = logging.getLogger(__name__)


async def check_content_directory():
    if not os.path.exists("content"):
        # create folder for activity
        logger.info("Creating content directory...")
        os.makedirs("content")
