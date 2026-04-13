"""Tests for src/services/podcasts/thumbnails.py."""

from io import BytesIO
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import UploadFile

from src.services.podcasts.thumbnails import (
    upload_episode_audio,
    upload_episode_thumbnail,
    upload_podcast_thumbnail,
)


def _upload_file(name: str) -> UploadFile:
    return UploadFile(filename=name, file=BytesIO(b"content"))


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("callable_", "kwargs", "expected", "file_key"),
    [
        (
            upload_podcast_thumbnail,
            {
                "thumbnail_file": _upload_file("thumb.png"),
                "org_uuid": "org-uuid",
                "podcast_uuid": "podcast-uuid",
            },
            {
                "directory": "podcasts/podcast-uuid/thumbnails",
                "type_of_dir": "orgs",
                "uuid": "org-uuid",
                "allowed_types": ["image"],
                "filename_prefix": "thumbnail",
            },
            "thumbnail_file",
        ),
        (
            upload_episode_thumbnail,
            {
                "thumbnail_file": _upload_file("episode-thumb.png"),
                "org_uuid": "org-uuid",
                "podcast_uuid": "podcast-uuid",
                "episode_uuid": "episode-uuid",
            },
            {
                "directory": "podcasts/podcast-uuid/episodes/episode-uuid/thumbnails",
                "type_of_dir": "orgs",
                "uuid": "org-uuid",
                "allowed_types": ["image"],
                "filename_prefix": "thumbnail",
            },
            "thumbnail_file",
        ),
        (
            upload_episode_audio,
            {
                "audio_file": _upload_file("episode.mp3"),
                "org_uuid": "org-uuid",
                "podcast_uuid": "podcast-uuid",
                "episode_uuid": "episode-uuid",
            },
            {
                "directory": "podcasts/podcast-uuid/episodes/episode-uuid/audio",
                "type_of_dir": "orgs",
                "uuid": "org-uuid",
                "allowed_types": ["audio"],
                "filename_prefix": "audio",
            },
            "audio_file",
        ),
    ],
)
async def test_podcast_thumbnail_wrappers(callable_, kwargs, expected, file_key):
    with patch(
        "src.services.podcasts.thumbnails.upload_file",
        new_callable=AsyncMock,
        return_value="stored-path",
    ) as mock_upload:
        result = await callable_(**kwargs)

    assert result == "stored-path"
    mock_upload.assert_awaited_once_with(file=kwargs[file_key], **expected)
