from uuid import uuid4

from src.services.utils.upload_content import upload_content


async def upload_org_logo(logo_file, org_id):
    contents = logo_file.file.read()
    name_in_disk = f"{uuid4()}.{logo_file.filename.split('.')[-1]}"

    await upload_content(
        "logos",
        org_id,
        contents,
        name_in_disk,
    )

    return name_in_disk
