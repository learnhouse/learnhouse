import os

from src.services.utils.upload_content import upload_content


async def upload_thumbnail(thumbnail_file, name_in_disk, org_id, course_id):
    contents = thumbnail_file.file.read()
    try:
        await upload_content(
            f"courses/{course_id}/thumbnails",
            org_id,
            contents,
            f"{name_in_disk}",
        )

    except Exception:
        return {"message": "There was an error uploading the file"}
