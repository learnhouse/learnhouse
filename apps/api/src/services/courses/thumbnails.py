from fastapi import UploadFile
from src.services.utils.upload_content import upload_file


async def upload_thumbnail(thumbnail_file: UploadFile, org_uuid: str, course_id: str) -> str:
    """Upload a course thumbnail image with file validation."""
    return await upload_file(
        file=thumbnail_file,
        directory=f"courses/{course_id}/thumbnails",
        type_of_dir="orgs",
        uuid=org_uuid,
        allowed_types=["image", "video"],
        filename_prefix="thumbnail",
    )
