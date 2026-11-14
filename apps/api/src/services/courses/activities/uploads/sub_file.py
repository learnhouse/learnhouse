from fastapi import UploadFile
from src.security.submission_file_access import submission_file_prefix
from src.services.utils.upload_content import upload_file

# Learner submissions: documents, images, office files, small zips, and short
# audio/video recordings (spoken answers, screen recordings) that AI grading
# transcribes. Uploads stream to storage, so the media cap is about storage,
# not memory. SCORM and multi-GB video are still not accepted from learners.
SUBMISSION_ALLOWED_TYPES = ["document", "image", "office", "archive", "audio", "video"]
SUBMISSION_MAX_SIZE = 50 * 1024 * 1024
SUBMISSION_MEDIA_MAX_SIZE = 200 * 1024 * 1024
_MEDIA_EXTENSIONS = {"mp4", "webm", "mp3", "wav", "ogg", "m4a"}


def submission_max_size(filename: str | None) -> int:
    """Size cap for a submission file: larger for audio/video. The upload
    validator still checks the bytes match the extension, so renaming a file
    cannot borrow the media cap."""
    ext = (filename or "").rsplit(".", 1)[-1].lower() if "." in (filename or "") else ""
    return SUBMISSION_MEDIA_MAX_SIZE if ext in _MEDIA_EXTENSIONS else SUBMISSION_MAX_SIZE


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
        max_size=submission_max_size(file.filename),
    )
