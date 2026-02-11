from fastapi import UploadFile
from src.services.utils.upload_content import upload_file


async def upload_community_thumbnail(
    thumbnail_file: UploadFile,
    org_uuid: str,
    community_uuid: str,
) -> str:
    """Upload a thumbnail image for a community with file validation."""
    return await upload_file(
        file=thumbnail_file,
        directory=f"communities/{community_uuid}/thumbnails",
        type_of_dir="orgs",
        uuid=org_uuid,
        allowed_types=["image"],
        filename_prefix="thumbnail",
    )
