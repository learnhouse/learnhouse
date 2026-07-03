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
    def __init__(self, pending=None):
        self.pushed = []
        self.store = {}
        self._pending = list(pending or [])

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
        return list(self._pending)


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


def _mock_common_transcode(monkeypatch, statuses):
    async def fake_status(uuid, status, **extra):
        statuses.append((uuid, status, extra))
    monkeypatch.setattr(hls_jobs, "_set_block_status", fake_status)
    monkeypatch.setattr(hls_jobs, "_resolve_block_source", hls_jobs_aret({
        "org_uuid": "o", "course_uuid": "c", "activity_uuid": "a", "filename": "v.mp4",
    }))
    monkeypatch.setattr(hls_jobs, "_fetch_source", lambda *a, **k: True)


async def test_transcode_block_with_redis_and_s3(monkeypatch):
    """Covers the lease/heartbeat + S3 upload branches + success retry-clear."""
    statuses = []
    _mock_common_transcode(monkeypatch, statuses)
    r = _FakeRedis()
    monkeypatch.setattr(hls_jobs, "get_redis_client", lambda: r)

    async def fake_transcode(src, out):
        return {"master": "master.m3u8", "renditions": ["720p"], "thumbnails": None}
    monkeypatch.setattr(hls_jobs, "transcode_source_to_hls", fake_transcode)
    monkeypatch.setattr(hls_jobs, "is_s3_enabled", lambda: True)
    monkeypatch.setattr(hls_jobs, "upload_directory_to_s3", lambda out, prefix: True)

    ok = await hls_jobs.transcode_block("act_1", "block_1")
    assert ok is True
    assert statuses[-1][1] == "ready"
    # lease was set then cleaned up
    assert hls_jobs._lease_key("block:block_1") not in r.store


async def test_transcode_block_transcode_failed(monkeypatch):
    statuses = []
    _mock_common_transcode(monkeypatch, statuses)
    monkeypatch.setattr(hls_jobs, "get_redis_client", lambda: None)
    monkeypatch.setattr(hls_jobs, "transcode_source_to_hls", hls_jobs_aret(None))
    ok = await hls_jobs.transcode_block("a", "b")
    assert ok is False
    assert statuses[-1][2]["error"] == "transcode_failed"


async def test_transcode_block_upload_failed(monkeypatch):
    statuses = []
    _mock_common_transcode(monkeypatch, statuses)
    monkeypatch.setattr(hls_jobs, "get_redis_client", lambda: None)
    monkeypatch.setattr(hls_jobs, "transcode_source_to_hls", hls_jobs_aret({"master": "m", "renditions": ["720p"]}))
    monkeypatch.setattr(hls_jobs, "is_s3_enabled", lambda: True)
    monkeypatch.setattr(hls_jobs, "upload_directory_to_s3", lambda out, prefix: False)
    ok = await hls_jobs.transcode_block("a", "b")
    assert ok is False
    assert statuses[-1][2]["error"] == "upload_failed"


async def test_transcode_block_exception(monkeypatch):
    statuses = []
    _mock_common_transcode(monkeypatch, statuses)
    monkeypatch.setattr(hls_jobs, "get_redis_client", lambda: None)
    async def boom(src, out):
        raise RuntimeError("ffmpeg blew up")
    monkeypatch.setattr(hls_jobs, "transcode_source_to_hls", boom)
    ok = await hls_jobs.transcode_block("a", "b")
    assert ok is False
    assert statuses[-1][2]["error"] == "exception"


async def test_mark_failed_routes(monkeypatch):
    calls = []
    async def fake_block(uuid, status, **extra):
        calls.append(("block", uuid, extra.get("error")))
    async def fake_act(uuid, status, **extra):
        calls.append(("activity", uuid, extra.get("error")))
    monkeypatch.setattr(hls_jobs, "_set_block_status", fake_block)
    monkeypatch.setattr(hls_jobs, "_set_status", fake_act)
    await hls_jobs._mark_failed({"kind": "block", "block_uuid": "b1"}, "timeout")
    await hls_jobs._mark_failed({"kind": "activity", "activity_uuid": "a1"}, "timeout")
    assert calls == [("block", "b1", "timeout"), ("activity", "a1", "timeout")]


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


