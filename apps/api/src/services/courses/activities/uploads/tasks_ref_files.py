from fastapi import UploadFile
from src.services.utils.upload_content import upload_file


async def upload_reference_file(
    file: UploadFile,
    activity_uuid: str,
    org_uuid: str,
    course_uuid: str,
    assignment_uuid: str,
    assignment_task_uuid: str,
) -> str:
    """Upload a reference file with file validation."""
    return await upload_file(
        file=file,
        directory=f"courses/{course_uuid}/activities/{activity_uuid}/assignments/{assignment_uuid}/tasks/{assignment_task_uuid}",
        type_of_dir="orgs",
        uuid=org_uuid,
        allowed_types=["document", "image", "video", "office", "scorm"],
        filename_prefix="reference",
    )
