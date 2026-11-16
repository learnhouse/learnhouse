"""Anonymous-safe public content for search engines, feeds and AI search.

Everything here answers as an anonymous visitor would see the org: only
public, published, not-noindexed content, never anything sold behind a
paywall, never drafts. Each generator (thread lookup, feeds, llms.txt data,
Markdown alternates) does its own checks server-side; the web app only
formats what comes back.
"""

import asyncio
import os
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from fastapi import HTTPException, Request
from sqlalchemy import func, select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.core.ee_hooks import get_ee_paid_locked_activity_ids, is_ee_resource_locked
from src.db.communities.communities import Community
from src.db.communities.discussion_comments import DiscussionComment
from src.db.communities.discussions import Discussion
from src.db.courses.activities import Activity, ActivityLockType, ActivityTypeEnum
from src.db.courses.chapter_activities import ChapterActivity
from src.db.courses.chapters import Chapter
from src.db.courses.course_chapters import CourseChapter
from src.db.courses.course_updates import CourseUpdate
from src.db.courses.courses import Course
from src.db.folders.folders import Folder
from src.db.organizations import Organization
from src.db.paths import Path, PathCourse
from src.db.podcasts.episodes import PodcastEpisode
from src.db.podcasts.podcasts import Podcast
from src.db.resource_authors import ResourceAuthor, ResourceAuthorshipStatusEnum
from src.db.users import AnonymousUser, User
from src.services.seo.indexnow import thread_segment
from src.services.seo.seo import _get_org_by_slug, _noindexed, org_seo_config, public_key
from src.services.seo.slugs import find_resource

FEED_LIMIT = 50
LLMS_LIMIT = 500
LLMS_FULL_ACTIVITY_LIMIT = 2000
TOP_COMMENTS = 10


# ----------------------------------------------------------------------------
# Org-level switches
# ----------------------------------------------------------------------------

def feature_indexable(seo: dict, feature: str) -> bool:
    """Whether a public section may be indexed / listed for crawlers."""
    if seo.get("indexing_disabled"):
        return False
    if feature in ("communities", "discussions"):
        return not seo.get("noindex_communities")
    return (seo.get("indexable_features") or {}).get(feature, True) is not False


