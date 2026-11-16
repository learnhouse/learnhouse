"""The learner notification inbox: write, list, count, mark read, preferences.

Writers call :func:`notify` with one :class:`NotificationInput` per recipient.
It runs in a session of its own, bound to the caller's engine, so a failure
here (or a dedupe collision) never rolls back or poisons the caller's
transaction. It never raises.

Rows with a ``group_key`` collapse while unread: the old unread row is
replaced by a new one carrying ``count + 1``, so the newest event sits at the
top of the id-ordered feed. Rows with a ``dedupe_key`` are written at most once
per user (unique constraint), which is what makes the scheduled jobs safe to
run on several API pods.

Each recipient's preferences are applied at write time: a category switched
off in-app writes nothing (and so pushes and emails nothing). After the
commit, rows marked ``push`` are handed to
:func:`src.services.notifications.push.schedule_push` and every row is
published on the recipient's realtime channel (the web bell's SSE stream).

Rows carry an ``audience``: "personal" for the learner bell and the mobile
app, "admin" for the dashboard bell. Reads default to "personal", so clients
written before admin rows existed see exactly what they saw before.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Iterable, Optional
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy import delete, func, or_, update
from sqlalchemy.exc import IntegrityError
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.notifications import (
    ADMIN_CATEGORIES,
    AUDIENCES,
    NOTIFICATION_CATEGORIES,
    PRIORITIES,
    Notification,
    NotificationPreference,
    audience_of_category,
    meta_for,
)

logger = logging.getLogger(__name__)

MAX_PAGE = 100
# Above this many recipients (a course update to every learner, a bulk
# import), rows are written in the background in batches, so the request that
# caused them returns at once and the database sees small transactions.
BULK_THRESHOLD = 200
BATCH_SIZE = 500
_tasks: set[asyncio.Task] = set()
TITLE_MAX = 200
BODY_MAX = 500


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass
class NotificationInput:
    user_id: int
    org_id: Optional[int]
    type: str
    title: str
    body: str = ""
    data: dict = field(default_factory=dict)
    image: Optional[str] = None
    group_key: Optional[str] = None
    dedupe_key: Optional[str] = None
    # False writes the inbox row without a push (e.g. the person is online).
    push: bool = True
    # Defaults come from the type (src/db/notifications.py).
    audience: Optional[str] = None
    priority: Optional[str] = None
    actor_id: Optional[int] = None
    # ISO 8601 UTC; the row is hidden after it.
    expires_at: Optional[str] = None
    # Replace the group's previous row even once read (one row per thing,
    # e.g. a learner's submission of an assignment), not only while unread.
    replace_read: bool = False


def _clip(text: Optional[str], limit: int) -> str:
    text = (text or "").strip()
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


def _sibling_session(db: AsyncSession) -> AsyncSession:
    bind = getattr(db, "bind", None)
    if bind is None:  # pragma: no cover - every real session has a bind
        from src.core.events.database import _async_session_factory

        return _async_session_factory()
    return AsyncSession(bind, expire_on_commit=False)


def actor_view(user) -> dict:
    name = f"{user.first_name or ''} {user.last_name or ''}".strip() or user.username
    return {
        "id": user.id,
        "user_uuid": user.user_uuid,
        "username": user.username,
        "name": name,
        "avatar_image": user.avatar_image or None,
    }


def serialize(n: Notification, actors: Optional[dict] = None) -> dict:
    # The first twelve keys are the original (mobile) contract; the rest were
    # added for the web notification center.
    return {
        "notification_uuid": n.notification_uuid,
        "org_id": n.org_id,
        "type": n.type,
        "category": n.category,
        "title": n.title,
        "body": n.body,
        "data": n.data or {},
        "image": n.image,
        "count": n.count,
        "read": n.read_at is not None,
        "read_at": n.read_at,
        "created_at": n.update_date or n.creation_date,
        "audience": n.audience or "personal",
        "priority": n.priority or "normal",
        "important": (n.priority or "normal") == "important",
        "actor": _support_actor((actors or {}).get(n.actor_id), n.data or {}) if n.actor_id else None,
        "archived": n.archived_at is not None,
        "archived_at": n.archived_at,
        "expires_at": n.expires_at,
        "path": (n.data or {}).get("path"),
    }


async def _actors(db: AsyncSession, rows: Iterable[Notification]) -> dict:
    ids = {n.actor_id for n in rows if n.actor_id}
    if not ids:
        return {}
    from src.db.users import User

    users = (await db.execute(select(User).where(User.id.in_(ids)))).scalars().all()  # type: ignore[union-attr]
    return {u.id: actor_view(u) for u in users}


# ---------------------------------------------------------------------------
# Writing
# ---------------------------------------------------------------------------


def _label_support_session(items: list[NotificationInput]) -> list[NotificationInput]:
    """Mark what an impersonation caused, so whoever
    receives it sees "LearnHouse on behalf of …", not the member."""
    from src.security.impersonation import SUPPORT_LABEL, current_impersonation

    ctx = current_impersonation()
    if ctx is None:
        return items
    mark = {"label": SUPPORT_LABEL, "on_behalf_of": ctx.target_label, "session": ctx.session_id}
    for item in items:
        item.data = {**(item.data or {}), "via_support": mark}
    return items


def _support_actor(actor: Optional[dict], data: dict) -> Optional[dict]:
    mark = data.get("via_support")
    if not isinstance(mark, dict) or not actor:
        return actor
    from src.security.impersonation import SUPPORT_LABEL

    return {**actor, "name": f"{SUPPORT_LABEL} (on behalf of {actor.get('name')})", "via_support": True}


async def notify(db: AsyncSession, items: Iterable[NotificationInput]) -> list[Notification]:
    """Write inbox rows (and queue their pushes). Never raises.

    Large fan-outs return ``[]`` at once and are written in the background
    (see ``BULK_THRESHOLD``)."""
    items = [i for i in items if i.user_id]
    if not items:
        return []
    items = _label_support_session(items)
    if len(items) > BULK_THRESHOLD:
        _spawn(_notify_batches(db, items))
        return []
    return await _notify_now(db, items)


def _spawn(coro) -> None:
    try:
        task = asyncio.get_running_loop().create_task(coro)
    except RuntimeError:  # pragma: no cover - no running loop
        coro.close()
        return
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)


async def _notify_batches(db: AsyncSession, items: list[NotificationInput]) -> int:
    written = 0
    for start in range(0, len(items), BATCH_SIZE):
        written += len(await _notify_now(db, items[start:start + BATCH_SIZE]))
    return written


async def _notify_now(db: AsyncSession, items: list[NotificationInput]) -> list[Notification]:
    try:
        async with _sibling_session(db) as session:
            created, push_ids = await _write(session, items)
    except Exception:
        logger.warning("Writing %s notification(s) failed", len(items), exc_info=True)
        return []
    if push_ids:
        from src.services.notifications.push import schedule_push

        schedule_push(push_ids)
    if created:
        from src.services.notifications import realtime

        realtime.publish_new(created)
    return created


async def _write(session: AsyncSession, items: list[NotificationInput]) -> tuple[list[Notification], list[int]]:
    user_ids = {i.user_id for i in items}

    # Recipients who switched the category off in-app get nothing.
    prefs = {p.user_id: p for p in (await session.execute(
        select(NotificationPreference).where(NotificationPreference.user_id.in_(user_ids))  # type: ignore[attr-defined]
    )).scalars().all()}
    items = [i for i in items if wants_channel(prefs.get(i.user_id), meta_for(i.type).category, "in_app")]
    if not items:
        return [], []

    # Dedupe first, so the common case never hits the unique constraint.
    dedupe = {(i.user_id, i.dedupe_key) for i in items if i.dedupe_key}
    seen: set[tuple[int, str]] = set()
    if dedupe:
        rows = (await session.execute(
            select(Notification.user_id, Notification.dedupe_key).where(
                Notification.user_id.in_(user_ids),  # type: ignore[attr-defined]
                Notification.dedupe_key.in_({k for _, k in dedupe}),  # type: ignore[union-attr]
            )
        )).all()
        seen = {(u, k) for u, k in rows}

    groups = {(i.user_id, i.group_key) for i in items if i.group_key}
    sticky = {i.group_key for i in items if i.group_key and i.replace_read}
    previous: dict[tuple[int, str], Notification] = {}
    if groups:
        rows = (await session.execute(
            select(Notification).where(
                Notification.user_id.in_(user_ids),  # type: ignore[attr-defined]
                Notification.group_key.in_({g for _, g in groups}),  # type: ignore[union-attr]
                or_(Notification.read_at.is_(None), Notification.group_key.in_(sticky)),  # type: ignore[union-attr]
            ).order_by(Notification.id)  # type: ignore[arg-type]
        )).scalars().all()
        for row in rows:
            key = (row.user_id, row.group_key)
            if key in previous:
                # More than one old row (written before this rule): keep the newest.
                await session.delete(previous[key])
            previous[key] = row

    stamp = now_iso()
    pending: list[tuple[Notification, NotificationInput]] = []
    for item in items:
        if item.dedupe_key:
            if (item.user_id, item.dedupe_key) in seen:
                continue
            seen.add((item.user_id, item.dedupe_key))
        count = 1
        if item.group_key:
            old = previous.pop((item.user_id, item.group_key), None)
            if old is not None:
                # A read row being replaced starts over at one.
                count = (old.count or 1) + 1 if old.read_at is None else 1
                await session.delete(old)
        meta = meta_for(item.type)
        audience = item.audience if item.audience in AUDIENCES else meta.audience
        priority = item.priority if item.priority in PRIORITIES else meta.priority
        row = Notification(
            notification_uuid=f"notification_{uuid4()}",
            user_id=item.user_id,
            org_id=item.org_id,
            type=item.type,
            category=meta.category,
            audience=audience,
            priority=priority,
            actor_id=item.actor_id if item.actor_id != item.user_id else None,
            expires_at=item.expires_at,
            title=_clip(item.title, TITLE_MAX),
            body=_clip(item.body, BODY_MAX),
            data=item.data or {},
            image=item.image,
            group_key=item.group_key,
            dedupe_key=item.dedupe_key,
            count=count,
            creation_date=stamp,
            update_date=stamp,
        )
        session.add(row)
        pending.append((row, item))
    if not pending:
        return [], []

    try:
        await session.commit()
    except IntegrityError:
        # Another pod wrote one of the deduped rows between our check and our
        # insert. Fall back to one row at a time and keep the ones that land.
        await session.rollback()
        kept = []
        for row, item in pending:
            fresh = Notification(**row.model_dump(exclude={"id"}))
            session.add(fresh)
            try:
                await session.commit()
                kept.append((fresh, item))
            except IntegrityError:
                await session.rollback()
        pending = kept

    created = [row for row, _ in pending]
    push_ids = [
        row.id for row, item in pending
        if item.push and row.id is not None and wants_push(prefs.get(row.user_id), row.category)
    ]
    return created, push_ids


# ---------------------------------------------------------------------------
# Reading
# ---------------------------------------------------------------------------


Audience = str  # "personal" | "admin" | "all"


def _scope(stmt, user_id: int, org_id: Optional[int], audience: Optional[str] = "personal"):
    stmt = stmt.where(Notification.user_id == user_id)
    if org_id is not None:
        stmt = stmt.where(or_(Notification.org_id == org_id, Notification.org_id.is_(None)))  # type: ignore[union-attr]
    if audience in AUDIENCES:
        stmt = stmt.where(Notification.audience == audience)
    elif audience not in (None, "all"):
        raise HTTPException(status_code=400, detail="Unknown audience")
    return stmt


def _live(stmt, archived: bool = False):
    """Inbox rows: not archived (or only archived ones), not expired."""
    if archived:
        stmt = stmt.where(Notification.archived_at.is_not(None))  # type: ignore[union-attr]
    else:
        stmt = stmt.where(Notification.archived_at.is_(None))  # type: ignore[union-attr]
    return stmt.where(or_(Notification.expires_at.is_(None), Notification.expires_at > now_iso()))  # type: ignore[union-attr,operator]


def _check_category(category: Optional[str]) -> None:
    if category is not None and category not in NOTIFICATION_CATEGORIES:
        raise HTTPException(status_code=400, detail="Unknown category")


def _filters(stmt, *, unread_only=False, category=None, type_=None, important_only=False, q=None):
    if unread_only:
        stmt = stmt.where(Notification.read_at.is_(None))  # type: ignore[union-attr]
    if category:
        stmt = stmt.where(Notification.category == category)
    if type_:
        stmt = stmt.where(Notification.type == type_)
    if important_only:
        stmt = stmt.where(Notification.priority == "important")
    if q:
        like = f"%{q.strip()[:100]}%"
        stmt = stmt.where(or_(Notification.title.ilike(like), Notification.body.ilike(like)))  # type: ignore[attr-defined]
    return stmt


async def list_notifications(
    db: AsyncSession,
    user_id: int,
    org_id: Optional[int] = None,
    *,
    unread_only: bool = False,
    category: Optional[str] = None,
    cursor: Optional[str] = None,
    limit: int = 30,
    audience: Optional[str] = "personal",
    archived: bool = False,
    type_: Optional[str] = None,
    important_only: bool = False,
    q: Optional[str] = None,
) -> dict:
    limit = max(1, min(limit, MAX_PAGE))
    _check_category(category)
    stmt = _live(_scope(select(Notification), user_id, org_id, audience), archived)
    stmt = _filters(stmt, unread_only=unread_only, category=category, type_=type_, important_only=important_only, q=q)
    if cursor:
        try:
            stmt = stmt.where(Notification.id < int(cursor))  # type: ignore[operator]
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid cursor")
    rows = (await db.execute(
        stmt.order_by(Notification.id.desc()).limit(limit + 1)  # type: ignore[union-attr]
        # Bulk updates skip the identity map: never serve a stale copy.
        .execution_options(populate_existing=True)
    )).scalars().all()
    more = len(rows) > limit
    rows = rows[:limit]
    actors = await _actors(db, rows)
    return {
        "items": [serialize(n, actors) for n in rows],
        "next_cursor": str(rows[-1].id) if more and rows else None,
        **(await unread_count(db, user_id, org_id, audience)),
    }


async def unread_count(db: AsyncSession, user_id: int, org_id: Optional[int] = None, audience: Optional[str] = "personal") -> dict:
    rows = (await db.execute(
        _live(_scope(select(Notification.category, Notification.priority, func.count(Notification.id)), user_id, org_id, audience))
        .where(Notification.read_at.is_(None))  # type: ignore[union-attr]
        .group_by(Notification.category, Notification.priority)
    )).all()
    cats = NOTIFICATION_CATEGORIES if audience in (None, "all") else tuple(
        c for c in NOTIFICATION_CATEGORIES if audience_of_category(c) == audience
    )
    by_category = {c: 0 for c in cats}
    important = 0
    for cat, priority, n in rows:
        by_category[cat] = by_category.get(cat, 0) + n
        if priority == "important":
            important += n
    return {
        "unread_count": sum(by_category.values()),
        "unread_by_category": by_category,
        "unread_important": important,
    }


async def counts(db: AsyncSession, user_id: int, org_id: Optional[int] = None) -> dict:
    """Both bells at once (the web header polls this when realtime is down)."""
    personal = await unread_count(db, user_id, org_id, "personal")
    admin = await unread_count(db, user_id, org_id, "admin")
    return {"personal": personal, "admin": admin}


def _target(stmt, user_id, org_id, audience, notification_uuids, all_, category):
    stmt = _scope(stmt, user_id, org_id, audience)
    if not all_:
        stmt = stmt.where(Notification.notification_uuid.in_((notification_uuids or [])[:500]))  # type: ignore[attr-defined]
    if category:
        stmt = stmt.where(Notification.category == category)
    return stmt


async def mark_read(
    db: AsyncSession,
    user_id: int,
    *,
    notification_uuids: Optional[list[str]] = None,
    all_: bool = False,
    org_id: Optional[int] = None,
    category: Optional[str] = None,
    audience: Optional[str] = "personal",
) -> dict:
    if not all_ and not notification_uuids:
        raise HTTPException(status_code=400, detail="Pass notification_uuids or all=true")
    _check_category(category)
    # Marking listed rows read works whatever their audience.
    scope = audience if all_ else "all"
    stmt = _target(update(Notification), user_id, org_id, scope, notification_uuids, all_, category)
    stmt = stmt.where(Notification.read_at.is_(None))  # type: ignore[union-attr]
    result = await db.execute(stmt.values(read_at=now_iso()).execution_options(synchronize_session=False))
    await db.commit()
    _changed(user_id, org_id)
    return {"marked": result.rowcount or 0, **(await unread_count(db, user_id, org_id, audience))}


BULK_ACTIONS = ("read", "unread", "archive", "unarchive", "delete")


async def bulk(
    db: AsyncSession,
    user_id: int,
    action: str,
    *,
    notification_uuids: Optional[list[str]] = None,
    all_: bool = False,
    org_id: Optional[int] = None,
    category: Optional[str] = None,
    audience: Optional[str] = "personal",
) -> dict:
    """Read / unread / archive / unarchive / delete the listed rows, or every
    row in the scope with ``all_``."""
    if action not in BULK_ACTIONS:
        raise HTTPException(status_code=400, detail="Unknown action")
    if action == "read":
        return await mark_read(db, user_id, notification_uuids=notification_uuids, all_=all_,
                               org_id=org_id, category=category, audience=audience)
    if not all_ and not notification_uuids:
        raise HTTPException(status_code=400, detail="Pass notification_uuids or all=true")
    _check_category(category)
    scope = audience if all_ else "all"
    if action == "delete":
        stmt = _target(delete(Notification), user_id, org_id, scope, notification_uuids, all_, category)
    else:
        stmt = _target(update(Notification), user_id, org_id, scope, notification_uuids, all_, category)
        stamp = now_iso()
        values = {
            "unread": {"read_at": None},
            "archive": {"archived_at": stamp, "read_at": func.coalesce(Notification.read_at, stamp)},
            "unarchive": {"archived_at": None},
        }[action]
        stmt = stmt.values(**values)
    result = await db.execute(stmt.execution_options(synchronize_session=False))
    await db.commit()
    _changed(user_id, org_id)
    return {"changed": result.rowcount or 0, **(await unread_count(db, user_id, org_id, audience))}


def _changed(user_id: int, org_id: Optional[int]) -> None:
    from src.services.notifications import realtime

    realtime.publish_changed(user_id, org_id)


async def mark_group_read(db: AsyncSession, user_id: int, group_key: str) -> None:
    """Clear a collapsed row, e.g. when its conversation is read. Never raises."""
    try:
        async with _sibling_session(db) as session:
            await session.execute(
                update(Notification)
                .where(
                    Notification.user_id == user_id,
                    Notification.group_key == group_key,
                    Notification.read_at.is_(None),  # type: ignore[union-attr]
                )
                .values(read_at=now_iso())
                .execution_options(synchronize_session=False)
            )
            await session.commit()
        _changed(user_id, None)
    except Exception:
        logger.warning("Clearing notification group %s failed", group_key, exc_info=True)


async def get_notification(db: AsyncSession, user_id: int, notification_uuid: str) -> Notification:
    row = (await db.execute(select(Notification).where(
        Notification.notification_uuid == notification_uuid, Notification.user_id == user_id
    ))).scalars().first()
    if row is None:
        raise HTTPException(status_code=404, detail="Notification not found")
    return row


async def delete_notification(db: AsyncSession, user_id: int, notification_uuid: str) -> dict:
    row = await get_notification(db, user_id, notification_uuid)
    await db.delete(row)
    await db.commit()
    return {"deleted": True}


async def prune(db: AsyncSession, now: Optional[datetime] = None, read_days: int = 90, any_days: int = 180) -> int:
    """Drop read rows after ``read_days`` and every row after ``any_days``."""
    from datetime import timedelta

    now = now or datetime.now(timezone.utc)
    read_cut = (now - timedelta(days=read_days)).isoformat()
    any_cut = (now - timedelta(days=any_days)).isoformat()
    result = await db.execute(
        delete(Notification).where(or_(
            Notification.creation_date < any_cut,
            (Notification.read_at.is_not(None)) & (Notification.creation_date < read_cut),  # type: ignore[union-attr]
        )).execution_options(synchronize_session=False)
    )
    await db.commit()
    return result.rowcount or 0


# ---------------------------------------------------------------------------
# Preferences
# ---------------------------------------------------------------------------


CHANNELS = ("in_app", "email", "push")
DIGESTS = ("off", "daily", "weekly")

# Sensible defaults: everything in the inbox; pushes for what a person acts
# on (admin noise like newsletters, plan and automation stays off the phone);
# the email digest only collects the categories marked here.
_PUSH_OFF = {"newsletter", "plan", "automation", "people"}
_EMAIL_ON = {"assignments", "live", "billing", "teaching", "people", "integrations", "plan"}


def default_channels(category: str) -> dict:
    return {"in_app": True, "email": category in _EMAIL_ON, "push": category not in _PUSH_OFF}


def channels_view(pref: Optional[NotificationPreference]) -> dict:
    saved = (pref.channels if pref else None) or {}
    legacy = (pref.push_categories if pref else None) or {}
    out = {}
    for c in NOTIFICATION_CATEGORIES:
        view = default_channels(c)
        if c in legacy:
            view["push"] = bool(legacy[c])
        for ch, value in (saved.get(c) or {}).items():
            if ch in CHANNELS:
                view[ch] = bool(value)
        out[c] = view
    return out


def preferences_view(pref: Optional[NotificationPreference]) -> dict:
    channels = channels_view(pref)
    return {
        # Original (mobile) contract.
        "push_enabled": pref.push_enabled if pref else True,
        "push_categories": {c: channels[c]["push"] for c in NOTIFICATION_CATEGORIES},
        # Notification center.
        "channels": channels,
        "email_digest": (pref.email_digest if pref and pref.email_digest in DIGESTS else "off"),
        "categories": [
            {"key": c, "audience": audience_of_category(c)} for c in NOTIFICATION_CATEGORIES
        ],
    }


async def _pref_row(db: AsyncSession, user_id: int) -> Optional[NotificationPreference]:
    return (await db.execute(
        select(NotificationPreference).where(NotificationPreference.user_id == user_id)
    )).scalars().first()


async def get_preferences(db: AsyncSession, user_id: int) -> dict:
    return preferences_view(await _pref_row(db, user_id))


async def update_preferences(
    db: AsyncSession,
    user_id: int,
    push_enabled: Optional[bool] = None,
    push_categories: Optional[dict[str, bool]] = None,
    channels: Optional[dict[str, dict[str, bool]]] = None,
    email_digest: Optional[str] = None,
) -> dict:
    pref = await _pref_row(db, user_id)
    if pref is None:
        pref = NotificationPreference(user_id=user_id, push_categories={}, channels={})
    if push_enabled is not None:
        pref.push_enabled = push_enabled
    if push_categories:
        unknown = set(push_categories) - set(NOTIFICATION_CATEGORIES)
        if unknown:
            raise HTTPException(status_code=400, detail=f"Unknown categories: {', '.join(sorted(unknown))}")
        pref.push_categories = {**(pref.push_categories or {}), **{k: bool(v) for k, v in push_categories.items()}}
        # The newer per-channel view follows the mobile switch.
        merged = dict(pref.channels or {})
        for k, v in push_categories.items():
            merged[k] = {**(merged.get(k) or {}), "push": bool(v)}
        pref.channels = merged
    if channels:
        unknown = set(channels) - set(NOTIFICATION_CATEGORIES)
        if unknown:
            raise HTTPException(status_code=400, detail=f"Unknown categories: {', '.join(sorted(unknown))}")
        merged = dict(pref.channels or {})
        legacy = dict(pref.push_categories or {})
        for cat, switches in channels.items():
            bad = set(switches) - set(CHANNELS)
            if bad:
                raise HTTPException(status_code=400, detail=f"Unknown channels: {', '.join(sorted(bad))}")
            merged[cat] = {**(merged.get(cat) or {}), **{k: bool(v) for k, v in switches.items()}}
            if "push" in switches:
                legacy[cat] = bool(switches["push"])
        pref.channels = merged
        pref.push_categories = legacy
    if email_digest is not None:
        if email_digest not in DIGESTS:
            raise HTTPException(status_code=400, detail="email_digest must be off, daily or weekly")
        pref.email_digest = email_digest
    pref.update_date = now_iso()
    db.add(pref)
    await db.commit()
    await db.refresh(pref)
    return preferences_view(pref)


def wants_channel(pref: Optional[NotificationPreference], category: str, channel: str) -> bool:
    if pref is None:
        return default_channels(category).get(channel, True)
    return channels_view(pref).get(category, default_channels(category)).get(channel, True)


def wants_push(pref: Optional[NotificationPreference], category: str) -> bool:
    if pref is not None and not pref.push_enabled:
        return False
    return wants_channel(pref, category, "push")


def is_admin_category(category: str) -> bool:
    return category in ADMIN_CATEGORIES
