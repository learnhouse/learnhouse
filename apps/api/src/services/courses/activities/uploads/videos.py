from fastapi import UploadFile
from src.services.utils.upload_content import upload_file


async def upload_video(video_file: UploadFile, activity_uuid: str, org_uuid: str, course_uuid: str) -> str:
    """Upload a video file for a course activity with file validation."""
    return await upload_file(
        file=video_file,
        directory=f"courses/{course_uuid}/activities/{activity_uuid}/video",
        type_of_dir="orgs",
        uuid=org_uuid,
        allowed_types=["video"],
        filename_prefix="video",
    )
