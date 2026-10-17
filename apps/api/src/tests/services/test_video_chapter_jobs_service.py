"""Tests for src/services/utils/chapter_jobs.py (AI chapters job + backfill)."""

from datetime import datetime

from fastapi import HTTPException

from src.db.courses.activities import Activity, ActivitySubTypeEnum, ActivityTypeEnum
from src.db.organization_config import OrganizationConfig
from src.services.utils import chapter_jobs as jobs

READY_EN = {
    "enabled": True,
    "source_language": "en",
    "languages": [{"code": "en", "label": "English", "status": "ready"}],
}


class _FactoryCtx:
    def __init__(self, session):
        self._session = session

    async def __aenter__(self):
        return self._session

    async def __aexit__(self, *exc):
        return False


def _bind_session(monkeypatch, session):
    monkeypatch.setattr(jobs, "_async_session_factory", lambda: _FactoryCtx(session))


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


async def _meta(db, uuid):
    db.expire_all()
    from sqlmodel import select

    a = (await db.execute(select(Activity).where(Activity.activity_uuid == uuid))).scalars().first()
    return a.extra_metadata or {}


def _mock_ai(monkeypatch, *, items=None, error=None, vtt=b"WEBVTT\n\n00:00.000 --> 00:02.000\nHi\n"):
    refunds = []

    async def _feat(*a, **k):
        return True

    async def _reserve(*a, **k):
        return 1

    async def _generate(vtt_text, model_name, duration=None):
        if error:
            raise error
        return items or [{"start": 0.0, "title": "A"}, {"start": 30.0, "title": "B"}]

    import src.security.features_utils.usage as usage
    import src.services.ai.llm as llm

    monkeypatch.setattr(usage, "check_feature_enabled", _feat)
    monkeypatch.setattr(usage, "reserve_ai_credit", _reserve)
    monkeypatch.setattr(usage, "refund_ai_credit", lambda org_id, amount=1: refunds.append(amount))
    monkeypatch.setattr(llm, "model_for_tier", lambda tier: f"model-{tier}")
    monkeypatch.setattr(jobs.chap, "generate_chapters", _generate)
    monkeypatch.setattr(jobs, "read_file_content", lambda key: vtt)
    return refunds


def test_pick_caption_language_prefers_ready_source():
    assert jobs.pick_caption_language(READY_EN) == "en"
    caps = {
        "source_language": "fr",
        "languages": [
            {"code": "fr", "status": "processing"},
            {"code": "../x", "status": "ready"},
            {"code": "de", "status": "ready"},
        ],
    }
    assert jobs.pick_caption_language(caps) == "de"
    assert jobs.pick_caption_language({}) is None
    assert jobs.pick_caption_language({"languages": [{"code": "en", "status": "failed"}]}) is None


async def test_generate_stores_ready_chapters_with_fast_model(monkeypatch, db, org, course, chapter, activity):
    _bind_session(monkeypatch, db)
    _mock_ai(monkeypatch)
    await _add_video(db, org, course, "chapA", meta={"captions": READY_EN})
    assert await jobs.generate_activity_chapters("chapA") is True
    stored = (await _meta(db, "chapA"))["chapters"]
    assert stored["status"] == "ready"
    assert stored["items"] == [{"start": 0.0, "title": "A"}, {"start": 30.0, "title": "B"}]
    assert stored["language"] == "en"
    assert stored["model"] == "model-fast"
    assert (await _meta(db, "chapA"))["captions"] == READY_EN


async def test_generate_skips_ready_unless_forced(monkeypatch, db, org, course, chapter, activity):
    _bind_session(monkeypatch, db)
    _mock_ai(monkeypatch, items=[{"start": 0.0, "title": "New"}, {"start": 50.0, "title": "Newer"}])
    old = {"status": "ready", "items": [{"start": 0.0, "title": "Old"}]}
    await _add_video(db, org, course, "chapB", meta={"captions": READY_EN, "chapters": old})
    assert await jobs.generate_activity_chapters("chapB") is True
    assert (await _meta(db, "chapB"))["chapters"]["items"][0]["title"] == "Old"
    assert await jobs.generate_activity_chapters("chapB", force=True) is True
    assert (await _meta(db, "chapB"))["chapters"]["items"][0]["title"] == "New"


async def test_generate_needs_ready_captions_and_hosted_video(monkeypatch, db, org, course, chapter, activity):
    _bind_session(monkeypatch, db)
    _mock_ai(monkeypatch)
    await _add_video(db, org, course, "chapC", meta={"captions": {"languages": []}})
    await _add_video(db, org, course, "chapYT", meta={"captions": READY_EN}, sub_type=ActivitySubTypeEnum.SUBTYPE_VIDEO_YOUTUBE)
    assert await jobs.generate_activity_chapters("chapC") is False
    assert await jobs.generate_activity_chapters("chapYT") is False
    assert await jobs.generate_activity_chapters("missing") is False
    assert "chapters" not in await _meta(db, "chapC")