def _parse_date(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    text = str(value).strip().replace(" ", "T")
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def is_thin_thread(seo: dict, reply_count: int, creation_date: Optional[str], now: Optional[datetime] = None) -> bool:
    """A thread nobody answered, older than the org's threshold (noindexed)."""
    days = seo.get("thin_thread_noindex_days", 90)
    try:
        days = int(days)
    except (TypeError, ValueError):
        days = 90
    if days <= 0 or reply_count > 0:
        return False
    created = _parse_date(creation_date)
    if created is None:
        return False
    return (now or datetime.now(timezone.utc)) - created > timedelta(days=days)


async def _org(db_session: AsyncSession, org_slug: str) -> tuple[Organization, dict]:
    org = await _get_org_by_slug(db_session, org_slug)
    return org, await org_seo_config(db_session, org.id)


async def _anon_locked(request: Request, db_session: AsyncSession, resource_uuid: str) -> bool:
    """Whether the resource's content is sold (an anonymous visitor gets a 402)."""
    try:
        return await is_ee_resource_locked(request, db_session, AnonymousUser(), resource_uuid)
    except HTTPException:
        return True


def _author_name(user: Optional[User]) -> str:
    if not user:
        return ""
    return " ".join(p for p in [user.first_name, user.last_name] if p).strip() or user.username or ""


async def _users(db_session: AsyncSession, ids: set[int]) -> dict[int, User]:
    if not ids:
        return {}
    rows = (await db_session.execute(select(User).where(User.id.in_(list(ids))))).scalars().all()
    return {u.id: u for u in rows}


async def _comment_counts(db_session: AsyncSession, discussion_ids: list[int]) -> dict[int, int]:
    if not discussion_ids:
        return {}
    rows = (
        await db_session.execute(
            select(DiscussionComment.discussion_id, func.count(DiscussionComment.id))
            .where(DiscussionComment.discussion_id.in_(discussion_ids))
            .group_by(DiscussionComment.discussion_id)
        )
    ).all()
    return {d: int(c) for d, c in rows}


# ----------------------------------------------------------------------------
# Community threads: readable URLs (/community/<key>/<id>-<slug>)
# ----------------------------------------------------------------------------

async def _community_for(request, db_session, current_user, org: Organization, key: str) -> tuple[Community, bool]:
    """The community behind a URL key and whether this caller is shut out."""
    from src.services.seo.seo import _can_read

    community, _ = await find_resource(db_session, "community", org.id, key)
    if community is None:
        raise HTTPException(status_code=404, detail="Not found")
    restricted = not community.public and not await _can_read(request, db_session, current_user, "community", community)
    return community, restricted


async def thread_lookup(
    request: Request,
    db_session: AsyncSession,
    current_user,
    org_slug: str,
    community_key: str,
    ref: str,
) -> dict:
    """Map ``<id>-<slug>`` (or a legacy discussion uuid) to the thread.

    The numeric id is authoritative; the slug part is decoration that the page
    redirects to the current one. ``indexable`` folds in every reason a thread
    must stay out of search: private or sold community, the org's switches,
    the community's noindex, and the thin-thread rule.
    """
    org, seo = await _org(db_session, org_slug)
    community, restricted = await _community_for(request, db_session, current_user, org, community_key)
    if restricted:
        # Never confirm a thread (let alone its title) to someone who can't
        # read the community: same 404 as a thread that doesn't exist.
        raise HTTPException(status_code=404, detail="Not found")
    # A sold community the caller hasn't bought: the page shows the offer, so
    # it gets the community but nothing about the thread.
    try:
        locked_for_caller = await is_ee_resource_locked(request, db_session, current_user, community.community_uuid)
    except HTTPException:
        locked_for_caller = True
    if locked_for_caller:
        return {
            "locked": True,
            "restricted": False,
            "indexable": False,
            "community_uuid": community.community_uuid,
            "community_key": public_key("community", community),
        }
    ref = (ref or "").strip()
    head = ref.split("-", 1)[0]
    statement = select(Discussion).where(Discussion.community_id == community.id)
    if head.isdigit() and len(head) < 19:
        statement = statement.where(Discussion.id == int(head))
    else:
        uuid = ref if ref.startswith("discussion_") else f"discussion_{ref}"
        statement = statement.where(Discussion.discussion_uuid == uuid)
    discussion = (await db_session.execute(statement)).scalars().first()
    if discussion is None:
        raise HTTPException(status_code=404, detail="Not found")
    replies = (await _comment_counts(db_session, [discussion.id])).get(discussion.id, 0)
    locked = await _anon_locked(request, db_session, community.community_uuid)
    indexable = (
        community.public
        and not locked
        and feature_indexable(seo, "communities")
        and not _noindexed(community.seo)
        and not is_thin_thread(seo, replies, discussion.creation_date)
    )
    return {
        "id": discussion.id,
        "discussion_uuid": discussion.discussion_uuid,
        "bare_uuid": discussion.discussion_uuid.replace("discussion_", "", 1),
        "title": discussion.title,
        "segment": thread_segment(discussion.id, discussion.title),
        "community_uuid": community.community_uuid,
        "community_key": public_key("community", community),
        "community_name": community.name,
        "locked": False,
        "restricted": False,
        "indexable": bool(indexable),
        "reply_count": replies,
        "label": discussion.label or "general",
        "answered": discussion.answer_comment_id is not None,
    }


# ----------------------------------------------------------------------------
# Readable content (feeds, llms.txt, Markdown)
# ----------------------------------------------------------------------------

def _course_entry(course: Course, authors: list[str]) -> dict:
    seo = course.seo or {}
    return {
        "type": "course",
        "key": public_key("course", course),
        "uuid": course.course_uuid,
        "name": course.name,
        "description": seo.get("description") or course.description or "",
        "about": course.about or "",
        "learnings": course.learnings or "",
        "tags": course.tags or "",
        "image": course.thumbnail_image or "",
        "language": course.default_locale or "",
        "authors": authors,
        "published": course.creation_date or "",
        "updated": course.update_date or course.creation_date or "",
    }


async def _listed_courses(db_session: AsyncSession, org_id: int, seo: dict, limit: int) -> list[Course]:
    if not feature_indexable(seo, "courses"):
        return []
    rows = (
        await db_session.execute(
            select(Course)
            .where(Course.org_id == org_id, Course.public == True, Course.published == True)  # noqa: E712
            .order_by(Course.id.desc())
            .limit(limit)
        )
    ).scalars().all()
    return [c for c in rows if not _noindexed(c.seo)]


async def _course_authors(db_session: AsyncSession, uuids: list[str]) -> dict[str, list[str]]:
    if not uuids:
        return {}
    rows = (
        await db_session.execute(
            select(ResourceAuthor.resource_uuid, User)
            .join(User, User.id == ResourceAuthor.user_id)
            .where(
                ResourceAuthor.resource_uuid.in_(uuids),
                ResourceAuthor.authorship_status == ResourceAuthorshipStatusEnum.ACTIVE,
            )
            .order_by(ResourceAuthor.id)
        )
    ).all()
    out: dict[str, list[str]] = {}
    for resource_uuid, user in rows:
        name = _author_name(user)
        if name and name not in out.setdefault(resource_uuid, []):
            out[resource_uuid].append(name)
    return out


async def _public_activities(request, db_session, course: Course, limit: int = LLMS_FULL_ACTIVITY_LIMIT) -> list[dict]:
    """Ordered outline (chapters → lessons) of the lessons anonymous visitors can open, and only those."""
    rows = (
        await db_session.execute(
            select(Chapter, Activity, CourseChapter.order, ChapterActivity.order)
            .join(CourseChapter, CourseChapter.chapter_id == Chapter.id)
            .join(ChapterActivity, ChapterActivity.chapter_id == Chapter.id)
            .join(Activity, Activity.id == ChapterActivity.activity_id)
            .where(CourseChapter.course_id == course.id, Activity.course_id == course.id)
            .order_by(CourseChapter.order, ChapterActivity.order)
            .limit(limit)
        )
    ).all()
    locked = await get_ee_paid_locked_activity_ids(request, course.id, AnonymousUser(), db_session)
    course_locked = locked is None and await _anon_locked(request, db_session, course.course_uuid)
    out: list[dict] = []
    for chapter, activity, _, _ in rows:
        public = (
            activity.published
            and activity.lock_type == ActivityLockType.PUBLIC
            and not course_locked
            and not (locked and activity.id in locked)
        )
        if not public:
            # Drafts, members-only, group-restricted and sold lessons are left
            # out entirely: not even their names reach public outputs.
            continue
        out.append(
            {
                "chapter": chapter.name,
                "chapter_uuid": chapter.chapter_uuid,
                "key": activity.activity_uuid.replace("activity_", "", 1),
                "name": activity.name,
                "type": activity.activity_type.value if hasattr(activity.activity_type, "value") else str(activity.activity_type),
                "public": bool(public),
                "updated": activity.update_date or activity.creation_date or "",
            }
        )
    return out


async def _listed_communities(db_session, org_id: int, seo: dict) -> list[Community]:
    if not feature_indexable(seo, "communities"):
        return []
    rows = (
        await db_session.execute(
            select(Community).where(Community.org_id == org_id, Community.public == True).order_by(Community.id)  # noqa: E712
        )
    ).scalars().all()
    return [c for c in rows if not _noindexed(c.seo)]


async def _open_communities(request, db_session, org_id: int, seo: dict) -> list[Community]:
    """Listed communities whose threads anyone can read (not sold)."""
    out = []
    for community in await _listed_communities(db_session, org_id, seo):
        if not await _anon_locked(request, db_session, community.community_uuid):
            out.append(community)
    return out


async def _threads(
    db_session,
    seo: dict,
    communities: list[Community],
    sort: str = "new",
    limit: int = FEED_LIMIT,
    label: Optional[str] = None,
    include_thin: bool = False,
) -> list[dict]:
    if not communities:
        return []
    by_id = {c.id: c for c in communities}
    statement = select(Discussion).where(Discussion.community_id.in_(list(by_id)))
    if label:
        statement = statement.where(Discussion.label == label)
    if sort == "top":
        statement = statement.order_by(Discussion.upvote_count.desc(), Discussion.id.desc())
    else:
        statement = statement.order_by(Discussion.id.desc())
    rows = (await db_session.execute(statement.limit(limit * 2 if not include_thin else limit))).scalars().all()
    counts = await _comment_counts(db_session, [d.id for d in rows])
    users = await _users(db_session, {d.author_id for d in rows})
    out = []
    for d in rows:
        replies = counts.get(d.id, 0)
        if not include_thin and is_thin_thread(seo, replies, d.creation_date):
            continue
        community = by_id[d.community_id]
        out.append(
            {
                "id": d.id,
                "uuid": d.discussion_uuid,
                "title": d.title,
                "content": d.content or "",
                "label": d.label or "general",
                "community_key": public_key("community", community),
                "community_name": community.name,
                "segment": thread_segment(d.id, d.title),
                "author": _author_name(users.get(d.author_id)),
                "upvotes": d.upvote_count or 0,
                "replies": replies,
                "answered": d.answer_comment_id is not None,
                "published": d.creation_date or "",
                "updated": d.update_date or d.creation_date or "",
            }
        )
        if len(out) >= limit:
            break
    return out


async def _content_size(org_uuid: str, directory: str, filename: str) -> int:
    """Byte size of a stored file (podcast enclosures need it), 0 when unknown."""
    from src.services.utils.upload_content import _safe_content_path
    from config.config import get_learnhouse_config

    if not filename or "/" in filename or "\\" in filename or ".." in filename:
        return 0
    key = f"{org_uuid}/{directory}/{filename}"
    if key in _size_cache:
        return _size_cache[key]
    size = 0
    try:
        cfg = get_learnhouse_config().hosting_config.content_delivery
        if cfg.type == "s3api":
            import boto3

            s3 = boto3.client("s3", endpoint_url=cfg.s3api.endpoint_url)
            head = await asyncio.to_thread(
                s3.head_object, Bucket=cfg.s3api.bucket_name or "learnhouse-media", Key=f"content/orgs/{key}"
            )
            size = int(head.get("ContentLength") or 0)
        else:
            path = _safe_content_path("orgs", org_uuid, directory, filename)
            size = os.path.getsize(path) if os.path.exists(path) else 0
    except Exception:
        size = 0
    if size:
        _size_cache[key] = size
    return size


_size_cache: dict[str, int] = {}


async def _episodes(request, db_session, org: Organization, podcast: Podcast, limit: int = FEED_LIMIT) -> list[dict]:
    rows = (
        await db_session.execute(
            select(PodcastEpisode)
            .where(PodcastEpisode.podcast_id == podcast.id, PodcastEpisode.published == True)  # noqa: E712
            .order_by(PodcastEpisode.episode_number.desc(), PodcastEpisode.id.desc())
            .limit(limit)
        )
    ).scalars().all()
    # A sold podcast still lists its episodes (that's what's for sale), without audio.
    locked = await _anon_locked(request, db_session, podcast.podcast_uuid)
    out = []
    for e in rows:
        audio = "" if locked else (e.audio_file or "")
        directory = f"podcasts/{podcast.podcast_uuid}/episodes/{e.episode_uuid}/audio"
        out.append(
            {
                "uuid": e.episode_uuid,
                "number": e.episode_number or 0,
                "title": e.title,
                "description": e.description or "",
                "audio": audio,
                "audio_length": await _content_size(org.org_uuid, directory, audio) if audio else 0,
                "duration_seconds": e.duration_seconds or 0,
                "image": e.thumbnail_image or "",
                "published": e.creation_date or "",
                "updated": e.update_date or e.creation_date or "",
            }
        )
    return out


def _org_info(org: Organization, seo: dict) -> dict:
    return {
        "slug": org.slug,
        "org_uuid": org.org_uuid,
        "name": org.name,
        "description": getattr(org, "description", "") or "",
        "about": getattr(org, "about", "") or "",
        "logo": getattr(org, "logo_image", "") or "",
        "thumbnail": getattr(org, "thumbnail_image", "") or "",
        "indexing_disabled": bool(seo.get("indexing_disabled")),
        "feeds_enabled": seo.get("feeds_enabled", True) is not False,
        "llms_txt_enabled": seo.get("llms_txt_enabled", True) is not False,
        "ai_crawler_policy": seo.get("ai_crawler_policy") or "allow",
    }


FEED_KINDS = ("org", "courses", "communities", "community", "podcast", "course_updates")


async def feed_data(
    request: Request,
    db_session: AsyncSession,
    org_slug: str,
    kind: str,
    key: Optional[str] = None,
    sort: str = "new",
    label: Optional[str] = None,
) -> dict:
    """Items of one public feed, newest first (or top, for threads).

    404 when the feed would expose nothing public: unknown kind/key, private,
    sold or noindexed resource, or the org turned feeds (or indexing) off.
    Podcasts are the exception to indexing switches: podcast directories need
    the feed even for a show that isn't in web search.
    """
    if kind not in FEED_KINDS:
        raise HTTPException(status_code=404, detail="Not found")
    org, seo = await _org(db_session, org_slug)
    info = _org_info(org, seo)
    # Podcast feeds are distribution (Apple Podcasts, Spotify), not discovery:
    # they keep working when the org turns its other feeds off.
    if not info["feeds_enabled"] and kind != "podcast":
        raise HTTPException(status_code=404, detail="Feeds are turned off")
    sort = "top" if sort == "top" else "new"
    result: dict[str, Any] = {"org": info, "kind": kind, "sort": sort, "items": []}

    if kind in ("org", "courses"):
        if info["indexing_disabled"]:
            raise HTTPException(status_code=404, detail="Not found")
        courses = await _listed_courses(db_session, org.id, seo, FEED_LIMIT)
        authors = await _course_authors(db_session, [c.course_uuid for c in courses])
        items = [_course_entry(c, authors.get(c.course_uuid, [])) for c in courses]
        if kind == "org":
            # New learning paths and podcasts belong in "what's new" too.
            if feature_indexable(seo, "paths"):
                paths = (
                    await db_session.execute(
                        select(Path)
                        .where(Path.org_id == org.id, Path.public == True, Path.published == True)  # noqa: E712
                        .order_by(Path.id.desc())
                        .limit(FEED_LIMIT)
                    )
                ).scalars().all()
                items += [
                    {
                        "type": "path", "key": public_key("path", p), "uuid": p.path_uuid, "name": p.name,
                        "description": (p.seo or {}).get("description") or p.description or "", "image": p.thumbnail_image or "",
                        "published": p.creation_date or "", "updated": p.update_date or p.creation_date or "",
                    }
                    for p in paths if not _noindexed(p.seo)
                ]
            if feature_indexable(seo, "podcasts"):
                podcasts = (
                    await db_session.execute(
                        select(Podcast)
                        .where(Podcast.org_id == org.id, Podcast.public == True, Podcast.published == True)  # noqa: E712
                        .order_by(Podcast.id.desc())
                        .limit(FEED_LIMIT)
                    )
                ).scalars().all()
                items += [
                    {
                        "type": "podcast", "key": public_key("podcast", p), "uuid": p.podcast_uuid, "name": p.name,
                        "description": (p.seo or {}).get("description") or p.description or "", "image": p.thumbnail_image or "",
                        "published": p.creation_date or "", "updated": p.update_date or p.creation_date or "",
                    }
                    for p in podcasts if not _noindexed(p.seo)
                ]
            items.sort(key=lambda i: _parse_date(i["published"]) or datetime.min.replace(tzinfo=timezone.utc), reverse=True)
        result["items"] = items[:FEED_LIMIT]
        return result

    if kind == "communities":
        communities = await _open_communities(request, db_session, org.id, seo)
        result["items"] = await _threads(db_session, seo, communities, sort, label=label)
        return result

    if kind == "community":
        community, _ = await find_resource(db_session, "community", org.id, key or "")
        if (
            community is None
            or not community.public
            or _noindexed(community.seo)
            or not feature_indexable(seo, "communities")
            or await _anon_locked(request, db_session, community.community_uuid)
        ):
            raise HTTPException(status_code=404, detail="Not found")
        result["resource"] = {
            "key": public_key("community", community), "uuid": community.community_uuid, "name": community.name,
            "description": community.description or "", "image": community.thumbnail_image or "",
            "updated": community.update_date or community.creation_date or "",
        }
        result["items"] = await _threads(db_session, seo, [community], sort, label=label)
        return result

    if kind == "podcast":
        podcast, _ = await find_resource(db_session, "podcast", org.id, key or "")
        if podcast is None or not (podcast.public and podcast.published):
            raise HTTPException(status_code=404, detail="Not found")
        authors = (await _course_authors(db_session, [podcast.podcast_uuid])).get(podcast.podcast_uuid, [])
        result["resource"] = {
            "key": public_key("podcast", podcast), "uuid": podcast.podcast_uuid, "name": podcast.name,
            "description": podcast.description or "", "about": getattr(podcast, "about", "") or "",
            "image": podcast.thumbnail_image or "", "authors": authors,
            "language": (podcast.seo or {}).get("in_language") or "",
            "category": getattr(podcast, "category", "") or "",
            "explicit": bool(getattr(podcast, "explicit", False)),
            "noindex": _noindexed(podcast.seo),
            "updated": podcast.update_date or podcast.creation_date or "",
        }
        result["items"] = await _episodes(request, db_session, org, podcast)
        return result

    # course_updates
    course, _ = await find_resource(db_session, "course", org.id, key or "")
    if course is None or not (course.public and course.published) or _noindexed(course.seo):
        raise HTTPException(status_code=404, detail="Not found")
    updates = (
        await db_session.execute(
            select(CourseUpdate).where(CourseUpdate.course_id == course.id).order_by(CourseUpdate.id.desc()).limit(FEED_LIMIT)
        )
    ).scalars().all()
    result["resource"] = {"key": public_key("course", course), "uuid": course.course_uuid, "name": course.name, "description": course.description or "", "image": course.thumbnail_image or ""}
    result["items"] = [
        {
            "uuid": u.courseupdate_uuid, "title": u.title, "content": u.content or "",
            "published": u.creation_date or "", "updated": u.update_date or u.creation_date or "",
        }
        for u in updates
    ]
    return result


async def llms_data(request: Request, db_session: AsyncSession, org_slug: str, full: bool = False) -> dict:
    """The org and its public, indexable content, for llms.txt / llms-full.txt.

    ``full`` adds course outlines (chapters and lessons anyone can open),
    episode lists and recent answered threads. Respects the AI crawler
    policy: ``block_all`` and disabled indexing return 404 (no llms.txt).
    """
    org, seo = await _org(db_session, org_slug)
    info = _org_info(org, seo)
    if info["indexing_disabled"] or not info["llms_txt_enabled"] or info["ai_crawler_policy"] == "block_all":
        raise HTTPException(status_code=404, detail="Not found")
    courses = await _listed_courses(db_session, org.id, seo, LLMS_LIMIT)
    authors = await _course_authors(db_session, [c.course_uuid for c in courses])
    course_items = []
    for c in courses:
        entry = _course_entry(c, authors.get(c.course_uuid, []))
        if full:
            entry["outline"] = await _public_activities(request, db_session, c) if feature_indexable(seo, "activities") else []
        course_items.append(entry)

    paths = []
    if feature_indexable(seo, "paths"):
        rows = (
            await db_session.execute(
                select(Path).where(Path.org_id == org.id, Path.public == True, Path.published == True).order_by(Path.id).limit(LLMS_LIMIT)  # noqa: E712
            )
        ).scalars().all()
        listed_course_ids = {c.id: c for c in courses}
        for p in rows:
            if _noindexed(p.seo):
                continue
            entry = {"key": public_key("path", p), "name": p.name, "description": (p.seo or {}).get("description") or p.description or "", "level": p.level or ""}
            if full:
                pcs = (await db_session.execute(select(PathCourse).where(PathCourse.path_id == p.id).order_by(PathCourse.position))).scalars().all()
                entry["courses"] = [
                    {"key": public_key("course", listed_course_ids[pc.course_id]), "name": listed_course_ids[pc.course_id].name, "required": pc.required}
                    for pc in pcs if pc.course_id in listed_course_ids
                ]
            paths.append(entry)

    podcasts = []
    if feature_indexable(seo, "podcasts"):
        rows = (
            await db_session.execute(
                select(Podcast).where(Podcast.org_id == org.id, Podcast.public == True, Podcast.published == True).order_by(Podcast.id).limit(LLMS_LIMIT)  # noqa: E712
            )
        ).scalars().all()
        for p in rows:
            if _noindexed(p.seo):
                continue
            entry = {"key": public_key("podcast", p), "name": p.name, "description": (p.seo or {}).get("description") or p.description or ""}
            if full:
                entry["episodes"] = [
                    {"number": e["number"], "title": e["title"], "description": e["description"], "duration_seconds": e["duration_seconds"]}
                    for e in await _episodes(request, db_session, org, p, limit=100)
                ]
            podcasts.append(entry)

    communities = []
    for c in await _open_communities(request, db_session, org.id, seo):
        entry = {"key": public_key("community", c), "name": c.name, "description": (c.seo or {}).get("description") or c.description or ""}
        if full:
            threads = await _threads(db_session, seo, [c], "top", limit=20)
            entry["threads"] = [
                {"segment": t["segment"], "title": t["title"], "replies": t["replies"], "answered": t["answered"]} for t in threads
            ]
        communities.append(entry)

    folders = []
    if feature_indexable(seo, "library"):
        rows = (
            await db_session.execute(select(Folder).where(Folder.org_id == org.id, Folder.public == True).order_by(Folder.id).limit(LLMS_LIMIT))  # noqa: E712
        ).scalars().all()
        folders = [
            {"key": public_key("folder", f), "name": f.name, "description": (f.seo or {}).get("description") or f.description or ""}
            for f in rows if not _noindexed(f.seo)
        ]

    return {
        "org": info,
        "seo": {"default_meta_description": seo.get("default_meta_description") or ""},
        "courses": course_items,
        "paths": paths,
        "podcasts": podcasts,
        "communities": communities,
        "folders": folders,
    }


MARKDOWN_TYPES = ("course", "activity", "path", "podcast", "community", "thread")


async def markdown_data(
    request: Request,
    db_session: AsyncSession,
    org_slug: str,
    resource_type: str,
    key: str,
    sub: Optional[str] = None,
) -> dict:
    """One public page as structured data for its Markdown alternate.

    Only pages that are indexable for an anonymous visitor: anything else is a
    404, so a Markdown URL never reveals more than the HTML page would.
    """
    if resource_type not in MARKDOWN_TYPES:
        raise HTTPException(status_code=404, detail="Not found")
    org, seo = await _org(db_session, org_slug)
    info = _org_info(org, seo)
    if info["indexing_disabled"] or not info["llms_txt_enabled"] or info["ai_crawler_policy"] == "block_all":
        raise HTTPException(status_code=404, detail="Not found")
    base: dict[str, Any] = {"org": info, "type": resource_type}

    if resource_type in ("course", "activity"):
        course, _ = await find_resource(db_session, "course", org.id, key)
        if course is None or not (course.public and course.published) or _noindexed(course.seo) or not feature_indexable(seo, "courses"):
            raise HTTPException(status_code=404, detail="Not found")
        authors = (await _course_authors(db_session, [course.course_uuid])).get(course.course_uuid, [])
        outline = await _public_activities(request, db_session, course) if feature_indexable(seo, "activities") else []
        base["course"] = {**_course_entry(course, authors), "outline": outline}
        if resource_type == "course":
            return base
        target = (sub or "").replace("activity_", "", 1)
        entry = next((a for a in outline if a["key"] == target), None)
        if entry is None or not entry["public"]:
            raise HTTPException(status_code=404, detail="Not found")
        activity = (
            await db_session.execute(select(Activity).where(Activity.activity_uuid == f"activity_{target}", Activity.course_id == course.id))
        ).scalars().first()
        content: Any = None
        if activity is not None and activity.activity_type == ActivityTypeEnum.TYPE_DYNAMIC:
            content = activity.content
        base["activity"] = {**entry, "content": content, "details": None}
        return base

    if resource_type == "path":
        path, _ = await find_resource(db_session, "path", org.id, key)
        if path is None or not (path.public and path.published) or _noindexed(path.seo) or not feature_indexable(seo, "paths"):
            raise HTTPException(status_code=404, detail="Not found")
        courses = (
            await db_session.execute(
                select(Course, PathCourse.required)
                .join(PathCourse, PathCourse.course_id == Course.id)
                .where(PathCourse.path_id == path.id)
                .order_by(PathCourse.position)
            )
        ).all()
        base["path"] = {
            "key": public_key("path", path), "name": path.name, "description": path.description or "", "about": path.about or "",
            "level": path.level or "",
            "courses": [
                {"key": public_key("course", c), "name": c.name, "description": c.description or "", "required": required}
                for c, required in courses if c.public and c.published and not _noindexed(c.seo)
            ],
        }
        return base

    if resource_type == "podcast":
        podcast, _ = await find_resource(db_session, "podcast", org.id, key)
        if podcast is None or not (podcast.public and podcast.published) or _noindexed(podcast.seo) or not feature_indexable(seo, "podcasts"):
            raise HTTPException(status_code=404, detail="Not found")
        base["podcast"] = {
            "key": public_key("podcast", podcast), "name": podcast.name, "description": podcast.description or "",
            "about": getattr(podcast, "about", "") or "",
            "episodes": await _episodes(request, db_session, org, podcast, limit=200),
        }
        return base

    # community / thread
    community, _ = await find_resource(db_session, "community", org.id, key)
    if (
        community is None
        or not community.public
        or _noindexed(community.seo)
        or not feature_indexable(seo, "communities")
        or await _anon_locked(request, db_session, community.community_uuid)
    ):
        raise HTTPException(status_code=404, detail="Not found")
    base["community"] = {"key": public_key("community", community), "name": community.name, "description": community.description or ""}
    if resource_type == "community":
        base["threads"] = await _threads(db_session, seo, [community], "new", limit=FEED_LIMIT)
        return base
    head = (sub or "").split("-", 1)[0]
    if not head.isdigit() or len(head) > 18:
        raise HTTPException(status_code=404, detail="Not found")
    discussion = (
        await db_session.execute(select(Discussion).where(Discussion.id == int(head), Discussion.community_id == community.id))
    ).scalars().first()
    if discussion is None:
        raise HTTPException(status_code=404, detail="Not found")
    comments = (
        await db_session.execute(
            select(DiscussionComment).where(DiscussionComment.discussion_id == discussion.id).order_by(DiscussionComment.id).limit(200)
        )
    ).scalars().all()
    if is_thin_thread(seo, len(comments), discussion.creation_date):
        raise HTTPException(status_code=404, detail="Not found")
    users = await _users(db_session, {discussion.author_id, *(c.author_id for c in comments)})
    base["thread"] = {
        "id": discussion.id,
        "segment": thread_segment(discussion.id, discussion.title),
        "title": discussion.title,
        "content": discussion.content or "",
        "label": discussion.label or "general",
        "author": _author_name(users.get(discussion.author_id)),
        "upvotes": discussion.upvote_count or 0,
        "published": discussion.creation_date or "",
        "updated": discussion.update_date or discussion.creation_date or "",
        "answer_id": discussion.answer_comment_id,
        "comments": [
            {
                "id": c.id,
                "content": c.content or "",
                "author": _author_name(users.get(c.author_id)),
                "upvotes": c.upvote_count or 0,
                "published": c.creation_date or "",
                "accepted": c.id == discussion.answer_comment_id,
            }
            for c in comments
        ],
    }
    return base


async def thread_jsonld_data(request: Request, db_session: AsyncSession, org_slug: str, community_key: str, ref: str) -> dict:
    """Top replies of an indexable thread for its DiscussionForumPosting/QAPage
    structured data (anonymous view; 404 when the thread isn't indexable)."""
    info = await thread_lookup(request, db_session, AnonymousUser(), org_slug, community_key, ref)
    if not info["indexable"]:
        raise HTTPException(status_code=404, detail="Not found")
    discussion = (await db_session.execute(select(Discussion).where(Discussion.id == info["id"]))).scalars().first()
    comments = (
        await db_session.execute(
            select(DiscussionComment)
            .where(DiscussionComment.discussion_id == discussion.id)
            .order_by(DiscussionComment.upvote_count.desc(), DiscussionComment.id)
            .limit(TOP_COMMENTS)
        )
    ).scalars().all()
    accepted = None
    if discussion.answer_comment_id and all(c.id != discussion.answer_comment_id for c in comments):
        accepted = (
            await db_session.execute(select(DiscussionComment).where(DiscussionComment.id == discussion.answer_comment_id))
        ).scalars().first()
    rows = list(comments) + ([accepted] if accepted else [])
    users = await _users(db_session, {discussion.author_id, *(c.author_id for c in rows)})
    return {
        **info,
        "content": discussion.content or "",
        "author": _author_name(users.get(discussion.author_id)),
        "author_username": (users.get(discussion.author_id).username if users.get(discussion.author_id) else ""),
        "upvotes": discussion.upvote_count or 0,
        "published": discussion.creation_date or "",
        "updated": discussion.update_date or discussion.creation_date or "",
        "comments": [
            {
                "id": c.id,
                "content": c.content or "",
                "author": _author_name(users.get(c.author_id)),
                "upvotes": c.upvote_count or 0,
                "published": c.creation_date or "",
                "accepted": c.id == discussion.answer_comment_id,
            }
            for c in rows
        ],
    }
