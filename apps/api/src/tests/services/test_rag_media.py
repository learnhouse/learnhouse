"""Transcript stage: auto-transcription of hosted video and audio for search."""

from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException
from sqlmodel import select

from src.db.courses.activities import Activity
from src.db.courses.blocks import Block, BlockTypeEnum
from src.services.ai.rag import media
from src.services.ai.rag.media import Media, TranscriptStatus
from src.tests.services.rag_helpers import (
    VTT,
    ActivitySubTypeEnum,
    ActivityTypeEnum,
    add_activity,
    same_session,
)

KEY = "content/orgs/org_test/courses/course_test/activities/activity_30/video/lecture.mp4"


def _media(**overrides):
    return Media(**{"org_id": 1, "owner": "activity", "owner_id": 30, "source_key": KEY, **overrides})


class TestMedia:
    def test_transcript_lives_next_to_the_file_and_is_keyed_by_its_name(self):
        assert _media().transcript_key == (
            "content/orgs/org_test/courses/course_test/activities/activity_30/video/transcripts/lecture.mp4.vtt"
        )

    def test_attempted_only_for_the_same_file(self):
        assert not _media().attempted
        assert _media(status={"source": "lecture.mp4", "status": "failed"}).attempted
        assert not _media(status={"source": "older.mp4", "status": "done"}).attempted

    def test_ready_captions_prefer_the_source_language(self):
        captions = {"source_language": "es", "languages": [
            {"code": "en", "status": "ready"}, {"code": "es", "status": "ready"}, {"code": "de", "status": "failed"},
        ]}
        assert _media(captions=captions).ready_captions_key().endswith("/video/captions/es.vtt")
        captions["source_language"] = "auto"
        assert _media(captions=captions).ready_captions_key().endswith("/video/captions/en.vtt")
        assert _media(captions={"languages": [{"code": "en", "status": "processing"}]}).ready_captions_key() is None
        assert _media().ready_captions_key() is None
        # A stored code is a path component; anything else is never read.
        unsafe = {"languages": [{"code": "../../../other/x", "status": "ready"}]}
        assert _media(captions=unsafe).ready_captions_key() is None

    async def test_read_transcript_prefers_the_transcript(self, monkeypatch):
        files = {_media().transcript_key: b"T", KEY.rsplit("/", 1)[0] + "/captions/en.vtt": b"C"}
        monkeypatch.setattr(media, "read_file_content", files.get)
        captions = {"languages": [{"code": "en", "status": "ready"}]}
        assert await media.read_transcript(_media(captions=captions)) == "T"
        files.pop(_media().transcript_key)
        assert await media.read_transcript(_media(captions=captions)) == "C"
        assert await media.read_transcript(_media()) is None


@pytest.fixture
async def video(db, org, course, chapter):
    return await add_activity(
        db, org, course, chapter, 30,
        activity_type=ActivityTypeEnum.TYPE_VIDEO,
        sub_type=ActivitySubTypeEnum.SUBTYPE_VIDEO_HOSTED,
        content={"filename": "lecture.mp4"},
        extra_metadata={"captions": {"enabled": False}},
    )


@pytest.fixture
def ai(monkeypatch, db):
    """Mocked transcription ai, storage, session and credit metering."""
    import src.security.features_utils.usage as usage
    import src.services.ai.llm as llm
    import src.services.utils.hls_jobs as hls_jobs
    from src.services.ai import captions as cap

    monkeypatch.setattr("src.core.events.database._async_session_factory", lambda: same_session(db))
    calls = MagicMock()
    calls.check_feature_enabled = AsyncMock(return_value=True)
    calls.reserve_ai_credit = AsyncMock(return_value=1)
    calls.refund_ai_credit = MagicMock(return_value=0)
    calls.fetch = MagicMock(return_value=True)
    calls.transcribe_to_vtt = AsyncMock(return_value=VTT)
    calls.write = MagicMock(return_value=True)
    monkeypatch.setattr(usage, "check_feature_enabled", calls.check_feature_enabled)
    monkeypatch.setattr(usage, "reserve_ai_credit", calls.reserve_ai_credit)
    monkeypatch.setattr(usage, "refund_ai_credit", calls.refund_ai_credit)
    monkeypatch.setattr(hls_jobs, "_fetch_source", calls.fetch)
    monkeypatch.setattr(cap, "extract_audio_chunks", AsyncMock(return_value=["a.mp3", "b.mp3"]))
    monkeypatch.setattr(cap, "probe_duration", AsyncMock(return_value=1200.0))
    monkeypatch.setattr(cap, "transcribe_to_vtt", calls.transcribe_to_vtt)
    monkeypatch.setattr(llm, "model_for_tier", lambda tier: "standard-model")
    monkeypatch.setattr(media, "write_file_content", calls.write)
    return calls


def _status(activity):
    return media.status_of(activity.extra_metadata)


