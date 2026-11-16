"""Mobile push through the Expo push service.

Devices register an Expo push token (``ExponentPushToken[...]``) with
:func:`register_device`. When :func:`src.services.notifications.notifications.notify`
writes rows, it hands their ids to :func:`schedule_push`, which sends them in
a background task with a session of its own, so a slow push service never
holds up the request that caused the notification.

Per-user preferences (master switch + categories) are applied at send time.
A device registered for one org only receives that org's notifications. The
badge is the user's unread count for the device's scope.

Expo answers each message with a ticket. ``DeviceNotRegistered`` means the app
was uninstalled or the token rotated: the device row is dropped. Receipts
(delivery confirmation from APNs/FCM) are not polled.

Config: ``LEARNHOUSE_EXPO_ACCESS_TOKEN`` (optional, needed when "enhanced push
security" is on for the Expo project), ``LEARNHOUSE_PUSH_DISABLED`` to turn
sending off entirely.
"""

from __future__ import annotations

import asyncio
import logging
import os
import re
from typing import Iterable, Optional

import httpx
from fastapi import HTTPException
from sqlalchemy import delete, func
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.notifications import Notification, NotificationPreference, PushDevice
from src.services.notifications.notifications import now_iso, wants_push

logger = logging.getLogger(__name__)

EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"
CHUNK = 100
MAX_DEVICES_PER_USER = 10
TOKEN_RE = re.compile(r"^Expo(nent)?PushToken\[[A-Za-z0-9_\-]{10,200}\]$")
PLATFORMS = {"ios", "android"}
HIGH_PRIORITY_TYPES = {"message", "live_session"}

_tasks: set[asyncio.Task] = set()


def push_disabled() -> bool:
    return bool(os.environ.get("LEARNHOUSE_PUSH_DISABLED")) or os.environ.get("TESTING") == "true"


# ---------------------------------------------------------------------------
# Devices
# ---------------------------------------------------------------------------


def device_view(d: PushDevice) -> dict:
    return {
        "token": d.token,
        "platform": d.platform,
        "org_id": d.org_id,
        "device_name": d.device_name,
        "app_version": d.app_version,
        "creation_date": d.creation_date,
        "last_seen_at": d.last_seen_at,
    }


async def register_device(
    db: AsyncSession,
    user_id: int,
    token: str,
    platform: str,
    org_id: Optional[int] = None,
    device_name: str = "",
    app_version: str = "",
) -> dict:
    token = (token or "").strip()
    if not TOKEN_RE.match(token):
        raise HTTPException(status_code=400, detail="Not an Expo push token")
    platform = (platform or "").lower()
    if platform not in PLATFORMS:
        raise HTTPException(status_code=400, detail="platform must be ios or android")
    if org_id is not None:
        from src.db.user_organizations import UserOrganization

        member = (await db.execute(select(UserOrganization.id).where(
            UserOrganization.user_id == user_id, UserOrganization.org_id == org_id
        ))).scalars().first()
        if member is None:
            raise HTTPException(status_code=403, detail="Not a member of this organization")

    stamp = now_iso()
    device = (await db.execute(select(PushDevice).where(PushDevice.token == token))).scalars().first()
    if device is None:
        device = PushDevice(token=token, user_id=user_id, creation_date=stamp)
    # The same phone signing in to another account takes the token with it.
    device.user_id = user_id
    device.platform = platform
    device.org_id = org_id
    device.device_name = (device_name or "")[:120]
    device.app_version = (app_version or "")[:40]
    device.last_seen_at = stamp
    db.add(device)
    await db.commit()
    await db.refresh(device)

    # Keep the newest few: a reinstall loop must not grow the list forever.
    stale = (await db.execute(
        select(PushDevice.id).where(PushDevice.user_id == user_id)
        .order_by(PushDevice.last_seen_at.desc()).offset(MAX_DEVICES_PER_USER)  # type: ignore[attr-defined]
    )).scalars().all()
    if stale:
        await db.execute(delete(PushDevice).where(PushDevice.id.in_(stale)))  # type: ignore[union-attr]
        await db.commit()
    return device_view(device)


async def unregister_device(db: AsyncSession, user_id: int, token: str) -> dict:
    result = await db.execute(delete(PushDevice).where(
        PushDevice.token == (token or "").strip(), PushDevice.user_id == user_id
    ))
    await db.commit()
    return {"removed": bool(result.rowcount)}


async def list_devices(db: AsyncSession, user_id: int) -> list[dict]:
    rows = (await db.execute(
        select(PushDevice).where(PushDevice.user_id == user_id).order_by(PushDevice.last_seen_at.desc())  # type: ignore[attr-defined]
    )).scalars().all()
    return [device_view(d) for d in rows]


# ---------------------------------------------------------------------------
# Sending
# ---------------------------------------------------------------------------


