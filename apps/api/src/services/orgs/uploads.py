from fastapi import UploadFile
from src.services.utils.upload_content import upload_file


async def upload_org_logo(logo_file: UploadFile, org_uuid: str) -> str:
    """Upload organization logo."""
    return await upload_file(
        file=logo_file,
        directory="logos",
        type_of_dir="orgs",
        uuid=org_uuid,
        allowed_types=["image"],
        filename_prefix="logo",
        max_size=5 * 1024 * 1024  # 5MB
    )


async def upload_org_thumbnail(thumbnail_file: UploadFile, org_uuid: str) -> str:
    """Upload organization thumbnail."""
    return await upload_file(
        file=thumbnail_file,
        directory="thumbnails",
        type_of_dir="orgs",
        uuid=org_uuid,
        allowed_types=["image"],
        filename_prefix="thumbnail",
        max_size=5 * 1024 * 1024  # 5MB
    )


async def upload_org_preview(file: UploadFile, org_uuid: str) -> str:
    """Upload organization preview image."""
    return await upload_file(
        file=file,
        directory="previews",
        type_of_dir="orgs",
        uuid=org_uuid,
        allowed_types=["image"],
        filename_prefix="preview",
        max_size=5 * 1024 * 1024  # 5MB
    )


async def upload_org_landing_content(file: UploadFile, org_uuid: str) -> str:
    """Upload organization landing content."""
    return await upload_file(
        file=file,
        directory="landing",
        type_of_dir="orgs",
        uuid=org_uuid,
        allowed_types=["image", "video", "document"],
        filename_prefix="landing",
        max_size=50 * 1024 * 1024  # 50MB
    )