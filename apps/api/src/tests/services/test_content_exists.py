"""content_exists (filesystem and S3, cached), course cover status and the
external link checker used by the course audits."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest
from botocore.exceptions import BotoCoreError, ClientError

import src.services.utils.upload_content as uc
from src.services.ai.tools import link_check
from src.services.courses.thumbnails import thumbnail_status, thumbnail_statuses
from src.services.utils.ssrf_guard import SSRFBlockedError


def _config(kind: str):
    return SimpleNamespace(
        hosting_config=SimpleNamespace(
            content_delivery=SimpleNamespace(
                type=kind, s3api=SimpleNamespace(bucket_name="bucket", endpoint_url="https://s3.test")
            )
        )
    )


@pytest.fixture(autouse=True)
def fresh_cache():
    uc._exists_cache.clear()
    link_check._cache.clear()
    yield
    uc._exists_cache.clear()
    link_check._cache.clear()


# ─── content_exists ──────────────────────────────────────────────────────────


async def test_filesystem_found_missing_and_cached(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    folder = tmp_path / "content" / "orgs" / "org_x" / "courses" / "c1" / "thumbnails"
    folder.mkdir(parents=True)
    (folder / "a.png").write_bytes(b"x")
    with patch.object(uc, "get_learnhouse_config", return_value=_config("filesystem")):
        assert await uc.content_exists("courses/c1/thumbnails", "orgs", "org_x", "a.png") is True
        assert await uc.content_exists("courses/c1/thumbnails", "orgs", "org_x", "b.png") is False
        (folder / "a.png").unlink()
        # Still cached as present for a short while.
        assert await uc.content_exists("courses/c1/thumbnails", "orgs", "org_x", "a.png") is True


@pytest.mark.parametrize("name", ["", "../x.png", "a/b.png", "a\\b.png", "a\x00.png"])
async def test_bad_names_are_never_there(name):
    assert await uc.content_exists("courses/c1/thumbnails", "orgs", "org_x", name) is False


async def test_traversal_in_directory_is_missing(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    with patch.object(uc, "get_learnhouse_config", return_value=_config("filesystem")):
        assert await uc.content_exists("../../etc", "orgs", "org_x", "passwd") is False


async def test_cache_is_bounded(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(uc, "_EXISTS_MAX_ENTRIES", 2)
    with patch.object(uc, "get_learnhouse_config", return_value=_config("filesystem")):
        for n in range(3):
            await uc.content_exists("d", "orgs", "org_x", f"{n}.png")
    assert len(uc._exists_cache) == 1


def _client_error(code: str) -> ClientError:
    return ClientError({"Error": {"Code": code, "Message": "x"}}, "HeadObject")


async def test_s3_found_and_missing():
    s3 = MagicMock()
    with patch.object(uc, "get_learnhouse_config", return_value=_config("s3api")), patch.object(
        uc.boto3, "client", return_value=s3
    ):
        assert await uc.content_exists("d", "orgs", "org_x", "here.png") is True
        s3.head_object.assert_called_with(Bucket="bucket", Key="content/orgs/org_x/d/here.png")
        s3.head_object.side_effect = _client_error("404")
        assert await uc.content_exists("d", "orgs", "org_x", "gone.png") is False


async def test_s3_unknown_answers_count_as_present():
    s3 = MagicMock()
    with patch.object(uc, "get_learnhouse_config", return_value=_config("s3api")), patch.object(
        uc.boto3, "client", return_value=s3
    ):
        s3.head_object.side_effect = _client_error("403")
        assert await uc.content_exists("d", "orgs", "org_x", "a.png") is True
        s3.head_object.side_effect = BotoCoreError()
        assert await uc.content_exists("d", "orgs", "org_x", "b.png") is True
    assert uc._exists_cache == {}  # unknown answers are not kept


# ─── thumbnail status ────────────────────────────────────────────────────────


def _course(uuid="course_1", image=None, video=None):
    return SimpleNamespace(course_uuid=uuid, thumbnail_image=image, thumbnail_video=video)


async def test_thumbnail_status_cases():
    exists = AsyncMock(side_effect=lambda d, t, u, name: name == "ok.png")
    with patch("src.services.courses.thumbnails.content_exists", new=exists):
        assert await thumbnail_status("org_x", _course()) == "missing"
        assert await thumbnail_status("org_x", _course(image="  ")) == "missing"
        assert await thumbnail_status("org_x", _course(image="https://cdn/x.png")) == "ok"
        assert await thumbnail_status("org_x", _course(image="ok.png")) == "ok"
        assert await thumbnail_status("org_x", _course(image="gone.png")) == "broken"
        assert await thumbnail_status("org_x", _course(video="ok.png")) == "ok"
        exists.assert_awaited_with("courses/course_1/thumbnails", "orgs", "org_x", "ok.png")
        many = await thumbnail_statuses("org_x", [_course("a", image="ok.png"), _course("b", image="no.png")])
    assert many == {"a": "ok", "b": "broken"}


# ─── link_check ──────────────────────────────────────────────────────────────


class _Resp:
    def __init__(self, status, location=None):
        self.status_code = status
        self.is_redirect = location is not None
        self.next_request = SimpleNamespace(url=location) if location else None


class _Stream:
    def __init__(self, resp):
        self.resp = resp

    async def __aenter__(self):
        if isinstance(self.resp, Exception):
            raise self.resp
        return self.resp

    async def __aexit__(self, *a):
        return False


def _client(routes):
    """A fake httpx client: routes maps (method, url) or url to a response,
    an exception, or a list consumed in order."""

    class Client:
        def __init__(self, *a, **k):
            self.calls = []

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        def stream(self, method, url):
            self.calls.append((method, url))
            value = routes.get((method, url), routes.get(url))
            if isinstance(value, list):
                value = value.pop(0)
            return _Stream(value)

    return Client


@pytest.fixture
def guard():
    with patch.object(link_check, "resolve_and_validate_url", return_value={"1.2.3.4"}) as resolve, patch.object(
        link_check, "assert_connected_peer_allowed"
    ) as peer:
        yield resolve, peer


async def test_link_states(guard):
    routes = {
        "https://ok.test": _Resp(200),
        "https://gone.test": _Resp(404),
        "https://shy.test": _Resp(403),
        "https://slow.test": httpx.ReadTimeout("t"),
        "https://down.test": httpx.ConnectError("c"),
        ("HEAD", "https://moved.test"): _Resp(301, "https://ok.test"),
        ("HEAD", "https://nohead.test"): _Resp(405),
        ("GET", "https://nohead.test"): _Resp(200),
        "https://loop.test": _Resp(302, "https://loop.test"),
    }
    with patch.object(link_check.httpx, "AsyncClient", _client(routes)):
        out = await link_check.check_links(
            [
                "https://ok.test", "https://ok.test", "mailto:a@b.c", "/relative",
                "https://gone.test", "https://shy.test", "https://slow.test", "https://down.test",
                "https://moved.test", "https://nohead.test", "https://loop.test",
            ]
        )
    assert out["https://ok.test"] == {"state": "ok", "status": 200}
    assert out["https://gone.test"]["state"] == "broken" and out["https://gone.test"]["reason"] == "HTTP 404"
    assert out["https://shy.test"]["state"] == "unverified"
    assert out["https://slow.test"]["reason"] == "no answer (timed out)"
    assert out["https://down.test"]["reason"].startswith("could not connect")
    assert out["https://moved.test"]["state"] == "ok"
    assert out["https://nohead.test"]["state"] == "ok"
    assert out["https://loop.test"]["reason"] == "too many redirects"
    assert "mailto:a@b.c" not in out and "/relative" not in out


async def test_link_guard_refusals(guard):
    resolve, peer = guard
    resolve.side_effect = [SSRFBlockedError("Could not resolve hostname: x"), SSRFBlockedError("blocked range")]
    with patch.object(link_check.httpx, "AsyncClient", _client({})):
        out = await link_check.check_links(["https://nowhere.test", "https://internal.test"])
    assert out["https://nowhere.test"] == {"state": "broken", "status": None, "reason": "the domain does not exist"}
    assert out["https://internal.test"] == {"state": "skipped", "reason": "internal address"}

    resolve.side_effect = None
    peer.side_effect = SSRFBlockedError("rebound")
    with patch.object(link_check.httpx, "AsyncClient", _client({"https://rebind.test": _Resp(200)})):
        out = await link_check.check_links(["https://rebind.test"])
    assert out["https://rebind.test"]["state"] == "skipped"


async def test_links_are_cached_and_capped(guard, monkeypatch):
    monkeypatch.setattr(link_check, "MAX_URLS", 1)
    client = _client({"https://a.test": _Resp(200)})
    with patch.object(link_check.httpx, "AsyncClient", client):
        first = await link_check.check_links(["https://a.test", "https://b.test"])
        assert list(first) == ["https://a.test"]
        again = await link_check.check_links(["https://a.test"])
    assert again == first
    assert await link_check.check_links([]) == {}
