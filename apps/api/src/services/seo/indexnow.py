"""IndexNow: tell Bing, Yandex, Seznam, Naver (and other participating search
engines) right away when public content is published or changes.

Opt-in per org (``seo.indexnow_enabled``). The key is generated server-side on
opt-in and served by the web app at ``/{key}.txt`` on the org's host, which is
how IndexNow verifies that we own the URLs we submit.

Pings run in the background and never raise: a search engine being down must
not fail a publish. They are skipped for local and private hosts, when the
org hides itself from search engines, and when ``LEARNHOUSE_INDEXNOW_DISABLED``
is set (tests and local stacks never reach the network).
"""

import asyncio
import ipaddress
import logging
import os
import secrets
import time
from typing import Iterable, Optional
from urllib.parse import quote, urlparse

import httpx

logger = logging.getLogger(__name__)

INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow"
# Same URL submitted again within this window is skipped (autosave bursts).
DEDUPE_SECONDS = 600
MAX_URLS_PER_PING = 1000
THREAD_SLUG_MAX = 60

_recent: dict[str, float] = {}
_background_tasks: set = set()


def merge_server_managed(previous: Optional[dict], incoming: dict) -> dict:
    """Keep the server-managed IndexNow key across saves.

    Clients never choose the key: the stored one is kept whatever they send,
    and a new random one is generated the first time the org opts in.
    """
    key = (previous or {}).get("indexnow_key") or ""
    if not key and incoming.get("indexnow_enabled"):
        key = secrets.token_hex(16)
    incoming["indexnow_key"] = key
    return incoming


def globally_disabled() -> bool:
    return os.environ.get("LEARNHOUSE_INDEXNOW_DISABLED", "").lower() in ("1", "true", "yes") or os.environ.get(
        "TESTING", ""
    ).lower() in ("1", "true", "yes")


def is_public_host(host: Optional[str]) -> bool:
    """False for hosts no search engine can crawl (localhost, LAN, .test...)."""
    if not host:
        return False
    host = host.lower().rstrip(".")
    if host == "localhost" or host.endswith((".localhost", ".local", ".test", ".internal", ".lvh.me")) or host == "lvh.me":
        return False
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        return "." in host
    return not (ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_unspecified)


def _fresh(urls: Iterable[str], now: float) -> list[str]:
    out: list[str] = []
    for url in urls:
        last = _recent.get(url)
        if last is not None and now - last < DEDUPE_SECONDS:
            continue
        out.append(url)
    if len(_recent) > 5000:
        for k in [k for k, v in _recent.items() if now - v >= DEDUPE_SECONDS]:
            _recent.pop(k, None)
    return out


async def ping(base_url: str, key: str, urls: list[str], client: Optional[httpx.AsyncClient] = None) -> bool:
    """Submit ``urls`` (absolute, same host as ``base_url``). True when accepted."""
    host = urlparse(base_url).hostname
    if not key or not urls or not is_public_host(host):
        return False
    now = time.monotonic()
    same_host = [u for u in urls if urlparse(u).hostname == host]
    fresh = _fresh(same_host, now)[:MAX_URLS_PER_PING]
    if not fresh:
        return False
    payload = {
        "host": host,
        "key": key,
        "keyLocation": f"{base_url.rstrip('/')}/{key}.txt",
        "urlList": fresh,
    }
    owns_client = client is None
    client = client or httpx.AsyncClient(timeout=5.0)
    try:
        res = await client.post(INDEXNOW_ENDPOINT, json=payload)
        ok = res.status_code in (200, 202)
        if ok:
            for url in fresh:
                _recent[url] = now
        else:
            logger.info("IndexNow rejected %d URL(s) for %s: HTTP %s", len(fresh), host, res.status_code)
        return ok
    except Exception as exc:  # network errors never surface
        logger.info("IndexNow ping failed for %s: %s", host, exc)
        return False
    finally:
        if owns_client:
            await client.aclose()


# ----------------------------------------------------------------------------
# Events -> public URLs
# ----------------------------------------------------------------------------

