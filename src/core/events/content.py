import os


async def check_content_directory():
    if not os.path.exists("content"):
        # create folder for activity
        print("Creating content directory...")
        os.makedirs("content")
