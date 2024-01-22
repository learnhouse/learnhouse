from src.services.utils.upload_content import upload_content


async def upload_avatar(avatar_file, name_in_disk, user_uuid):
    contents = avatar_file.file.read()
    try:
        await upload_content(
            "avatars",
            "users",
            user_uuid,
            contents,
            f"{name_in_disk}",
        )

    except Exception:
        return {"message": "There was an error uploading the file"}
