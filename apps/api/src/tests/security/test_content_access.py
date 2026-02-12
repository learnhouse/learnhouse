"""
Unit tests for content access control (local_content.py and content_files.py).

Tests cover:
- Path traversal prevention
- Public course content access for anonymous users
- Private course content requires authentication
- Public podcast content access
- Private podcast content requires authentication
- Org-level content always public
- User avatars always public
- Unknown paths require auth (safe default)
"""

import pytest
from unittest.mock import MagicMock
from fastapi import HTTPException


class TestValidateContentPath:
    """Test _validate_content_path in local_content.py."""

    def _validate(self, path):
        from src.routers.local_content import _validate_content_path
        return _validate_content_path(path)

    def test_valid_path(self):
        assert self._validate("orgs/abc/courses/def/thumbnail.png") is True

    def test_valid_deep_path(self):
        assert self._validate("orgs/abc/courses/def/activities/ghi/video.mp4") is True

    def test_directory_traversal_dotdot(self):
        assert self._validate("../etc/passwd") is False

    def test_directory_traversal_middle(self):
        assert self._validate("orgs/abc/../../etc/passwd") is False

    def test_absolute_path(self):
        assert self._validate("/etc/passwd") is False

    def test_null_byte(self):
        assert self._validate("orgs/abc\x00.png") is False

    def test_url_encoded_dotdot(self):
        """URL-encoded ../ should be caught by double-decode."""
        assert self._validate("orgs/%2e%2e/%2e%2e/etc/passwd") is False

    def test_double_encoded_dotdot(self):
        """Double URL-encoded ../ should be caught."""
        assert self._validate("orgs/%252e%252e/etc/passwd") is False

    def test_backslash_traversal(self):
        assert self._validate("orgs\\..\\..\\etc\\passwd") is False

    def test_user_avatar_path(self):
        assert self._validate("users/user_abc/avatars/photo.jpg") is True


class TestCheckContentAccess:
    """Test _check_content_access in local_content.py."""

    def _make_anon_user(self):
        from src.db.users import AnonymousUser
        return AnonymousUser()

    def _make_auth_user(self):
        user = MagicMock()
        user.id = 1
        user.user_uuid = "user_123"
        return user

    def _make_db_session(self, course=None, podcast=None):
        session = MagicMock()
        result = MagicMock()
        if course is not None:
            result.first.return_value = course
        elif podcast is not None:
            result.first.return_value = podcast
        else:
            result.first.return_value = None
        session.exec.return_value = result
        return session

    def _make_course(self, public=True):
        course = MagicMock()
        course.public = public
        course.course_uuid = "course_abc"
        return course

    def _make_podcast(self, public=True):
        podcast = MagicMock()
        podcast.public = public
        podcast.podcast_uuid = "podcast_abc"
        return podcast

    def test_public_course_activity_anonymous(self):
        """Anonymous users can access activity content of public courses."""
        from src.routers.local_content import _check_content_access
        course = self._make_course(public=True)
        db = self._make_db_session(course=course)
        # Should not raise
        _check_content_access(
            "orgs/org1/courses/course_abc/activities/act1/video.mp4",
            self._make_anon_user(), db
        )

    def test_private_course_activity_anonymous_rejected(self):
        """Anonymous users cannot access activity content of private courses."""
        from src.routers.local_content import _check_content_access
        course = self._make_course(public=False)
        db = self._make_db_session(course=course)
        with pytest.raises(HTTPException) as exc_info:
            _check_content_access(
                "orgs/org1/courses/course_abc/activities/act1/video.mp4",
                self._make_anon_user(), db
            )
        assert exc_info.value.status_code == 401

    def test_private_course_activity_authenticated(self):
        """Authenticated users can access private course activity content."""
        from src.routers.local_content import _check_content_access
        course = self._make_course(public=False)
        db = self._make_db_session(course=course)
        # Should not raise
        _check_content_access(
            "orgs/org1/courses/course_abc/activities/act1/video.mp4",
            self._make_auth_user(), db
        )

    def test_course_not_found_anonymous_rejected(self):
        """If course doesn't exist, anonymous users are rejected."""
        from src.routers.local_content import _check_content_access
        db = self._make_db_session()  # returns None
        with pytest.raises(HTTPException) as exc_info:
            _check_content_access(
                "orgs/org1/courses/course_abc/activities/act1/video.mp4",
                self._make_anon_user(), db
            )
        assert exc_info.value.status_code == 401

    def test_public_podcast_episode_anonymous(self):
        """Anonymous users can access episode content of public podcasts."""
        from src.routers.local_content import _check_content_access
        podcast = self._make_podcast(public=True)
        db = self._make_db_session(podcast=podcast)
        _check_content_access(
            "orgs/org1/podcasts/podcast_abc/episodes/ep1/audio.mp3",
            self._make_anon_user(), db
        )

    def test_private_podcast_episode_anonymous_rejected(self):
        """Anonymous users cannot access episode content of private podcasts."""
        from src.routers.local_content import _check_content_access
        podcast = self._make_podcast(public=False)
        db = self._make_db_session(podcast=podcast)
        with pytest.raises(HTTPException) as exc_info:
            _check_content_access(
                "orgs/org1/podcasts/podcast_abc/episodes/ep1/audio.mp3",
                self._make_anon_user(), db
            )
        assert exc_info.value.status_code == 401

    def test_course_thumbnail_always_public(self):
        """Course thumbnails (no /activities/) are always public."""
        from src.routers.local_content import _check_content_access
        db = self._make_db_session()
        # Should not raise even for anonymous
        _check_content_access(
            "orgs/org1/courses/course_abc/thumbnail.png",
            self._make_anon_user(), db
        )

    def test_org_logo_always_public(self):
        """Org-level content is always public."""
        from src.routers.local_content import _check_content_access
        db = self._make_db_session()
        _check_content_access(
            "orgs/org1/logo.png",
            self._make_anon_user(), db
        )

    def test_user_avatar_always_public(self):
        """User avatars are always public."""
        from src.routers.local_content import _check_content_access
        db = self._make_db_session()
        _check_content_access(
            "users/user_abc/avatars/photo.jpg",
            self._make_anon_user(), db
        )

    def test_unknown_path_anonymous_rejected(self):
        """Unknown path patterns require auth as a safe default."""
        from src.routers.local_content import _check_content_access
        db = self._make_db_session()
        with pytest.raises(HTTPException) as exc_info:
            _check_content_access(
                "something/unknown/file.txt",
                self._make_anon_user(), db
            )
        assert exc_info.value.status_code == 401

    def test_unknown_path_authenticated_allowed(self):
        """Unknown path patterns are allowed for authenticated users."""
        from src.routers.local_content import _check_content_access
        db = self._make_db_session()
        _check_content_access(
            "something/unknown/file.txt",
            self._make_auth_user(), db
        )


