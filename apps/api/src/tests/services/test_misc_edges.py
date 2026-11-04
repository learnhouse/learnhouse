"""Edge branches across smaller services: webhook endpoint cache and log
pruning, playground sessions and rights, explore sorting, library search,
nudges, media streaming, and a few string helpers."""

from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, Mock, patch

import pytest
from fastapi import HTTPException
from sqlalchemy.dialects import postgresql

from src.db.courses.courses import Course
from src.db.folders.folder_content import FolderContent
from src.db.organizations import Organization
from src.db.playgrounds import Playground
from src.db.podcasts.podcasts import PodcastUpdate
from src.db.users import AnonymousUser
from src.services.boards import boards_playground as bp
from src.services.boards.schemas.boards_playground import BoardsPlaygroundContext
from src.services.communities.moderation import extract_youtube_video_id
from src.services.email.safe_text import header_safe
from src.services.email.utils import get_org_square_logo_url
from src.services.explore.explore import _get_sort_expression, search_orgs_for_explore
from src.services.folders import folders as folders_service
from src.services.media import media_serve
from src.services.playgrounds import playgrounds as playgrounds_service
from src.services.podcasts.podcasts import update_podcast
from src.services.search.search import _ilike_terms
from src.services.webhooks import dispatch
from src.tests.services.test_podcasts_service import _make_podcast


# ─── webhooks/dispatch.py ────────────────────────────────────────────────────


class _BrokenRedis:
    def get(self, *_a, **_k):
        raise ConnectionError("redis down")

    def set(self, *_a, **_k):
        raise ConnectionError("redis down")

    def delete(self, *_a, **_k):
        raise ConnectionError("redis down")


def test_active_endpoint_cache_reads_the_flag():
    redis = Mock()
    with patch("src.core.redis.get_redis_client", return_value=redis):
        redis.get.return_value = b"1"
        assert dispatch._active_cache_get(5) is True
        redis.get.return_value = "0"
        assert dispatch._active_cache_get(5) is False
        # Not cached yet: the caller has to ask the database.
        redis.get.return_value = None
        assert dispatch._active_cache_get(5) is None
    redis.get.assert_called_with("webhooks:has_active:5")


def test_active_endpoint_cache_without_redis_is_a_noop():
    with patch("src.core.redis.get_redis_client", return_value=None):
        assert dispatch._active_cache_get(5) is None
        assert dispatch._active_cache_set(5, True) is None
        assert dispatch.invalidate_active_endpoint_cache(5) is None


def test_active_endpoint_cache_tolerates_redis_errors():
    """Redis trouble falls back to querying the database; it never raises."""
    with patch("src.core.redis.get_redis_client", return_value=_BrokenRedis()):
        assert dispatch._active_cache_get(5) is None
        assert dispatch._active_cache_set(5, False) is None
        assert dispatch.invalidate_active_endpoint_cache(5) is None


async def test_prune_delivery_logs_swallows_database_errors():
    def broken_factory():
        raise RuntimeError("db down")

    with patch.object(dispatch, "_async_session_factory", broken_factory), \
         patch.object(dispatch.logger, "warning") as warn:
        await dispatch._prune_delivery_logs(7)
    warn.assert_called_once()


# ─── boards playground sessions ──────────────────────────────────────────────


def test_board_session_owner_unknown_without_redis():
    with patch.object(bp, "get_redis_connection", return_value=None):
        assert bp.get_boards_playground_session_owner("pg_1") is None


def test_board_session_owner_unknown_when_not_recorded():
    redis = Mock()
    redis.get.return_value = None
    with patch.object(bp, "get_redis_connection", return_value=redis):
        assert bp.get_boards_playground_session_owner("pg_1") is None


def test_board_session_owner_unknown_on_redis_error():
    with patch.object(bp, "get_redis_connection", return_value=_BrokenRedis()):
        assert bp.get_boards_playground_session_owner("pg_1") is None


