"""Tells the collab server an activity's content was written outside its room.

Every path that writes a page activity's content without going through the
collab server (legacy editor save, AI and MCP tools, version restore, course
planning) calls ``notify_collab_content_changed`` after committing. A loaded
room then replaces its content in one update (clients see "Updated by …");
otherwise the server drops its cached state. Best effort and fire-and-forget:
the collab server being down never fails or slows the write, and a room that
missed the notification still catches up, because its next save is refused
for being based on an older version.
"""

import asyncio
import logging
import os
from contextvars import ContextVar
from typing import Any, Optional

import httpx

from src.db.courses.activities import Activity
from src.db.users import User

logger = logging.getLogger(__name__)

NOTIFY_TIMEOUT_SECONDS = 2.0
DEFAULT_COLLAB_INTERNAL_URL = "http://localhost:4000"

# Strong references to in-flight notifications (the loop keeps only weak ones)
_pending: set[asyncio.Task] = set()


def _collab_url() -> str:
    return os.getenv("LEARNHOUSE_COLLAB_INTERNAL_URL", DEFAULT_COLLAB_INTERNAL_URL).rstrip("/")


async def _post_reset(activity_uuid: str, payload: dict[str, Any], key: str) -> None:
    url = f"{_collab_url()}/internal/activity/{activity_uuid}/reset"
    try:
        async with httpx.AsyncClient(timeout=NOTIFY_TIMEOUT_SECONDS) as client:
            response = await client.post(url, json=payload, headers={"X-Internal-Key": key})
        if response.status_code != 200:
            logger.warning("Collab reset for %s answered %s", activity_uuid, response.status_code)
    except httpx.HTTPError as exc:
        logger.info("Collab reset for %s not delivered: %s", activity_uuid, exc)


KICK_BATCH = 500


async def _post_kick(activity_uuids: list[str], key: str) -> None:
    url = f"{_collab_url()}/internal/activities/kick"
    try:
        async with httpx.AsyncClient(timeout=NOTIFY_TIMEOUT_SECONDS) as client:
            for i in range(0, len(activity_uuids), KICK_BATCH):
                response = await client.post(
                    url, json={"activity_uuids": activity_uuids[i:i + KICK_BATCH]}, headers={"X-Internal-Key": key}
                )
                if response.status_code != 200:
                    logger.warning("Collab kick answered %s", response.status_code)
    except httpx.HTTPError as exc:
        logger.info("Collab kick not delivered: %s", exc)


def _schedule(coro) -> None:
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        coro.close()
        return
    task = loop.create_task(coro)
    _pending.add(task)
    task.add_done_callback(_pending.discard)


def kick_collab_rooms(activity_uuids: list[str]) -> None:
    """Live editing was turned off for these activities: the collab server
    saves each open room and drops its connections now (editors switch to
    manual saving). Best effort, fire-and-forget."""
    key = os.getenv("COLLAB_INTERNAL_KEY")
    if not key or not activity_uuids:
        return
    _schedule(_post_kick(list(activity_uuids), key))


# Set while an AI agent's tool runs (see ai/tools/registry.run_tool): the
# write is the agent's, on behalf of the user, so editors in the room see
# "Updated by Atlas" rather than the name of the person sitting there.
writing_agent: ContextVar[Optional[str]] = ContextVar("writing_agent", default=None)


def _editor(user: Any) -> Optional[dict[str, Any]]:
    """{id, name} of whoever wrote, for the "Updated by" notice; an agent
    writing for a user adds {agent: true, for: <user's name>}."""
    if user is None or isinstance(user, int):
        return None
    user_id = getattr(user, "id", None)
    if not isinstance(user_id, int) or user_id <= 0:
        return None
    full = f"{getattr(user, 'first_name', '') or ''} {getattr(user, 'last_name', '') or ''}".strip()
    name = (full or getattr(user, "username", "") or "Someone")[:80]
    agent = writing_agent.get()
    if agent:
        return {"id": user_id, "name": agent[:80], "agent": True, "for": name}
    return {"id": user_id, "name": name}


def notify_collab_content_changed(activity: Activity, by: Optional[User | Any] = None) -> None:
    """Schedules the reset notification for a page activity whose content
    was just committed. No-op for other activity types or when collaboration
    isn't configured."""
    # Imported here: collab.py imports the versioning service, which imports this
    from src.services.courses.activities.collab import is_collab_activity

    key = os.getenv("COLLAB_INTERNAL_KEY")
    if not key or not is_collab_activity(activity):
        return
    payload = {
        "content": activity.content or {},
        "current_version": activity.current_version or 1,
        "by": _editor(by),
    }
    _schedule(_post_reset(activity.activity_uuid, payload, key))
