"""Tests for the video-BLOCK HLS path in src/services/utils/hls_jobs.py.

The block path reuses the same queue/consumer/reconciler as activities; these
tests cover queue-item parsing, block status writes, source resolution, dispatch
routing, transcode_block, and the reconciler's block pass.
"""

from datetime import datetime


from src.db.courses.blocks import Block, BlockTypeEnum
from src.services.utils import hls_jobs


class _FactoryCtx:
    def __init__(self, session):
        self._session = session

    async def __aenter__(self):
        return self._session

    async def __aexit__(self, *exc):
        return False


def _bind_session(monkeypatch, session):
    monkeypatch.setattr(hls_jobs, "_async_session_factory", lambda: _FactoryCtx(session))


class _FakeRedis:
    def __init__(self):
        self.pushed = []
        self.store = {}

    def rpush(self, key, val):
        self.pushed.append(val)

    def set(self, k, v, ex=None):
        self.store[k] = v

    def get(self, k):
        return self.store.get(k)

    def delete(self, *keys):
        for k in keys:
            self.store.pop(k, None)

    def exists(self, k):
        return 1 if k in self.store else 0

    def incr(self, k):
        self.store[k] = int(self.store.get(k, 0)) + 1
        return self.store[k]

    def expire(self, k, ttl):
        return True

    def lrange(self, key, a, b):
        return []


