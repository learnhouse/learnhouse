from src.services.utils.upload_content import upload_content


async def upload_podcast_thumbnail(thumbnail_file, name_in_disk, org_uuid, podcast_uuid):
    contents = thumbnail_file.file.read()
    try:
        await upload_content(
            f"podcasts/{podcast_uuid}/thumbnails",
            "orgs",
            org_uuid,
            contents,
            f"{name_in_disk}",
        )
    except Exception:
        return {"message": "There was an error uploading the file"}


async def upload_episode_thumbnail(thumbnail_file, name_in_disk, org_uuid, podcast_uuid, episode_uuid):
    contents = thumbnail_file.file.read()
    try:
        await upload_content(
            f"podcasts/{podcast_uuid}/episodes/{episode_uuid}/thumbnails",
            "orgs",
            org_uuid,
            contents,
            f"{name_in_disk}",
        )
    except Exception:
        return {"message": "There was an error uploading the file"}


async def upload_episode_audio(audio_file, name_in_disk, org_uuid, podcast_uuid, episode_uuid):
    contents = audio_file.file.read()
    try:
        await upload_content(
            f"podcasts/{podcast_uuid}/episodes/{episode_uuid}/audio",
            "orgs",
            org_uuid,
            contents,
            f"{name_in_disk}",
        )
    except Exception:
        return {"message": "There was an error uploading the file"}
