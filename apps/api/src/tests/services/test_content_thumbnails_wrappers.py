"""Tests for thumbnail/avatar wrapper modules."""

from io import BytesIO
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import UploadFile

from src.services.communities.thumbnails import upload_community_thumbnail
from src.services.courses.thumbnails import upload_thumbnail
from src.services.users.avatars import upload_avatar


def _upload_file(name: str) -> UploadFile:
    return UploadFile(filename=name, file=BytesIO(b"content"))


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("callable_", "kwargs", "expected"),
    [
        (
            upload_community_thumbnail,
            {
                "thumbnail_file": _upload_file("community.png"),
                "org_uuid": "org-uuid",
                "community_uuid": "community-uuid",
            },
            {
                "directory": "communities/community-uuid/thumbnails",
                "type_of_dir": "orgs",
                "uuid": "org-uuid",
                "allowed_types": ["image"],
                "filename_prefix": "thumbnail",
            },
        ),
        (
            upload_thumbnail,
            {
                "thumbnail_file": _upload_file("course.png"),
                "org_uuid": "org-uuid",
                "course_id": "course-uuid",
            },
            {
                "directory": "courses/course-uuid/thumbnails",
                "type_of_dir": "orgs",
                "uuid": "org-uuid",
                "allowed_types": ["image", "video"],
                "filename_prefix": "thumbnail",
            },
        ),
        (
            upload_avatar,
            {
                "avatar_file": _upload_file("avatar.png"),
                "user_uuid": "user-uuid",
            },
            {
                "directory": "avatars",
                "type_of_dir": "users",
                "uuid": "user-uuid",
                "allowed_types": ["image"],
                "filename_prefix": "avatar",
            },
        ),
    ],
)
async def test_thumbnail_avatar_wrappers(callable_, kwargs, expected):
    with patch(
        "src.services.communities.thumbnails.upload_file",
        new_callable=AsyncMock,
        return_value="stored-path",
    ) as community_upload_mock, patch(
        "src.services.courses.thumbnails.upload_file",
        new_callable=AsyncMock,
        return_value="stored-path",
    ) as course_upload_mock, patch(
        "src.services.users.avatars.upload_file",
        new_callable=AsyncMock,
        return_value="stored-path",
    ) as avatar_upload_mock:
        result = await callable_(**kwargs)

    assert result == "stored-path"
    if callable_ is upload_community_thumbnail:
        community_upload_mock.assert_awaited_once_with(file=kwargs["thumbnail_file"], **expected)
        course_upload_mock.assert_not_awaited()
        avatar_upload_mock.assert_not_awaited()
    elif callable_ is upload_thumbnail:
        course_upload_mock.assert_awaited_once_with(file=kwargs["thumbnail_file"], **expected)
        community_upload_mock.assert_not_awaited()
        avatar_upload_mock.assert_not_awaited()
    else:
        avatar_upload_mock.assert_awaited_once_with(file=kwargs["avatar_file"], **expected)
        community_upload_mock.assert_not_awaited()
        course_upload_mock.assert_not_awaited()