class TestS3ContentPathValidation:
    """Test _validate_content_path in content_files.py (S3 router)."""

    def _validate(self, path):
        from src.routers.content_files import _validate_content_path
        return _validate_content_path(path)

    def test_valid_path(self):
        assert self._validate("orgs/abc/courses/def/thumbnail.png") is True

    def test_directory_traversal(self):
        assert self._validate("../etc/passwd") is False

    def test_null_byte(self):
        assert self._validate("file\x00.txt") is False

    def test_url_encoded_traversal(self):
        assert self._validate("%2e%2e/etc/passwd") is False

    def test_absolute_path(self):
        assert self._validate("/etc/passwd") is False


class TestS3ContentAccess:
    """Test _check_content_access in content_files.py (S3 router)."""

    def _make_anon_user(self):
        from src.db.users import AnonymousUser
        return AnonymousUser()

    def _make_auth_user(self):
        user = MagicMock()
        user.id = 1
        return user

    def _make_db_session(self, course=None, podcast=None):
        session = MagicMock()
        result = MagicMock()
        if course is not None:
            result.first.return_value = course
        elif podcast is not None:
            result.first.return_value = podcast
        else:
            result.first.return_value = None
        session.exec.return_value = result
        return session

    def _make_course(self, public=True):
        course = MagicMock()
        course.public = public
        return course

    def test_public_course_anonymous_allowed(self):
        from src.routers.content_files import _check_content_access
        course = self._make_course(public=True)
        db = self._make_db_session(course=course)
        _check_content_access(
            "orgs/org1/courses/c1/activities/a1/file.mp4",
            self._make_anon_user(), db
        )

    def test_private_course_anonymous_rejected(self):
        from src.routers.content_files import _check_content_access
        course = self._make_course(public=False)
        db = self._make_db_session(course=course)
        with pytest.raises(HTTPException) as exc_info:
            _check_content_access(
                "orgs/org1/courses/c1/activities/a1/file.mp4",
                self._make_anon_user(), db
            )
        assert exc_info.value.status_code == 401

    def test_user_avatar_public(self):
        from src.routers.content_files import _check_content_access
        db = self._make_db_session()
        _check_content_access(
            "users/user1/avatars/pic.jpg",
            self._make_anon_user(), db
        )

    def test_org_content_public(self):
        from src.routers.content_files import _check_content_access
        db = self._make_db_session()
        _check_content_access(
            "orgs/org1/logo.png",
            self._make_anon_user(), db
        )