def test_board_session_created_even_when_owner_cannot_be_saved():
    redis = Mock()
    redis.setex.side_effect = ConnectionError("redis down")
    context = BoardsPlaygroundContext(board_name="b", board_description="d")
    with patch.object(bp, "get_redis_connection", return_value=redis), \
         patch.object(bp, "save_boards_playground_session", return_value=True) as save:
        session = bp.create_boards_playground_session("block_1", "board_1", context, user_id=3)
    assert session.session_uuid.startswith("pg_")
    save.assert_called_once_with(session)


# ─── playgrounds.py ──────────────────────────────────────────────────────────


def _session_returning(*rows):
    results = []
    for row in rows:
        result = Mock()
        result.scalars.return_value.first.return_value = row
        results.append(result)
    return SimpleNamespace(execute=AsyncMock(side_effect=results))


@pytest.mark.parametrize(
    "role, expected",
    [
        (None, {}),
        (SimpleNamespace(rights={}), {}),
        (SimpleNamespace(rights=SimpleNamespace(model_dump=lambda: {"playgrounds": {"action_read": True}})), {"playgrounds": {"action_read": True}}),
        (SimpleNamespace(rights=object()), {}),
    ],
)
async def test_member_rights_from_missing_or_model_roles(role, expected):
    session = _session_returning(SimpleNamespace(role_id=4), role)
    with patch.object(playgrounds_service, "is_user_superadmin", new=AsyncMock(return_value=False)), \
         patch("src.security.org_auth.enforce_org_mfa", new_callable=AsyncMock):
        assert await playgrounds_service._get_user_rights(2, 1, session) == expected


async def test_thumbnail_update_needs_the_org(db, org, admin_user, mock_request):
    db.add(Playground(name="P", org_id=999, playground_uuid="playground_orphan", created_by=admin_user.id))
    await db.commit()
    with patch.object(playgrounds_service, "_get_user_rights", new=AsyncMock(return_value={"playgrounds": {"action_update": True}})):
        with pytest.raises(HTTPException) as exc:
            await playgrounds_service.update_playground_thumbnail(mock_request, "playground_orphan", admin_user, db, None)
    assert exc.value.status_code == 404
    assert exc.value.detail == "Organization not found"


# ─── explore.py ──────────────────────────────────────────────────────────────


def test_explore_sort_is_salted_only_for_safe_salts():
    assert _get_sort_expression("bad salt!") is Organization.name
    salted = _get_sort_expression("abc-123")
    assert salted is not Organization.name
    assert "md5" in str(salted.compile(dialect=postgresql.dialect()))


async def test_explore_search_filters_by_label(db, mock_request):
    now = str(datetime.now())
    for i, label in enumerate(["science", "art"], start=1):
        db.add(Organization(
            id=10 + i, name=f"Academy {label}", slug=f"academy-{label}", email=f"{label}@x.com",
            org_uuid=f"org_{label}", explore=True, label=label, creation_date=now, update_date=now,
        ))
    await db.commit()
    results = await search_orgs_for_explore(mock_request, db, "academy", label="science")
    assert [o.slug for o in results] == ["academy-science"]


# ─── folders.py ──────────────────────────────────────────────────────────────


def test_is_anonymous():
    assert folders_service._is_anonymous(AnonymousUser()) is True


async def test_folder_content_must_be_a_known_resource_in_the_org(db, org):
    with pytest.raises(HTTPException) as missing:
        await folders_service._require_resource_in_org(db, "course_missing", org.id)
    assert missing.value.status_code == 404
    with pytest.raises(HTTPException) as unknown:
        await folders_service._require_resource_in_org(db, "spreadsheet_1", org.id)
    assert unknown.value.status_code == 400
    assert unknown.value.detail == "Unsupported resource type"


async def test_library_search_caps_content_results(db, org, folder, mock_request, monkeypatch):
    now = str(datetime.now())
    db.add(Course(
        id=2, name="Test Course Two", description="", public=True, published=True,
        open_to_contributors=False, org_id=org.id, course_uuid="course_two", creation_date=now, update_date=now,
    ))
    db.add(FolderContent(folder_id=folder.id, resource_uuid="course_two", org_id=org.id, position=1, creation_date=now, update_date=now))
    await db.commit()
    monkeypatch.setattr(folders_service, "LIBRARY_SEARCH_MAX_RESULTS", 1)
    with patch.object(folders_service, "_can_read_item", new=AsyncMock(return_value=True)):
        result = await folders_service.search_library(mock_request, str(org.id), "test course", AnonymousUser(), db)
    assert len(result["items"]) == 1


