from src.services.utils.upload_content import upload_content


async def upload_pdf(pdf_file, activity_uuid, org_uuid, course_uuid):
    contents = pdf_file.file.read()
    pdf_format = pdf_file.filename.split(".")[-1]

    try:
        await upload_content(
            f"courses/{course_uuid}/activities/{activity_uuid}/documentpdf",
            "orgs",
            org_uuid,
            contents,
            f"documentpdf.{pdf_format}",
        )

    except Exception:
        return {"message": "There was an error uploading the file"}
