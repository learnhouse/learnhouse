"""Tests for configure_captions() in src/services/courses/activities/video.py."""

from datetime import datetime

import pytest
from fastapi import HTTPException

from src.db.courses.activities import Activity, ActivitySubTypeEnum, ActivityTypeEnum
from src.services.courses.activities import video as video_mod
from src.services.courses.activities.video import CaptionsConfigIn, CaptionLanguageIn, configure_captions


async def _add_video(db, org, course, uuid):
    a = Activity(
        name="V",
        activity_type=ActivityTypeEnum.TYPE_VIDEO,
        activity_sub_type=ActivitySubTypeEnum.SUBTYPE_VIDEO_HOSTED,
        content={"filename": "v.mp4"},
        published=True,
        org_id=org.id,
        course_id=course.id,
        activity_uuid=uuid,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(a)
    await db.commit()
    return a


def _mock_common(monkeypatch, enqueued):
    async def _access(*a, **k):
        return True

    monkeypatch.setattr(video_mod, "check_resource_access", _access)

    import src.security.features_utils.usage as usage

    async def _feat(*a, **k):
        return True

    async def _summary(*a, **k):
        return {"remaining_credits": 100}

    monkeypatch.setattr(usage, "check_feature_enabled", _feat)
    monkeypatch.setattr(usage, "get_ai_credits_summary", _summary)

    import src.services.utils.caption_jobs as cj
    monkeypatch.setattr(cj, "enqueue", lambda uuid: enqueued.append(uuid))


async def test_configure_enables_and_enqueues(monkeypatch, db, org, course, chapter, activity):
    enqueued = []
    _mock_common(monkeypatch, enqueued)
    await _add_video(db, org, course, "capcfg1")
    cfg = CaptionsConfigIn(
        enabled=True, source_language="auto",
        languages=[CaptionLanguageIn(code="fr", label="French"),
                   CaptionLanguageIn(code="sw", label="Swahili")],  # custom lang
    )
    out = await configure_captions(None, "capcfg1", None, db, cfg)
    assert out["enabled"] is True
    assert out["status"] == "queued"
    assert [x["code"] for x in out["languages"]] == ["fr", "sw"]
    assert enqueued == ["capcfg1"]


async def test_configure_rejects_bad_code(monkeypatch, db, org, course, chapter, activity):
    _mock_common(monkeypatch, [])
    await _add_video(db, org, course, "capcfg2")
    cfg = CaptionsConfigIn(enabled=True, languages=[CaptionLanguageIn(code="../etc")])
    with pytest.raises(HTTPException) as ei:
        await configure_captions(None, "capcfg2", None, db, cfg)
    assert ei.value.status_code == 400


async def test_configure_enabled_needs_language(monkeypatch, db, org, course, chapter, activity):
    _mock_common(monkeypatch, [])
    await _add_video(db, org, course, "capcfg3")
    cfg = CaptionsConfigIn(enabled=True, languages=[])
    with pytest.raises(HTTPException) as ei:
        await configure_captions(None, "capcfg3", None, db, cfg)
    assert ei.value.status_code == 400


async def test_configure_disable_no_enqueue(monkeypatch, db, org, course, chapter, activity):
    enqueued = []
    _mock_common(monkeypatch, enqueued)
    await _add_video(db, org, course, "capcfg4")
    cfg = CaptionsConfigIn(enabled=False, languages=[])
    out = await configure_captions(None, "capcfg4", None, db, cfg)
    assert out["enabled"] is False and out["status"] == "idle"
    assert enqueued == []


async def test_configure_rejects_non_hosted(monkeypatch, db, org, course, chapter, activity):
    _mock_common(monkeypatch, [])
    a = Activity(
        name="Ext",
        activity_type=ActivityTypeEnum.TYPE_VIDEO,
        activity_sub_type=ActivitySubTypeEnum.SUBTYPE_VIDEO_YOUTUBE,
        content={"uri": "https://youtu.be/x"},
        published=True,
        org_id=org.id,
        course_id=course.id,
        activity_uuid="capcfg5",
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(a)
    await db.commit()
    cfg = CaptionsConfigIn(enabled=True, languages=[CaptionLanguageIn(code="fr")])
    with pytest.raises(HTTPException) as ei:
        await configure_captions(None, "capcfg5", None, db, cfg)
    assert ei.value.status_code == 400


async def test_configure_too_many_languages(monkeypatch, db, org, course, chapter, activity):
    _mock_common(monkeypatch, [])
    await _add_video(db, org, course, "capcfg7")
    many = [CaptionLanguageIn(code=f"l{i:02d}") for i in range(20)]
    cfg = CaptionsConfigIn(enabled=True, languages=many)
    with pytest.raises(HTTPException) as ei:
        await configure_captions(None, "capcfg7", None, db, cfg)
    assert ei.value.status_code == 400


async def test_configure_bad_source_language(monkeypatch, db, org, course, chapter, activity):
    _mock_common(monkeypatch, [])
    await _add_video(db, org, course, "capcfg8")
    cfg = CaptionsConfigIn(enabled=True, source_language="../x", languages=[CaptionLanguageIn(code="fr")])
    with pytest.raises(HTTPException) as ei:
        await configure_captions(None, "capcfg8", None, db, cfg)
    assert ei.value.status_code == 400


async def test_configure_no_credits_blocks(monkeypatch, db, org, course, chapter, activity):
    _mock_common(monkeypatch, [])
    import src.security.features_utils.usage as usage

    async def _empty(*a, **k):
        return {"remaining_credits": 0}

    monkeypatch.setattr(usage, "get_ai_credits_summary", _empty)
    await _add_video(db, org, course, "capcfg6")
    cfg = CaptionsConfigIn(enabled=True, languages=[CaptionLanguageIn(code="fr")])
    with pytest.raises(HTTPException) as ei:
        await configure_captions(None, "capcfg6", None, db, cfg)
    assert ei.value.status_code == 402
