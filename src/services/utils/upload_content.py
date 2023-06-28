import os


async def upload_content(
    directory: str, org_id: str, file_binary: bytes, file_and_format: str
):
    # create folder for activity
    if not os.path.exists(f"content/{org_id}/{directory}"):
        # create folder for activity
        os.makedirs(f"content/{org_id}/{directory}")
    # upload file to server
    with open(
        f"content/{org_id}/{directory}/{file_and_format}",
        "wb",
    ) as f:
        f.write(file_binary)
        f.close()