def schedule_push(notification_ids: list[int]) -> None:
    """Send these rows' pushes in the background. Never raises."""
    if not notification_ids or push_disabled():
        return
    try:
        task = asyncio.create_task(_push_task(list(notification_ids)))
        _tasks.add(task)
        task.add_done_callback(_tasks.discard)
    except Exception:  # pragma: no cover - no running loop
        logger.warning("Push not scheduled", exc_info=True)


async def _push_task(notification_ids: list[int]) -> None:
    try:
        from src.core.events.database import _async_session_factory

        async with _async_session_factory() as db:
            await send_push(db, notification_ids)
    except Exception:
        logger.exception("Push delivery failed")


async def _badges(db: AsyncSession, user_ids: Iterable[int]) -> dict[tuple[int, Optional[int]], int]:
    rows = (await db.execute(
        select(Notification.user_id, Notification.org_id, func.count(Notification.id))
        .where(Notification.user_id.in_(list(user_ids)), Notification.read_at.is_(None))  # type: ignore[attr-defined,union-attr]
        .group_by(Notification.user_id, Notification.org_id)
    )).all()
    return {(u, o): n for u, o, n in rows}


def _badge(counts: dict[tuple[int, Optional[int]], int], user_id: int, org_id: Optional[int]) -> int:
    if org_id is None:
        return sum(n for (u, _), n in counts.items() if u == user_id)
    return counts.get((user_id, org_id), 0) + counts.get((user_id, None), 0)


def build_message(n: Notification, device: PushDevice, badge: int) -> dict:
    data = {
        **(n.data or {}),
        "notification_uuid": n.notification_uuid,
        "type": n.type,
        "category": n.category,
        "org_id": n.org_id,
    }
    msg = {
        "to": device.token,
        "title": n.title,
        "body": n.body if n.count <= 1 or n.type != "message" else f"{n.body}\n+{n.count - 1} more",
        "data": data,
        "sound": "default",
        "badge": badge,
        "priority": "high" if n.type in HIGH_PRIORITY_TYPES else "default",
    }
    if n.type == "message":
        # iOS groups these into one stack per conversation.
        msg["threadId"] = n.group_key or n.notification_uuid
    return msg


async def send_push(db: AsyncSession, notification_ids: list[int]) -> int:
    """Push the given rows to their users' devices. Returns messages accepted."""
    notes = (await db.execute(
        select(Notification).where(Notification.id.in_(notification_ids))  # type: ignore[union-attr]
    )).scalars().all()
    # Read before the push went out (e.g. opened on the web): stay quiet.
    notes = [n for n in notes if n.read_at is None]
    if not notes:
        return 0
    user_ids = {n.user_id for n in notes}
    devices: dict[int, list[PushDevice]] = {}
    for d in (await db.execute(select(PushDevice).where(PushDevice.user_id.in_(user_ids)))).scalars().all():  # type: ignore[attr-defined]
        devices.setdefault(d.user_id, []).append(d)
    if not devices:
        return 0
    prefs = {p.user_id: p for p in (await db.execute(
        select(NotificationPreference).where(NotificationPreference.user_id.in_(user_ids))  # type: ignore[attr-defined]
    )).scalars().all()}
    counts = await _badges(db, devices.keys())

    messages: list[dict] = []
    for n in notes:
        if not wants_push(prefs.get(n.user_id), n.category):
            continue
        for d in devices.get(n.user_id, []):
            if d.org_id is not None and n.org_id is not None and d.org_id != n.org_id:
                continue
            messages.append(build_message(n, d, _badge(counts, n.user_id, d.org_id)))
    if not messages:
        return 0
    return await deliver(db, messages)


async def deliver(db: AsyncSession, messages: list[dict]) -> int:
    headers = {"Accept": "application/json", "Content-Type": "application/json"}
    access = os.environ.get("LEARNHOUSE_EXPO_ACCESS_TOKEN")
    if access:
        headers["Authorization"] = f"Bearer {access}"
    accepted = 0
    dead: set[str] = set()
    async with httpx.AsyncClient(timeout=15) as client:
        for start in range(0, len(messages), CHUNK):
            chunk = messages[start:start + CHUNK]
            try:
                resp = await client.post(EXPO_PUSH_URL, json=chunk, headers=headers)
                resp.raise_for_status()
                tickets = resp.json().get("data") or []
            except Exception as exc:
                logger.warning("Expo push request failed: %s", exc)
                continue
            for msg, ticket in zip(chunk, tickets):
                if ticket.get("status") == "ok":
                    accepted += 1
                elif (ticket.get("details") or {}).get("error") == "DeviceNotRegistered":
                    dead.add(msg["to"])
                else:
                    logger.info("Expo push rejected: %s", ticket.get("message"))
    if dead:
        await db.execute(delete(PushDevice).where(PushDevice.token.in_(dead)))  # type: ignore[attr-defined]
        await db.commit()
    return accepted