def thread_segment(discussion_id: int, title: Optional[str]) -> str:
    """``42-how-do-payouts-work``: the readable, stable part of a thread URL."""
    from src.services.seo.slugify import slugify

    slug = slugify(title or "", THREAD_SLUG_MAX)
    return f"{discussion_id}-{slug}" if slug else str(discussion_id)


async def _paths_for_event(db_session, org_id: int, event_name: str, data: dict) -> list[str]:
    """Public paths an event changed, only for content anyone may see."""
    from sqlalchemy import select

    from src.services.seo.seo import public_key

    data = data or {}
    if event_name in ("course_published", "course_update_published"):
        from src.db.courses.courses import Course

        course = (
            await db_session.execute(select(Course).where(Course.course_uuid == data.get("course_uuid"), Course.org_id == org_id))
        ).scalars().first()
        if not course or not (course.public and course.published):
            return []
        return [f"/course/{quote(public_key('course', course))}", "/courses"]
    if event_name == "discussion_posted":
        from src.db.communities.communities import Community
        from src.db.communities.discussions import Discussion

        uuid = (data.get("discussion") or {}).get("discussion_uuid")
        row = (
            await db_session.execute(
                select(Discussion, Community)
                .join(Community, Community.id == Discussion.community_id)
                .where(Discussion.discussion_uuid == uuid, Discussion.org_id == org_id)
            )
        ).first()
        if not row or not row[1].public:
            return []
        discussion, community = row
        ckey = quote(public_key("community", community))
        return [f"/community/{ckey}/{thread_segment(discussion.id, discussion.title)}", f"/community/{ckey}"]
    if event_name == "podcast_episode_created":
        from src.db.podcasts.podcasts import Podcast

        podcast = (
            await db_session.execute(select(Podcast).where(Podcast.podcast_uuid == data.get("podcast_uuid"), Podcast.org_id == org_id))
        ).scalars().first()
        if not podcast or not (podcast.public and podcast.published):
            return []
        return [f"/podcast/{quote(public_key('podcast', podcast))}"]
    if event_name in ("folder_created", "folder_updated"):
        from src.db.folders.folders import Folder

        folder = (
            await db_session.execute(select(Folder).where(Folder.folder_uuid == data.get("folder_uuid"), Folder.org_id == org_id))
        ).scalars().first()
        if not folder or not folder.public:
            return []
        return [f"/library/folder/{quote(public_key('folder', folder))}"]
    return []


INDEXNOW_EVENTS = frozenset(
    {"course_published", "course_update_published", "discussion_posted", "podcast_episode_created", "folder_created", "folder_updated"}
)


async def handle_event(event_name: str, org_id: int, data: dict, session_factory=None, client=None) -> bool:
    """Resolve the URLs an event touched and ping, when the org opted in."""
    if globally_disabled() and client is None:
        return False
    from sqlalchemy import select

    from src.db.organizations import Organization
    from src.services.nudges.links import org_base_url
    from src.services.seo.seo import org_seo_config

    if session_factory is None:
        from src.core.events.database import _async_session_factory as session_factory  # noqa: N811
    try:
        async with session_factory() as db_session:
            seo = await org_seo_config(db_session, org_id)
            if not seo.get("indexnow_enabled") or not seo.get("indexnow_key") or seo.get("indexing_disabled"):
                return False
            paths = await _paths_for_event(db_session, org_id, event_name, data)
            if not paths:
                return False
            org = (await db_session.execute(select(Organization).where(Organization.id == org_id))).scalars().first()
            if not org:
                return False
            base = await org_base_url(org.slug, db_session, org.id)
        return await ping(base, seo["indexnow_key"], [f"{base}{p}" for p in paths], client=client)
    except Exception as exc:
        logger.info("IndexNow event %s skipped: %s", event_name, exc)
        return False


def notify_event(event_name: str, org_id: int, data: dict) -> None:
    """Fire-and-forget hook for the webhook dispatcher. Cheap when unused."""
    if event_name not in INDEXNOW_EVENTS or globally_disabled():
        return
    try:
        task = asyncio.get_running_loop().create_task(handle_event(event_name, org_id, data))
    except RuntimeError:
        return
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)
