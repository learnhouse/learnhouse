from fastapi import UploadFile
from src.services.utils.upload_content import upload_file


async def upload_avatar(avatar_file: UploadFile, user_uuid: str) -> str:
    """Upload user avatar."""
    return await upload_file(
        file=avatar_file,
        directory="avatars",
        type_of_dir="users",
        uuid=user_uuid,
        allowed_types=["image"],
        filename_prefix="avatar",
        max_size=2 * 1024 * 1024  # 2MB
    )
