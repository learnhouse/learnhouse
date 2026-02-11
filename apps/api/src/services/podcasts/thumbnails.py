from fastapi import UploadFile
from src.services.utils.upload_content import upload_file


async def upload_podcast_thumbnail(thumbnail_file: UploadFile, org_uuid: str, podcast_uuid: str) -> str:
    """Upload a podcast thumbnail image with file validation."""
    return await upload_file(
        file=thumbnail_file,
        directory=f"podcasts/{podcast_uuid}/thumbnails",
        type_of_dir="orgs",
        uuid=org_uuid,
        allowed_types=["image"],
        filename_prefix="thumbnail",
    )


async def upload_episode_thumbnail(thumbnail_file: UploadFile, org_uuid: str, podcast_uuid: str, episode_uuid: str) -> str:
    """Upload a podcast episode thumbnail image with file validation."""
    return await upload_file(
        file=thumbnail_file,
        directory=f"podcasts/{podcast_uuid}/episodes/{episode_uuid}/thumbnails",
        type_of_dir="orgs",
        uuid=org_uuid,
        allowed_types=["image"],
        filename_prefix="thumbnail",
    )


async def upload_episode_audio(audio_file: UploadFile, org_uuid: str, podcast_uuid: str, episode_uuid: str) -> str:
    """Upload a podcast episode audio file with file validation."""
    return await upload_file(
        file=audio_file,
        directory=f"podcasts/{podcast_uuid}/episodes/{episode_uuid}/audio",
        type_of_dir="orgs",
        uuid=org_uuid,
        allowed_types=["audio"],
        filename_prefix="audio",
    )
