from fastapi import UploadFile
from src.services.utils.upload_content import upload_file


async def upload_submission_file(
    file: UploadFile,
    activity_uuid: str,
    org_uuid: str,
    course_uuid: str,
    assignment_uuid: str,
    assignment_task_uuid: str,
) -> str:
    """Upload a submission file with file validation."""
    return await upload_file(
        file=file,
        directory=f"courses/{course_uuid}/activities/{activity_uuid}/assignments/{assignment_uuid}/tasks/{assignment_task_uuid}/subs",
        type_of_dir="orgs",
        uuid=org_uuid,
        allowed_types=["document", "image", "video", "office", "scorm"],
        filename_prefix="submission",
    )
