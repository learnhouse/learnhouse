from fastapi import UploadFile
from src.services.utils.upload_content import upload_file


async def upload_pdf(pdf_file: UploadFile, activity_uuid: str, org_uuid: str, course_uuid: str) -> str:
    """Upload a PDF file for a course activity with file validation."""
    return await upload_file(
        file=pdf_file,
        directory=f"courses/{course_uuid}/activities/{activity_uuid}/documentpdf",
        type_of_dir="orgs",
        uuid=org_uuid,
        allowed_types=["document"],
        filename_prefix="documentpdf",
    )