class TestTranscribe:
    async def test_success_stores_transcript_and_charges_by_duration(self, db, video, ai):
        assert await media.transcribe(_media()) is True

        ai.reserve_ai_credit.assert_awaited_once()
        assert ai.reserve_ai_credit.await_args.kwargs["amount"] == 2  # 20 min = two 10-min chunks
        ai.write.assert_called_once_with(_media().transcript_key, VTT.encode())
        await db.refresh(video)
        status = _status(video)
        assert (status["status"], status["source"]) == (TranscriptStatus.DONE, "lecture.mp4")
        # Other metadata is kept.
        assert video.extra_metadata["captions"] == {"enabled": False}
        ai.refund_ai_credit.assert_not_called()

    async def test_ai_disabled_records_status_and_spends_nothing(self, db, video, ai):
        ai.check_feature_enabled.side_effect = HTTPException(status_code=403, detail="off")
        assert await media.transcribe(_media()) is False
        ai.fetch.assert_not_called()
        ai.reserve_ai_credit.assert_not_awaited()
        await db.refresh(video)
        assert _status(video)["status"] == TranscriptStatus.DISABLED

    async def test_out_of_credits_records_status(self, db, video, ai):
        ai.reserve_ai_credit.side_effect = HTTPException(status_code=403, detail="quota")
        assert await media.transcribe(_media()) is False
        ai.transcribe_to_vtt.assert_not_awaited()
        await db.refresh(video)
        assert _status(video)["status"] == TranscriptStatus.NO_CREDITS

    async def test_transcription_failure_refunds(self, db, video, ai):
        ai.transcribe_to_vtt.side_effect = ValueError("no cues")
        assert await media.transcribe(_media()) is False
        ai.refund_ai_credit.assert_called_once_with(1, amount=2)
        await db.refresh(video)
        assert _status(video)["status"] == TranscriptStatus.FAILED

    async def test_upload_failure_refunds(self, db, video, ai):
        ai.write.return_value = False
        assert await media.transcribe(_media()) is False
        ai.refund_ai_credit.assert_called_once()

    async def test_missing_source_fails_without_charge(self, db, video, ai):
        ai.fetch.return_value = False
        assert await media.transcribe(_media()) is False
        ai.reserve_ai_credit.assert_not_awaited()
        await db.refresh(video)
        assert _status(video)["error"] == "source_unavailable"

    async def test_block_status_is_stored_on_the_block(self, db, video, ai):
        block = Block(
            id=5, block_type=BlockTypeEnum.BLOCK_AUDIO, content={"file_id": "block_a", "file_format": "mp3"},
            org_id=video.org_id, course_id=video.course_id, activity_id=video.id, block_uuid="block_5",
            creation_date="", update_date="",
        )
        db.add(block)
        await db.commit()
        assert await media.transcribe(_media(owner="block", owner_id=5, source_key="x/block_a.mp3")) is True
        await db.refresh(block)
        assert block.content["file_id"] == "block_a"
        assert media.status_of(block.content)["status"] == TranscriptStatus.DONE

    async def test_status_for_a_deleted_owner_is_ignored(self, db, ai):
        assert await media.transcribe(_media(owner_id=999)) is True


class TestReset:
    async def test_resets_retryable_and_stale_attempts_only(self, db, org, course, chapter):
        now = datetime.now(timezone.utc)
        statuses = {
            31: {"status": TranscriptStatus.FAILED},
            32: {"status": TranscriptStatus.NO_CREDITS},
            33: {"status": TranscriptStatus.DONE},
            34: {"status": TranscriptStatus.PROCESSING, "updated_at": now.isoformat()},
            35: {"status": TranscriptStatus.PROCESSING, "updated_at": (now - timedelta(hours=2)).isoformat()},
            36: {"status": TranscriptStatus.PROCESSING, "updated_at": "garbage"},
        }
        for activity_id, status in statuses.items():
            await add_activity(
                db, org, course, chapter, activity_id,
                activity_type=ActivityTypeEnum.TYPE_VIDEO,
                sub_type=ActivitySubTypeEnum.SUBTYPE_VIDEO_HOSTED,
                extra_metadata={"transcript": {"source": "v.mp4", **status}, "keep": 1},
            )
        db.add(Block(
            id=9, block_type=BlockTypeEnum.BLOCK_VIDEO, content={"transcript": {"status": TranscriptStatus.DISABLED}},
            org_id=org.id, course_id=course.id, activity_id=31, block_uuid="block_9",
            creation_date="", update_date="",
        ))
        await db.commit()

        assert await media.reset_unfinished_transcripts(course.id, db) == 5

        kept = {a.id: a.extra_metadata for a in (await db.execute(
            select(Activity).where(Activity.course_id == course.id)
        )).scalars()}
        assert "transcript" not in kept[31] and kept[31]["keep"] == 1
        assert "transcript" in kept[33] and "transcript" in kept[34]
        assert "transcript" not in kept[35] and "transcript" not in kept[36]
        block = await db.get(Block, 9)
        assert "transcript" not in block.content