# ─── nudges/runner.py ────────────────────────────────────────────────────────


async def test_nudge_run_survives_a_failed_rollback_after_reconcile(db):
    from src.services.nudges.runner import run_nudges

    now = datetime(2026, 11, 4, tzinfo=timezone.utc)
    with patch("src.services.nudges.delivery.reconcile_delivery", new=AsyncMock(side_effect=RuntimeError("provider down"))), \
         patch.object(db, "rollback", new=AsyncMock(side_effect=RuntimeError("connection lost"))) as rollback:
        stats = await run_nudges(db, seed=True, force=True, now=now)
    rollback.assert_awaited_once()
    assert stats.sent == 0


# ─── media streaming ─────────────────────────────────────────────────────────


async def test_local_stream_stops_when_the_file_shrinks(tmp_path, monkeypatch):
    """A file truncated mid-stream ends the range response instead of looping."""
    monkeypatch.chdir(tmp_path)
    (tmp_path / "content").mkdir()
    target = tmp_path / "content" / "clip.bin"
    target.write_bytes(b"0123456789")

    response = media_serve._serve_fs("clip.bin", "application/octet-stream", {}, "bytes=0-9", False)
    target.write_bytes(b"0123")
    chunks = [chunk async for chunk in response.body_iterator]
    assert response.status_code == 206
    assert b"".join(chunks) == b"0123"


async def test_s3_stream_stops_on_an_empty_body():
    body = MagicMock()
    body.read.return_value = b""
    s3 = MagicMock()
    s3.head_object.return_value = {"ContentLength": 10}
    s3.get_object.return_value = {"Body": body}
    with patch.object(media_serve, "get_storage_client", return_value=s3), \
         patch.object(media_serve, "get_s3_bucket_name", return_value="bucket"):
        response = media_serve._serve_s3("clip.bin", "application/octet-stream", {}, None, False)
        chunks = [chunk async for chunk in response.body_iterator]
    assert chunks == []
    s3.get_object.assert_called_once()
    body.close.assert_called_once()


# ─── small helpers ───────────────────────────────────────────────────────────


def test_malformed_youtube_url_is_not_a_video():
    assert extract_youtube_video_id("http://[::1") is None


def test_ilike_terms_without_terms_matches_everything():
    assert str(_ilike_terms([Course.name], [])) == "true"


def test_header_safe_handles_empty_values():
    assert header_safe("") == ""
    assert header_safe(None) == ""


def test_square_logo_needs_a_media_host():
    org = SimpleNamespace(org_uuid="org_x")
    config = SimpleNamespace(config={"general": {"square_logo_image": "sq.png"}})
    with patch("src.services.email.utils.get_media_base_url", return_value=""):
        assert get_org_square_logo_url(org, config) is None
    with patch("src.services.email.utils.get_media_base_url", return_value="https://media.test"):
        assert get_org_square_logo_url(org, config) == "https://media.test/content/orgs/org_x/square_logos/sq.png"


async def test_publishing_a_podcast_is_a_sensitive_change(db, org, admin_user, mock_request):
    """Changing `published` goes through the owner/admin check like `public` does."""
    podcast = await _make_podcast(db, org, published=False)
    with patch("src.services.podcasts.podcasts.check_resource_access", new_callable=AsyncMock), \
         patch(
             "src.services.podcasts.podcasts.authorization_verify_based_on_org_admin_status",
             new=AsyncMock(return_value=False),
         ):
        with pytest.raises(HTTPException) as exc:
            await update_podcast(mock_request, PodcastUpdate(published=True), podcast.podcast_uuid, admin_user, db)
    assert exc.value.status_code == 403
    assert "published" in exc.value.detail