async def test_reconcile_skips_leased_block(monkeypatch, db, org, course, chapter, activity):
    _bind_session(monkeypatch, db)
    await _add_video_block(db, org, course, activity, "block_leased")
    r = _FakeRedis()
    r.store[hls_jobs._lease_key("block:block_leased")] = "1"  # actively transcoding
    monkeypatch.setattr(hls_jobs, "get_redis_client", lambda: r)
    result = await hls_jobs.reconcile_unfinished()
    assert hls_jobs._block_item(activity.activity_uuid, "block_leased") not in r.pushed
    assert result["skipped"] >= 1


async def test_reconcile_gives_up_block_at_max_retries(monkeypatch, db, org, course, chapter, activity):
    _bind_session(monkeypatch, db)
    await _add_video_block(db, org, course, activity, "block_broken")
    r = _FakeRedis()
    r.store[hls_jobs._retries_key("block:block_broken")] = hls_jobs.hls_max_retries()
    monkeypatch.setattr(hls_jobs, "get_redis_client", lambda: r)
    result = await hls_jobs.reconcile_unfinished()
    assert hls_jobs._block_item(activity.activity_uuid, "block_broken") not in r.pushed
    assert result["gaveup"] >= 1


def hls_jobs_aret(value):
    async def _f(*a, **k):
        return value
    return _f


# --- extra edge coverage ---

def test_enqueue_block_no_redis_is_noop(monkeypatch):
    monkeypatch.setattr(hls_jobs, "hls_enabled", lambda: True)
    monkeypatch.setattr(hls_jobs, "get_redis_client", lambda: None)
    hls_jobs.enqueue_block("a", "b")  # must not raise


async def test_set_block_status_missing_block_is_noop(monkeypatch, db, org, course, chapter, activity):
    _bind_session(monkeypatch, db)
    await hls_jobs._set_block_status("does_not_exist", "processing")  # no raise


async def test_resolve_block_source_non_video_and_no_file(monkeypatch, db, org, course, chapter, activity):
    _bind_session(monkeypatch, db)
    # non-video block
    img = Block(
        block_type=BlockTypeEnum.BLOCK_IMAGE, content={"file_id": "x", "file_format": "png"},
        org_id=org.id, course_id=course.id, activity_id=activity.id, block_uuid="block_img",
        creation_date=str(datetime.now()), update_date=str(datetime.now()),
    )
    db.add(img)
    # video block missing file_id
    nofile = Block(
        block_type=BlockTypeEnum.BLOCK_VIDEO, content={"activity_uuid": activity.activity_uuid},
        org_id=org.id, course_id=course.id, activity_id=activity.id, block_uuid="block_nofile",
        creation_date=str(datetime.now()), update_date=str(datetime.now()),
    )
    db.add(nofile)
    await db.commit()
    assert await hls_jobs._resolve_block_source("block_img") is None
    assert await hls_jobs._resolve_block_source("block_nofile") is None

    # unsafe filename (traversal in file_id) is rejected
    await _add_video_block(db, org, course, activity, "block_badname", file_id="../evil", fmt="mp4")
    assert await hls_jobs._resolve_block_source("block_badname") is None


async def test_reconcile_skips_pending_and_nofile_blocks(monkeypatch, db, org, course, chapter, activity):
    _bind_session(monkeypatch, db)
    await _add_video_block(db, org, course, activity, "block_pending")
    # video block with no file_id -> continue (skipped silently)
    nofile = Block(
        block_type=BlockTypeEnum.BLOCK_VIDEO, content={"activity_uuid": activity.activity_uuid},
        org_id=org.id, course_id=course.id, activity_id=activity.id, block_uuid="block_nofile2",
        creation_date=str(datetime.now()), update_date=str(datetime.now()),
    )
    db.add(nofile)
    await db.commit()
    # video block with hls status but NO activity_uuid -> skipped (can't build a job)
    noact = Block(
        block_type=BlockTypeEnum.BLOCK_VIDEO, content={"file_id": "z", "file_format": "mp4", "hls": {"status": "failed"}},
        org_id=org.id, course_id=course.id, activity_id=activity.id, block_uuid="block_noact",
        creation_date=str(datetime.now()), update_date=str(datetime.now()),
    )
    db.add(noact)
    await db.commit()
    pending_item = hls_jobs._block_item(activity.activity_uuid, "block_pending")
    r = _FakeRedis(pending=[pending_item])
    monkeypatch.setattr(hls_jobs, "get_redis_client", lambda: r)
    result = await hls_jobs.reconcile_unfinished()
    # already-pending block is not re-pushed; the no-activity_uuid block isn't queued
    assert pending_item not in r.pushed
    assert not any("block_noact" in p for p in r.pushed)
    assert result["skipped"] >= 1
