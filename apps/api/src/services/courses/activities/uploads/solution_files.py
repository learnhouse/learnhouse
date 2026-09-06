from fastapi import UploadFile
from src.services.utils.upload_content import upload_file


async def upload_solution_file(
    file: UploadFile,
    activity_uuid: str,
    org_uuid: str,
    course_uuid: str,
    assignment_uuid: str,
) -> str:
    """Upload the assignment's model answer ("corrigé") document.

    Mirrors ``upload_reference_file`` but hangs off the assignment rather than a
    task, since the corrigé covers the assignment as a whole. The stored name is
    what ``Assignment.solution_file`` holds, and it is only ever handed to a
    learner once the reveal rule unlocks it.
    """
    return await upload_file(
        file=file,
        directory=f"courses/{course_uuid}/activities/{activity_uuid}/assignments/{assignment_uuid}/solution",
        type_of_dir="orgs",
        uuid=org_uuid,
        allowed_types=["document", "image", "video", "office", "scorm"],
        filename_prefix="solution",
    )
