"""HEAD handlers in src/routers/stream.py answer from the file's metadata."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

from src.routers import stream as stream_mod

_ACCESS = AsyncMock(return_value=None)


def _calls():
    request = MagicMock()
    user, db = MagicMock(), MagicMock()
    return [
        lambda: stream_mod.head_block_audio(request, "org_a", "course_a", "activity_a", "block_a", "a.mp3", user, db),
        lambda: stream_mod.head_activity_video(request, "org_a", "course_a", "activity_a", "v.mp4", user, db),
        lambda: stream_mod.head_block_video(request, "org_a", "course_a", "activity_a", "block_a", "v.mp4", user, db),
        lambda: stream_mod.head_podcast_audio(request, "org_a", "podcast_a", "episode_a", "e.mp3", user, db),
    ]


@pytest.fixture(autouse=True)
def _allowed():
    with patch.object(stream_mod, "_verify_course_activity_access", _ACCESS), \
            patch.object(stream_mod, "_verify_podcast_episode_access", _ACCESS), \
            patch.object(stream_mod, "validate_video_path", return_value="content/file"):
        yield


@pytest.mark.parametrize("index", range(4))
async def test_head_returns_file_metadata(index):
    with patch.object(stream_mod, "get_file_info", return_value=(1234, "audio/mpeg", True)) as info:
        response = await _calls()[index]()
    info.assert_called_once_with("content/file")
    assert response.status_code == 200
    assert response.headers["Content-Length"] == "1234"
    assert response.headers["Content-Type"] == "audio/mpeg"


@pytest.mark.parametrize("index", range(4))
async def test_head_404_when_file_missing(index):
    with patch.object(stream_mod, "get_file_info", return_value=(0, "", False)):
        with pytest.raises(HTTPException) as exc:
            await _calls()[index]()
    assert exc.value.status_code == 404
