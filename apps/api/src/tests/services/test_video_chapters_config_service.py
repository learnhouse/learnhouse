"""Tests for the chapter endpoints' services in src/services/courses/activities/video.py."""

from datetime import datetime

import pytest
from fastapi import HTTPException

from src.db.courses.activities import Activity, ActivitySubTypeEnum, ActivityTypeEnum
from src.services.courses.activities import video as video_mod
from src.services.courses.activities.video import (
    ChapterIn,
    ChaptersIn,
    request_chapters_generation,
    save_chapters,
)

READY_EN = {"source_language": "en", "languages": [{"code": "en", "status": "ready"}]}


async def _add_video(db, org, course, uuid, *, meta=None, sub_type=ActivitySubTypeEnum.SUBTYPE_VIDEO_HOSTED):
    a = Activity(
        name="V",
        activity_type=ActivityTypeEnum.TYPE_VIDEO,
        activity_sub_type=sub_type,
        content={"filename": "v.mp4"},
        published=True,
        org_id=org.id,
        course_id=course.id,
        activity_uuid=uuid,
        extra_metadata=meta,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(a)
    await db.commit()
    return a


def _mock_common(monkeypatch, *, remaining=100):
    async def _access(*a, **k):
        return True

    monkeypatch.setattr(video_mod, "check_resource_access", _access)

    import src.security.features_utils.usage as usage

    async def _feat(*a, **k):
        return True

    async def _summary(*a, **k):
        return {"remaining_credits": remaining}

    monkeypatch.setattr(usage, "check_feature_enabled", _feat)
    monkeypatch.setattr(usage, "get_ai_credits_summary", _summary)

    import src.security.auth as auth_mod
    import src.services.security.rate_limiting as rl

    monkeypatch.setattr(auth_mod, "resolve_acting_user_id", lambda user: 1)
    monkeypatch.setattr(rl, "enforce_ai_rate_limit", lambda user_id, org_id: None)


async def test_request_generation_queues_when_captions_ready(monkeypatch, db, org, course, chapter, activity):
    _mock_common(monkeypatch)
    await _add_video(db, org, course, "gen1", meta={"captions": READY_EN})
    out = await request_chapters_generation(None, "gen1", None, db)
    assert out["status"] == "queued"


async def test_request_generation_rejects_without_captions_or_credits(monkeypatch, db, org, course, chapter, activity):
    _mock_common(monkeypatch)
    await _add_video(db, org, course, "gen2", meta={})
    with pytest.raises(HTTPException) as e:
        await request_chapters_generation(None, "gen2", None, db)
    assert e.value.status_code == 400

    _mock_common(monkeypatch, remaining=0)
    await _add_video(db, org, course, "gen3", meta={"captions": READY_EN})
    with pytest.raises(HTTPException) as e:
        await request_chapters_generation(None, "gen3", None, db)
    assert e.value.status_code == 402


async def test_request_generation_rejects_non_hosted_and_missing(monkeypatch, db, org, course, chapter, activity):
    _mock_common(monkeypatch)
    await _add_video(db, org, course, "yt1", meta={"captions": READY_EN}, sub_type=ActivitySubTypeEnum.SUBTYPE_VIDEO_YOUTUBE)
    with pytest.raises(HTTPException) as e:
        await request_chapters_generation(None, "yt1", None, db)
    assert e.value.status_code == 400
    with pytest.raises(HTTPException) as e:
        await request_chapters_generation(None, "nope", None, db)
    assert e.value.status_code == 404


async def test_save_chapters_normalizes_and_clears(monkeypatch, db, org, course, chapter, activity):
    _mock_common(monkeypatch)
    await _add_video(db, org, course, "save1", meta={"chapters": {"status": "ready", "model": "m"}})
    out = await save_chapters(None, "save1", None, db, ChaptersIn(items=[
        ChapterIn(start=90, title=" Second "),
        ChapterIn(start=3, title="First"),
    ]))
    assert out["items"] == [{"start": 0.0, "title": "First"}, {"start": 90.0, "title": "Second"}]
    assert out["status"] == "ready"
    assert out["model"] is None

    cleared = await save_chapters(None, "save1", None, db, ChaptersIn(items=[]))
    assert (cleared["status"], cleared["items"]) == ("idle", [])


async def test_save_chapters_rejects_unusable_list(monkeypatch, db, org, course, chapter, activity):
    _mock_common(monkeypatch)
    await _add_video(db, org, course, "save2")
    with pytest.raises(HTTPException) as e:
        await save_chapters(None, "save2", None, db, ChaptersIn(items=[ChapterIn(start=0, title="Only")]))
    assert e.value.status_code == 400


async def test_chapters_need_an_existing_course(monkeypatch, db, org, course, chapter, activity):
    _mock_common(monkeypatch)
    a = await _add_video(db, org, course, "noCourse", meta={"captions": READY_EN})
    a.course_id = 999999
    db.add(a)
    await db.commit()
    with pytest.raises(HTTPException) as e:
        await request_chapters_generation(None, "noCourse", None, db)
    assert e.value.status_code == 404
