"""Transcript stage: speech in hosted video and audio becomes searchable text.

Extraction never transcribes. It reads an existing transcript (or ready
captions) and, when there is none, records the media as pending. The pipeline
transcribes pending media after indexing what it already has, then indexes the
activity again. Transcripts are stored next to the media file and keyed by its
file name, so replacing the file produces a fresh transcript.

Transcription costs AI credits and only runs for orgs with AI enabled. Every
attempt records its outcome on the owner (``activity.extra_metadata`` or
``block.content``, under ``"transcript"``) and is not retried automatically;
a manual re-index retries it.
"""

from __future__ import annotations

import asyncio
import logging
import os
import tempfile
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Literal, Optional

from fastapi import HTTPException
from sqlalchemy.orm.attributes import flag_modified
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.courses.activities import Activity
from src.db.courses.blocks import Block
from src.services.ai.rag.formats import is_safe_file_name, vtt_windows
from src.services.ai.rag.types import Segment, SourceType
from src.services.courses.transfer.storage_utils import read_file_content, write_file_content

logger = logging.getLogger(__name__)

STATUS_KEY = "transcript"


class TranscriptStatus:
    PROCESSING = "processing"
    DONE = "done"
    FAILED = "failed"
    DISABLED = "disabled"
    NO_CREDITS = "skipped_no_credits"


@dataclass(frozen=True)
class Media:
    """A stored audio or video file whose speech should be indexed."""

    org_id: int
    owner: Literal["activity", "block"]
    owner_id: int
    source_key: str
    # The owner's current transcript status, read at extraction time.
    status: Optional[dict] = None
    # Hosted-video captions (activity.extra_metadata["captions"]) to reuse.
    captions: Optional[dict] = None

    @property
    def file_name(self) -> str:
        return os.path.basename(self.source_key)

    @property
    def transcript_key(self) -> str:
        return f"{os.path.dirname(self.source_key)}/transcripts/{self.file_name}.vtt"

    @property
    def attempted(self) -> bool:
        """Whether transcription was already tried for this exact file."""
        return (self.status or {}).get("source") == self.file_name

    def ready_captions_key(self) -> Optional[str]:
        """A finished captions track for this video, source language first."""
        captions = self.captions or {}
        # Codes become a path component of the storage key.
        ready = [
            lang.get("code") for lang in captions.get("languages") or []
            if isinstance(lang, dict) and lang.get("status") == "ready" and is_safe_file_name(lang.get("code"))
        ]
        if not ready:
            return None
        source_language = captions.get("source_language")
        code = source_language if source_language in ready else ready[0]
        return f"{os.path.dirname(self.source_key)}/captions/{code}.vtt"


async def read_transcript(media: Media) -> Optional[str]:
    """The stored transcript, or ready captions, as WebVTT text."""
    for key in (media.transcript_key, media.ready_captions_key()):
        if not key:
            continue
        data = await asyncio.to_thread(read_file_content, key)
        if data:
            return data.decode("utf-8", errors="replace")
    return None


async def transcript_segments(
    ctx,
    media: Media,
    source_type: SourceType,
    block_uuid: Optional[str] = None,
) -> list[Segment]:
    """Timestamped segments of a media file's speech.

    Media with no transcript that was never attempted is queued on the context
    for the pipeline to transcribe.
    """
    vtt = await read_transcript(media)
    if vtt:
        return [
            Segment(text=text, source_type=source_type, block_uuid=block_uuid, locator={"start": start})
            for start, text in vtt_windows(vtt)
        ]
    if not media.attempted:
        ctx.pending_media.append(media)
    return []


