from src.services.utils.upload_content import upload_content


async def upload_community_thumbnail(
    thumbnail_file,
    name_in_disk: str,
    org_uuid: str,
    community_uuid: str,
):
    """
    Upload a thumbnail image for a community.

    Files are stored at: content/orgs/{org_uuid}/communities/{community_uuid}/thumbnails/{filename}
    """
    contents = thumbnail_file.file.read()
    try:
        await upload_content(
            f"communities/{community_uuid}/thumbnails",
            "orgs",
            org_uuid,
            contents,
            f"{name_in_disk}",
        )
    except Exception as e:
        return {"message": f"There was an error uploading the file: {str(e)}"}

    return {"message": "Thumbnail uploaded successfully"}