async def _add_video_block(db, org, course, activity, block_uuid, *, file_id="f1", fmt="mp4", hls=None):
    content = {"file_id": file_id, "file_format": fmt, "activity_uuid": activity.activity_uuid}
    if hls is not None:
        content["hls"] = hls
    b = Block(
        block_type=BlockTypeEnum.BLOCK_VIDEO,
        content=content,
        org_id=org.id,
        course_id=course.id,
        activity_id=activity.id,
        block_uuid=block_uuid,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(b)
    await db.commit()
    return b


# --- queue item parsing ---

def test_parse_item_block_and_activity():
    item = hls_jobs._block_item("act_1", "block_1")
    assert hls_jobs._parse_item(item) == {"kind": "block", "activity_uuid": "act_1", "block_uuid": "block_1"}
    assert hls_jobs._parse_item("act_uuid") == {"kind": "activity", "activity_uuid": "act_uuid"}
    # malformed json falls back to activity
    assert hls_jobs._parse_item("{not json")["kind"] == "activity"


def test_enqueue_block_noop_when_disabled(monkeypatch):
    monkeypatch.setattr(hls_jobs, "hls_enabled", lambda: False)
    touched = {"redis": False}
    monkeypatch.setattr(hls_jobs, "get_redis_client", lambda: touched.__setitem__("redis", True))
    hls_jobs.enqueue_block("act", "block")
    assert touched["redis"] is False


def test_enqueue_block_pushes_json(monkeypatch):
    monkeypatch.setattr(hls_jobs, "hls_enabled", lambda: True)
    r = _FakeRedis()
    monkeypatch.setattr(hls_jobs, "get_redis_client", lambda: r)
    hls_jobs.enqueue_block("act_1", "block_1")
    assert r.pushed == [hls_jobs._block_item("act_1", "block_1")]


# --- status writes + source resolution (real DB) ---

async def test_set_block_status_writes_content_hls(monkeypatch, db, org, course, chapter, activity):
    _bind_session(monkeypatch, db)
    b = await _add_video_block(db, org, course, activity, "block_status")
    await hls_jobs._set_block_status("block_status", "processing")
    refreshed = await db.get(Block, b.id)
    assert refreshed.content["hls"]["status"] == "processing"
    assert "updated_at" in refreshed.content["hls"]

    await hls_jobs._set_block_status("block_status", "ready", master="master.m3u8", renditions=["720p"])
    refreshed = await db.get(Block, b.id)
    assert refreshed.content["hls"]["status"] == "ready"
    assert refreshed.content["hls"]["renditions"] == ["720p"]
    # existing block fields preserved
    assert refreshed.content["file_id"] == "f1"


async def test_resolve_block_source(monkeypatch, db, org, course, chapter, activity):
    _bind_session(monkeypatch, db)
    await _add_video_block(db, org, course, activity, "block_src", file_id="abc", fmt="mp4")
    info = await hls_jobs._resolve_block_source("block_src")
    assert info["org_uuid"] == org.org_uuid
    assert info["course_uuid"] == course.course_uuid
    assert info["activity_uuid"] == activity.activity_uuid
    assert info["filename"] == "abc.mp4"

    # missing block / missing file
    assert await hls_jobs._resolve_block_source("nope") is None


# --- dispatch routing ---

async def test_dispatch_routes_block_and_activity(monkeypatch):
    calls = []
    async def fake_block(a, b):
        calls.append(("block", a, b))
        return True
    async def fake_activity(a):
        calls.append(("activity", a))
        return True
    monkeypatch.setattr(hls_jobs, "transcode_block", fake_block)
    monkeypatch.setattr(hls_jobs, "transcode_activity", fake_activity)
    await hls_jobs._dispatch({"kind": "block", "activity_uuid": "a1", "block_uuid": "b1"})
    await hls_jobs._dispatch({"kind": "activity", "activity_uuid": "a2"})
    assert calls == [("block", "a1", "b1"), ("activity", "a2")]


# --- transcode_block happy + failure paths (mocked I/O) ---

async def test_transcode_block_happy_path(monkeypatch):
    statuses = []
    async def fake_status(uuid, status, **extra):
        statuses.append((uuid, status, extra))
    monkeypatch.setattr(hls_jobs, "_set_block_status", fake_status)
    monkeypatch.setattr(hls_jobs, "get_redis_client", lambda: None)
    monkeypatch.setattr(hls_jobs, "_resolve_block_source", hls_jobs_aret({
        "org_uuid": "org_1", "course_uuid": "course_1", "activity_uuid": "act_1", "filename": "v.mp4",
    }))
    monkeypatch.setattr(hls_jobs, "_fetch_source", lambda *a, **k: True)
    async def fake_transcode(src, out):
        return {"master": "master.m3u8", "renditions": ["720p", "480p"], "thumbnails": {"url": "thumbnails/sprite.jpg"}}
    monkeypatch.setattr(hls_jobs, "transcode_source_to_hls", fake_transcode)
    monkeypatch.setattr(hls_jobs, "is_s3_enabled", lambda: False)
    import shutil
    monkeypatch.setattr(shutil, "copytree", lambda *a, **k: None)

    ok = await hls_jobs.transcode_block("act_1", "block_1")
    assert ok is True
    assert statuses[0][1] == "processing"
    assert statuses[-1][1] == "ready"
    assert statuses[-1][2]["renditions"] == ["720p", "480p"]


async def test_transcode_block_source_unavailable(monkeypatch):
    statuses = []
    async def fake_status(uuid, status, **extra):
        statuses.append((uuid, status, extra))
    monkeypatch.setattr(hls_jobs, "_set_block_status", fake_status)
    monkeypatch.setattr(hls_jobs, "get_redis_client", lambda: None)
    monkeypatch.setattr(hls_jobs, "_resolve_block_source", hls_jobs_aret({
        "org_uuid": "o", "course_uuid": "c", "activity_uuid": "a", "filename": "v.mp4",
    }))
    monkeypatch.setattr(hls_jobs, "_fetch_source", lambda *a, **k: False)
    ok = await hls_jobs.transcode_block("a", "b")
    assert ok is False
    assert statuses[-1][1] == "failed"
    assert statuses[-1][2]["error"] == "source_unavailable"


async def test_transcode_block_no_source_returns_false(monkeypatch):
    monkeypatch.setattr(hls_jobs, "_resolve_block_source", hls_jobs_aret(None))
    assert await hls_jobs.transcode_block("a", "b") is False


# --- reconciler block pass ---

async def test_reconcile_requeues_unready_block(monkeypatch, db, org, course, chapter, activity):
    _bind_session(monkeypatch, db)
    await _add_video_block(db, org, course, activity, "block_todo")  # no hls -> unready
    await _add_video_block(db, org, course, activity, "block_ready", file_id="r", hls={"status": "ready"})
    r = _FakeRedis()
    monkeypatch.setattr(hls_jobs, "get_redis_client", lambda: r)

    result = await hls_jobs.reconcile_unfinished()
    # the unready block is requeued as a block job; the ready one is skipped
    assert hls_jobs._block_item(activity.activity_uuid, "block_todo") in r.pushed
    assert result["requeued"] >= 1


def hls_jobs_aret(value):
    async def _f(*a, **k):
        return value
    return _f