async def test_generate_records_missing_caption_file(monkeypatch, db, org, course, chapter, activity):
    _bind_session(monkeypatch, db)
    refunds = _mock_ai(monkeypatch, vtt=None)
    await _add_video(db, org, course, "chapD", meta={"captions": READY_EN})
    assert await jobs.generate_activity_chapters("chapD") is False
    assert (await _meta(db, "chapD"))["chapters"]["error"] == "captions_unavailable"
    assert refunds == []


async def test_generate_refunds_when_model_output_unusable(monkeypatch, db, org, course, chapter, activity):
    _bind_session(monkeypatch, db)
    refunds = _mock_ai(monkeypatch, error=ValueError("nothing"))
    await _add_video(db, org, course, "chapE", meta={"captions": READY_EN})
    assert await jobs.generate_activity_chapters("chapE") is False
    stored = (await _meta(db, "chapE"))["chapters"]
    assert (stored["status"], stored["error"]) == ("failed", "no_chapters")
    assert refunds == [jobs.CHAPTERS_CREDIT_COST]


async def test_generate_refunds_on_crash_but_not_on_credit_refusal(monkeypatch, db, org, course, chapter, activity):
    _bind_session(monkeypatch, db)
    refunds = _mock_ai(monkeypatch, error=RuntimeError("boom"))
    await _add_video(db, org, course, "chapF", meta={"captions": READY_EN})
    assert await jobs.generate_activity_chapters("chapF") is False
    assert (await _meta(db, "chapF"))["chapters"]["error"] == "exception"
    assert refunds == [1]

    refunds.clear()
    import src.security.features_utils.usage as usage

    async def _no_credits(*a, **k):
        raise HTTPException(status_code=403, detail="AI credits exhausted")

    monkeypatch.setattr(usage, "reserve_ai_credit", _no_credits)
    assert await jobs.generate_activity_chapters("chapF", force=True) is False
    assert (await _meta(db, "chapF"))["chapters"]["error"] == "AI credits exhausted"
    assert refunds == []


async def _set_plan(db, org, plan, *, v2=True):
    config = {"config_version": "2.0", "plan": plan} if v2 else {"config_version": "1.4", "cloud": {"plan": plan}}
    db.add(OrganizationConfig(org_id=org.id, config=config))
    await db.commit()


async def test_backfill_targets_only_paid_orgs_with_captions(monkeypatch, db, org, other_org, course, chapter, activity):
    _bind_session(monkeypatch, db)
    await _set_plan(db, org, "pro")
    await _set_plan(db, other_org, "free")
    await _add_video(db, org, course, "paidReady", meta={"captions": READY_EN})
    await _add_video(db, org, course, "paidDone", meta={"captions": READY_EN, "chapters": {"status": "ready"}})
    await _add_video(db, org, course, "paidNoCaps", meta={})
    other = await _add_video(db, other_org, course, "freeReady", meta={"captions": READY_EN})
    assert other.org_id == other_org.id

    assert await jobs.backfill_targets() == ["paidReady"]
    assert sorted(await jobs.backfill_targets(force=True)) == ["paidDone", "paidReady"]
    assert await jobs.backfill_targets(org_slug="other-org") == []
    assert await jobs.backfill_targets(org_slug="test-org") == ["paidReady"]


async def test_backfill_targets_reads_v1_plan(monkeypatch, db, org, course, chapter, activity):
    _bind_session(monkeypatch, db)
    await _set_plan(db, org, "standard", v2=False)
    await _add_video(db, org, course, "v1Ready", meta={"captions": READY_EN})
    assert await jobs.backfill_targets() == ["v1Ready"]


async def test_patch_and_resolve_ignore_missing_rows(monkeypatch, db, org, course, chapter, activity):
    _bind_session(monkeypatch, db)
    await jobs._patch_chapters("ghost", status="ready")  # no row: no-op
    orphan = await _add_video(db, org, course, "orphan", meta={"captions": READY_EN})
    orphan.course_id = 999999
    db.add(orphan)
    await db.commit()
    assert await jobs._resolve("orphan") is None


async def test_generate_lets_cancellation_through(monkeypatch, db, org, course, chapter, activity):
    import asyncio

    import pytest

    _bind_session(monkeypatch, db)
    _mock_ai(monkeypatch, error=asyncio.CancelledError())
    await _add_video(db, org, course, "chapCancel", meta={"captions": READY_EN})
    with pytest.raises(asyncio.CancelledError):
        await jobs.generate_activity_chapters("chapCancel")
