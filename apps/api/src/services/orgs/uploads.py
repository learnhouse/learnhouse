from uuid import uuid4

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
