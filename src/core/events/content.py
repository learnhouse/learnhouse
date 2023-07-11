import os


async def check_content_directory():
    if not os.path.exists(f"content"):
        # create folder for activity
        print("Creating content directory...")
        os.makedirs(f"content")
