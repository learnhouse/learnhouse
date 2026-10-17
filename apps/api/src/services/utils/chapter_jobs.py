"""AI video chapters for hosted video activities.

Runs right after captions finish (``caption_jobs``), from the regenerate route,
and from the ``chapters-backfill`` CLI. One job reads the activity's best ready
caption track, asks the cheapest model tier for chapters, and stores them on
``activity.extra_metadata['chapters']``:

    {status: processing|ready|failed, items: [{start, title}], language,
     model, error, updated_at}

Chapters are small, so they live in the metadata rather than a file; the player
builds its chapter track from them. Each run costs one AI credit, metered like
captions.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import HTTPException
from sqlalchemy.orm.attributes import flag_modified
from sqlmodel import select

from src.core.events.database import _async_session_factory
from src.db.courses.activities import Activity, ActivitySubTypeEnum
from src.db.courses.courses import Course
from src.db.organization_config import OrganizationConfig
from src.db.organizations import Organization
from src.services.ai import chapters as chap
from src.services.courses.activities.video import _CAPTION_LANG_RE
from src.services.courses.transfer.storage_utils import read_file_content

logger = logging.getLogger(__name__)

CHAPTERS_CREDIT_COST = 1


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


async def _patch_chapters(activity_uuid: str, **patch) -> None:
    """Shallow-merge `patch` into extra_metadata['chapters'] (creating it if absent)."""
    async with _async_session_factory() as db:
        activity = (
            await db.execute(select(Activity).where(Activity.activity_uuid == activity_uuid))
        ).scalars().first()
        if not activity:
            return
        meta = dict(activity.extra_metadata or {})
        chapters = dict(meta.get("chapters") or {})
        chapters.update(patch)
        chapters["updated_at"] = _now()
        meta["chapters"] = chapters
        activity.extra_metadata = meta
        flag_modified(activity, "extra_metadata")
        db.add(activity)
        await db.commit()


def pick_caption_language(captions: dict) -> Optional[str]:
    """The caption track to read: the source language when it's ready, otherwise
    the first ready language. None when no track is ready."""
    ready = [
        lang.get("code")
        for lang in (captions or {}).get("languages") or []
        if isinstance(lang, dict)
        and lang.get("status") == "ready"
        and isinstance(lang.get("code"), str)
        and _CAPTION_LANG_RE.match(lang["code"])
    ]
    if not ready:
        return None
    source = (captions or {}).get("source_language")
    return source if source in ready else ready[0]


async def _resolve(activity_uuid: str) -> Optional[dict]:
    async with _async_session_factory() as db:
        a = (
            await db.execute(select(Activity).where(Activity.activity_uuid == activity_uuid))
        ).scalars().first()
        if not a or a.activity_sub_type != ActivitySubTypeEnum.SUBTYPE_VIDEO_HOSTED:
            return None
        meta = a.extra_metadata or {}
        org = (await db.execute(select(Organization).where(Organization.id == a.org_id))).scalars().first()
        course = (await db.execute(select(Course).where(Course.id == a.course_id))).scalars().first()
        if not org or not course:
            return None
        return {
            "org_id": a.org_id,
            "org_uuid": org.org_uuid,
            "course_uuid": course.course_uuid,
            "captions": meta.get("captions") or {},
            "chapters": meta.get("chapters") or {},
        }


async def generate_activity_chapters(activity_uuid: str, *, force: bool = False) -> bool:
    """Generate and store chapters for one activity. Returns True when chapters
    are ready afterwards. Never raises for expected failures; records status."""
    info = await _resolve(activity_uuid)
    if not info:
        return False
    if not force and info["chapters"].get("status") == "ready":
        return True
    lang = pick_caption_language(info["captions"])
    if not lang:
        logger.info("Chapters: no ready captions for %s", activity_uuid)
        return False

    await _patch_chapters(activity_uuid, status="processing", error=None)

    from src.security.features_utils.usage import (
        check_feature_enabled,
        refund_ai_credit,
        reserve_ai_credit,
    )
    from src.services.ai.llm import model_for_tier

    org_id = info["org_id"]
    key = (
        f"content/orgs/{info['org_uuid']}/courses/{info['course_uuid']}"
        f"/activities/{activity_uuid}/video/captions/{lang}.vtt"
    )
    model_name = model_for_tier("fast")
    reserved = 0
    try:
        raw = await asyncio.to_thread(read_file_content, key)
        if not raw:
            await _patch_chapters(activity_uuid, status="failed", error="captions_unavailable")
            return False
        vtt = raw.decode("utf-8", errors="replace")

        async with _async_session_factory() as db:
            await check_feature_enabled("ai", org_id, db)
            await reserve_ai_credit(org_id, db, amount=CHAPTERS_CREDIT_COST)
        reserved = CHAPTERS_CREDIT_COST

        items = await chap.generate_chapters(vtt, model_name)
        await _patch_chapters(
            activity_uuid,
            status="ready",
            items=items,
            language=lang,
            model=model_name,
            error=None,
        )
        logger.info("Chapters ready for %s (%s chapters)", activity_uuid, len(items))
        return True
    except HTTPException as e:
        # AI disabled or out of credits: nothing was reserved, so no refund.
        await _patch_chapters(activity_uuid, status="failed", error=str(getattr(e, "detail", "ai_error"))[:200])
        return False
    except asyncio.CancelledError:
        raise
    except ValueError as e:
        logger.info("Chapters: nothing usable for %s: %s", activity_uuid, e)
        await _patch_chapters(activity_uuid, status="failed", error="no_chapters")
        if reserved:
            refund_ai_credit(org_id, amount=reserved)
        return False
    except Exception as e:
        logger.error("Chapters job crashed for %s: %s", activity_uuid, e)
        await _patch_chapters(activity_uuid, status="failed", error="exception")
        if reserved:
            refund_ai_credit(org_id, amount=reserved)
        return False


async def backfill_targets(*, org_slug: Optional[str] = None, force: bool = False) -> list[str]:
    """Hosted videos in organizations on a paid plan that have ready captions but
    no ready chapters (or every captioned one with ``force``)."""
    from src.security.features_utils.plans import is_paying_plan
    from src.security.features_utils.usage import _plan_from_config_dict

    async with _async_session_factory() as db:
        query = (
            select(Activity, OrganizationConfig)
            .join(OrganizationConfig, OrganizationConfig.org_id == Activity.org_id)
            .where(Activity.activity_sub_type == ActivitySubTypeEnum.SUBTYPE_VIDEO_HOSTED)
        )
        if org_slug:
            query = query.join(Organization, Organization.id == Activity.org_id).where(
                Organization.slug == org_slug
            )
        rows = (await db.execute(query)).all()

    targets: list[str] = []
    for activity, org_config in rows:
        if not is_paying_plan(_plan_from_config_dict(org_config.config or {})):
            continue
        meta = activity.extra_metadata or {}
        if not pick_caption_language(meta.get("captions") or {}):
            continue
        if not force and (meta.get("chapters") or {}).get("status") == "ready":
            continue
        targets.append(activity.activity_uuid)
    return targets
