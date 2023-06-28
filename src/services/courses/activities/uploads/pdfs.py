import os

from src.services.utils.upload_content import upload_content


async def upload_pdf(pdf_file, activity_id, org_id, course_id):
    contents = pdf_file.file.read()
    pdf_format = pdf_file.filename.split(".")[-1]

    try:
        await upload_content(
            f"courses/{course_id}/activities/{activity_id}/documentpdf",
            org_id,
            contents,
            f"documentpdf.{pdf_format}",
        )

    except Exception:
        return {"message": "There was an error uploading the file"}
