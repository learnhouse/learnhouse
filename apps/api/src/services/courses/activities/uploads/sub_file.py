from fastapi import UploadFile
from src.security.submission_file_access import submission_file_prefix
from src.services.utils.upload_content import upload_file

# Learner submissions: documents, images, office files and small zips only.
# Video/SCORM (multi-GB, read into memory) are not accepted from learners.
SUBMISSION_ALLOWED_TYPES = ["document", "image", "office", "archive"]
SUBMISSION_MAX_SIZE = 50 * 1024 * 1024


async def upload_submission_file(
    file: UploadFile,
    activity_uuid: str,
    org_uuid: str,
    course_uuid: str,
    assignment_uuid: str,
    assignment_task_uuid: str,
    user_id: int,
) -> str:
    """Upload a submission file with file validation, tagged with its uploader."""
    return await upload_file(
        file=file,
        directory=f"courses/{course_uuid}/activities/{activity_uuid}/assignments/{assignment_uuid}/tasks/{assignment_task_uuid}/subs",
        type_of_dir="orgs",
        uuid=org_uuid,
        allowed_types=SUBMISSION_ALLOWED_TYPES,
        filename_prefix=submission_file_prefix(user_id),
        max_size=SUBMISSION_MAX_SIZE,
    )
