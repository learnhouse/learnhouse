from uuid import uuid4
from fastapi import UploadFile
from fastapi import HTTPException

from src.services.utils.upload_content import upload_content


async def upload_org_logo(logo_file, org_uuid):
    contents = logo_file.file.read()
    name_in_disk = f"{uuid4()}.{logo_file.filename.split('.')[-1]}"

    await upload_content(
        "logos",
        "orgs",
        org_uuid,
        contents,
        name_in_disk,
    )

    return name_in_disk


async def upload_org_thumbnail(thumbnail_file, org_uuid):
    contents = thumbnail_file.file.read()
    name_in_disk = f"{uuid4()}.{thumbnail_file.filename.split('.')[-1]}"

    await upload_content(
        "thumbnails",
        "orgs",
        org_uuid,
        contents,
        name_in_disk,
    )

    return name_in_disk


async def upload_org_preview(file, org_uuid: str) -> str:
    contents = file.file.read()
    name_in_disk = f"{uuid4()}.{file.filename.split('.')[-1]}"

    await upload_content(
        "previews",
        "orgs",
        org_uuid,
        contents,
        name_in_disk,
    )

    return name_in_disk


async def upload_org_landing_content(file: UploadFile, org_uuid: str) -> str:
    if not file or not file.filename:
        raise HTTPException(status_code=400, detail="No file provided or invalid filename")
        
    contents = file.file.read()
    name_in_disk = f"{uuid4()}.{file.filename.split('.')[-1]}"

    await upload_content(
        "landing",
        "orgs",
        org_uuid,
        contents,
        name_in_disk,
        ["jpg", "jpeg", "png", "gif", "webp", "mp4", "webm", "pdf"]  # Common web content formats
    )

    return name_in_disk