async def transcribe(media: Media) -> bool:
    """Transcribe one media file and store the transcript. Never raises for
    expected failures; the outcome is recorded on the owner instead."""
    from src.core.events.database import _async_session_factory
    from src.security.features_utils.usage import (
        check_feature_enabled,
        refund_ai_credit,
        reserve_ai_credit,
    )
    from src.services.ai import captions as cap
    from src.services.ai.llm import model_for_tier
    from src.services.utils.hls_jobs import _fetch_source

    async with _async_session_factory() as db:
        try:
            await check_feature_enabled("ai", media.org_id, db)
        except HTTPException:
            await _set_status(media, TranscriptStatus.DISABLED)
            return False

    await _set_status(media, TranscriptStatus.PROCESSING)
    reserved = 0
    try:
        with tempfile.TemporaryDirectory() as td:
            local = os.path.join(td, media.file_name)
            if not await asyncio.to_thread(_fetch_source, media.source_key, local):
                await _set_status(media, TranscriptStatus.FAILED, error="source_unavailable")
                return False
            audio_dir = os.path.join(td, "audio")
            os.makedirs(audio_dir)
            chunks = await cap.extract_audio_chunks(local, audio_dir)
            if not chunks:
                await _set_status(media, TranscriptStatus.FAILED, error="no_audio")
                return False

            cost = cap.estimate_credits(await cap.probe_duration(local), 0)
            async with _async_session_factory() as db:
                try:
                    await reserve_ai_credit(media.org_id, db, amount=cost)
                except HTTPException:
                    await _set_status(media, TranscriptStatus.NO_CREDITS)
                    return False
            reserved = cost

            vtt = await cap.transcribe_to_vtt(chunks, model_for_tier("standard"))

        if not await asyncio.to_thread(write_file_content, media.transcript_key, vtt.encode("utf-8")):
            raise RuntimeError("transcript upload failed")
        await _set_status(media, TranscriptStatus.DONE)
        return True
    except asyncio.CancelledError:
        raise
    except Exception as e:
        logger.error("RAG: transcription failed for %s: %s", media.source_key, e)
        await _set_status(media, TranscriptStatus.FAILED, error="exception")
        if reserved:
            refund_ai_credit(media.org_id, amount=reserved)
        return False


async def _set_status(media: Media, status: str, error: Optional[str] = None) -> None:
    from src.core.events.database import _async_session_factory

    value = {
        "source": media.file_name,
        "status": status,
        "error": error,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    async with _async_session_factory() as db:
        if media.owner == "activity":
            activity = await db.get(Activity, media.owner_id)
            if activity is None:
                return
            activity.extra_metadata = {**(activity.extra_metadata or {}), STATUS_KEY: value}
            flag_modified(activity, "extra_metadata")
            db.add(activity)
        else:
            block = await db.get(Block, media.owner_id)
            if block is None:
                return
            block.content = {**(block.content or {}), STATUS_KEY: value}
            flag_modified(block, "content")
            db.add(block)
        await db.commit()


def status_of(owner_data: Optional[dict]) -> Optional[dict]:
    """The transcript status stored on an activity's extra_metadata or a block's content."""
    value = (owner_data or {}).get(STATUS_KEY)
    return value if isinstance(value, dict) else None


RETRYABLE = (TranscriptStatus.FAILED, TranscriptStatus.DISABLED, TranscriptStatus.NO_CREDITS)
# A "processing" attempt older than this was lost with its worker.
STALE_PROCESSING_SECONDS = 60 * 60


def _retryable(status: Optional[dict]) -> bool:
    if not status:
        return False
    if status.get("status") in RETRYABLE:
        return True
    if status.get("status") != TranscriptStatus.PROCESSING:
        return False
    try:
        started = datetime.fromisoformat(status.get("updated_at") or "")
        return (datetime.now(timezone.utc) - started).total_seconds() > STALE_PROCESSING_SECONDS
    except (TypeError, ValueError):
        return True


async def reset_unfinished_transcripts(course_id: int, db: AsyncSession) -> int:
    """Forget failed or skipped transcription attempts in a course, so the
    next indexing run tries them again. Returns how many were reset."""
    owners = [
        (activity, "extra_metadata")
        for activity in (await db.execute(select(Activity).where(Activity.course_id == course_id))).scalars()
    ] + [
        (block, "content")
        for block in (await db.execute(select(Block).where(Block.course_id == course_id))).scalars()
    ]
    reset = 0
    for owner, attr in owners:
        data = getattr(owner, attr) or {}
        if _retryable(status_of(data)):
            setattr(owner, attr, {k: v for k, v in data.items() if k != STATUS_KEY})
            flag_modified(owner, attr)
            db.add(owner)
            reset += 1
    if reset:
        await db.commit()
    return reset
