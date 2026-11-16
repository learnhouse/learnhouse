"""Turn things that happen into inbox rows.

Each function here is called by the feature that owns the event, after that
feature has committed its own work. They load what they need, build one
:class:`NotificationInput` per recipient and call :func:`notify`. None of them
raise: a broken notification must never fail a message send or a grade.

Paths in ``data["path"]`` are relative to the org's site and match the web
routes, so the web bell can link them as-is; the mobile app maps the same
uuids to its own screens.
"""

from __future__ import annotations

import functools
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.services.notifications.notifications import NotificationInput, notify

logger = logging.getLogger(__name__)

SNIPPET = 180


def _never_raise(fn):
    @functools.wraps(fn)
    async def wrapper(*args, **kwargs):
        try:
            return await fn(*args, **kwargs)
        except Exception:
            logger.warning("Notification hook %s failed", fn.__name__, exc_info=True)
            return []
    return wrapper


def _short(uuid: str, prefix: str) -> str:
    return uuid.removeprefix(prefix)


def course_path(course_uuid: str) -> str:
    return f"/course/{_short(course_uuid, 'course_')}"


def activity_path(course_uuid: str, activity_uuid: str) -> str:
    return f"{course_path(course_uuid)}/activity/{_short(activity_uuid, 'activity_')}"


def _name(user) -> str:
    if user is None:
        return ""
    return f"{user.first_name or ''} {user.last_name or ''}".strip() or user.username


# ---------------------------------------------------------------------------
# Messages
# ---------------------------------------------------------------------------


def message_targets(conv, msg, members: list, users: dict, reply_author_id: Optional[int]) -> list[int]:
    """Who gets an inbox row for this message.

    Close to the "direct" email rule: DMs, agent chats, broadcasts, replies to
    you and @mentions. Plain group chatter only shows as unread in Messages.
    """
    if msg.kind == "reminder":
        target = (msg.attachment or {}).get("for_user_id")
        return [m.user_id for m in members if m.user_id == target and not m.muted]
    out = []
    content = (msg.content or "").lower()
    for m in members:
        if m.muted or (msg.sender_user_id and m.user_id == msg.sender_user_id):
            continue
        if conv.kind in ("dm", "agent", "broadcast"):
            out.append(m.user_id)
            continue
        if reply_author_id == m.user_id:
            out.append(m.user_id)
            continue
        user = users.get(m.user_id)
        if user is None:
            continue
        handles = {f"@{user.username}".lower()}
        if user.first_name:
            handles.add(f"@{user.first_name}".lower())
        if any(h in content for h in handles):
            out.append(m.user_id)
    return out


@_never_raise
async def notify_new_message(db: AsyncSession, conversation_id: int, message_id: int):
    from src.db.messaging import Agent, Conversation, ConversationMember, Message
    from src.db.users import User
    from src.services.messaging import realtime

    conv = await db.get(Conversation, conversation_id)
    msg = await db.get(Message, message_id)
    if conv is None or msg is None or msg.deleted_at is not None or msg.kind == "system":
        return []
    members = (await db.execute(
        select(ConversationMember).where(ConversationMember.conversation_id == conv.id)
    )).scalars().all()
    reply_author_id = None
    if msg.reply_to_id:
        reply_author_id = (await db.execute(
            select(Message.sender_user_id).where(Message.id == msg.reply_to_id)
        )).scalars().first()
    ids = {m.user_id for m in members} | ({msg.sender_user_id} if msg.sender_user_id else set())
    users = {u.id: u for u in (await db.execute(select(User).where(User.id.in_(ids)))).scalars().all()}  # type: ignore[union-attr]
    targets = message_targets(conv, msg, members, users, reply_author_id)
    if not targets:
        return []

    sender = users.get(msg.sender_user_id) if msg.sender_user_id else None
    agent_id = msg.sender_agent_id or conv.agent_id
    agent = await db.get(Agent, agent_id) if agent_id else None
    author = agent.name if msg.sender_agent_id and agent else _name(sender)
    if conv.kind == "dm":
        title = author or "New message"
    elif conv.kind == "agent":
        title = (agent.name if agent else "") or "Assistant"
    elif conv.kind == "broadcast":
        title = conv.title or "Announcement"
    else:
        title = f"{author} in {conv.title}" if author and conv.title else (conv.title or author or "New message")
    if msg.kind == "reminder":
        title = "Reminder"
    body = msg.content or ""
    if not body and msg.attachment and msg.attachment.get("course"):
        body = f"Shared a course: {msg.attachment['course'].get('name', '')}"
    if conv.kind == "broadcast" and author and msg.kind != "reminder":
        body = f"{author}: {body}"
    image = None
    if conv.kind == "dm" and sender is not None:
        image = sender.avatar_image or None
    elif agent is not None:
        image = agent.emoji

    return await notify(db, [
        NotificationInput(
            user_id=uid,
            org_id=conv.org_id,
            type="message",
            title=title,
            body=body[:SNIPPET],
            data={
                "conversation_uuid": conv.conversation_uuid,
                "message_uuid": msg.message_uuid,
                "conversation_kind": conv.kind,
                "path": f"/messages?c={conv.conversation_uuid}",
            },
            image=image,
            group_key=f"conv:{conv.id}",
            actor_id=msg.sender_user_id,
            # Someone with a tab open sees it there; don't buzz their phone too.
            push=not realtime.is_online(conv.org_id, uid),
        )
        for uid in targets
    ])


@_never_raise
async def clear_conversation(db: AsyncSession, user_id: int, conversation_id: int):
    from src.services.notifications.notifications import mark_group_read

    await mark_group_read(db, user_id, f"conv:{conversation_id}")
    return []


# ---------------------------------------------------------------------------
# Assignments
# ---------------------------------------------------------------------------


def _excerpt(text, limit: int = 140):
    text = " ".join(str(text or "").split())
    if not text:
        return None
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


def _grade_display(computed: dict):
    display = computed.get("display_grade")
    if display in (None, ""):
        pct = computed.get("percentage")
        display = f"{round(pct)}%" if isinstance(pct, (int, float)) else None
    return display


def grade_text(computed: dict) -> str:
    display = computed.get("display_grade")
    if display in (None, ""):
        pct = computed.get("percentage")
        display = f"{round(pct)}%" if isinstance(pct, (int, float)) else None
    parts = [f"Grade: {display}" if display else "Your grade is ready"]
    if computed.get("passed") is True:
        parts.append("Passed")
    elif computed.get("passed") is False:
        parts.append("Not passed")
    return " · ".join(parts)


@_never_raise
async def notify_assignment_graded(db: AsyncSession, user_id: int, assignment_id: int, computed: dict, grader_id: Optional[int] = None):
    from src.db.courses.activities import Activity
    from src.db.courses.assignments import Assignment
    from src.db.courses.courses import Course

    assignment = await db.get(Assignment, assignment_id)
    if assignment is None:
        return []
    course = await db.get(Course, assignment.course_id)
    activity = await db.get(Activity, assignment.activity_id)
    if course is None or activity is None:
        return []
    return await notify(db, [NotificationInput(
        user_id=user_id,
        org_id=course.org_id,
        type="assignment_graded",
        title=f"Graded: {assignment.title}",
        body=grade_text(computed) + (f" · {_excerpt(computed.get('overall_feedback'), 120)}" if computed.get("overall_feedback") else ""),
        actor_id=grader_id,
        data={
            "course_uuid": course.course_uuid,
            "assignment_uuid": assignment.assignment_uuid,
            "activity_uuid": activity.activity_uuid,
            "passed": computed.get("passed"),
            "path": activity_path(course.course_uuid, activity.activity_uuid),
            "params": {
                "assignment": assignment.title,
                "course": course.name,
                "grade": _grade_display(computed),
                "passed": computed.get("passed"),
                "feedback": _excerpt(computed.get("overall_feedback")),
            },
        },
        image=course.thumbnail_image or None,
    )])


def _due_instant(raw: Optional[str]) -> Optional[datetime]:
    from src.services.calendar.sources.assignments import parse_due_date

    value, all_day = parse_due_date(raw)
    if value is None:
        return None
    if all_day:
        # An all-day deadline runs to the end of that day (UTC).
        return datetime(value.year, value.month, value.day, tzinfo=timezone.utc) + timedelta(days=1)
    return value  # type: ignore[return-value]


async def run_assignment_due_reminders(db: AsyncSession, now: Optional[datetime] = None, lead: timedelta = timedelta(hours=24)) -> int:
    """One reminder per learner, about a day before a deadline they haven't
    handed in for. Deduped per assignment, so it is safe on every tick."""
    from src.db.courses.activities import Activity
    from src.db.courses.assignments import Assignment, AssignmentUserSubmission, AssignmentUserSubmissionStatus
    from src.db.courses.courses import Course
    from src.db.trail_runs import TrailRun

    now = now or datetime.now(timezone.utc)
    rows = (await db.execute(
        select(Assignment, Activity, Course)
        .join(Activity, Activity.id == Assignment.activity_id)  # type: ignore[arg-type]
        .join(Course, Course.id == Assignment.course_id)  # type: ignore[arg-type]
        .where(
            Assignment.published == True,  # noqa: E712
            Activity.published == True,  # noqa: E712
            Assignment.due_date.is_not(None),  # type: ignore[union-attr]
            Assignment.due_date != "",
        )
    )).all()
    written = 0
    for assignment, activity, course in rows:
        due = _due_instant(assignment.due_date)
        if due is None or not (now < due <= now + lead):
            continue
        learners = set((await db.execute(
            select(TrailRun.user_id).where(TrailRun.course_id == course.id)
        )).scalars().all())
        done = set((await db.execute(
            select(AssignmentUserSubmission.user_id).where(
                AssignmentUserSubmission.assignment_id == assignment.id,
                AssignmentUserSubmission.submission_status.in_([  # type: ignore[attr-defined]
                    AssignmentUserSubmissionStatus.SUBMITTED,
                    AssignmentUserSubmissionStatus.GRADED,
                    AssignmentUserSubmissionStatus.LATE,
                ]),
            )
        )).scalars().all())
        targets = learners - done
        if not targets:
            continue
        hours = max(1, round((due - now).total_seconds() / 3600))
        created = await notify(db, [
            NotificationInput(
                user_id=uid,
                org_id=course.org_id,
                type="assignment_due",
                title=f"Due soon: {assignment.title}",
                body=f"{course.name} · due in {hours} h",
                data={
                    "course_uuid": course.course_uuid,
                    "assignment_uuid": assignment.assignment_uuid,
                    "activity_uuid": activity.activity_uuid,
                    "due_date": assignment.due_date,
                    "path": activity_path(course.course_uuid, activity.activity_uuid),
                    "params": {"assignment": assignment.title, "course": course.name, "hours": hours, "due_at": due.isoformat()},
                },
                image=course.thumbnail_image or None,
                dedupe_key=f"assignment_due:{assignment.id}:{assignment.due_date}",
            )
            for uid in targets
        ])
        written += len(created)
    return written


# ---------------------------------------------------------------------------
# Courses: drip releases, updates, certificates
# ---------------------------------------------------------------------------


@_never_raise
async def notify_chapters_unlocked(db: AsyncSession, user_id: int, course, chapter_ids: list[int], chapter_names: list[str]):
    names = [n for n in chapter_names if n]
    if len(names) == 1:
        body = f"{names[0]} is now open"
    else:
        body = f"{len(names)} new chapters are open: {', '.join(names[:3])}" + ("…" if len(names) > 3 else "")
    return await notify(db, [NotificationInput(
        user_id=user_id,
        org_id=course.org_id,
        type="chapter_unlocked",
        title=course.name,
        body=body,
        data={"course_uuid": course.course_uuid, "chapter_ids": chapter_ids, "path": course_path(course.course_uuid),
              "params": {"course": course.name, "count": len(chapter_ids), "chapter": names[0] if names else None}},
        image=course.thumbnail_image or None,
        dedupe_key=f"chapter_unlocked:{course.id}:{','.join(str(c) for c in sorted(chapter_ids))}",
    )])


@_never_raise
async def notify_course_update(db: AsyncSession, course_id: int, update_id: int, author_id: Optional[int] = None):
    from src.db.courses.course_updates import CourseUpdate
    from src.db.courses.courses import Course
    from src.db.trail_runs import TrailRun

    course = await db.get(Course, course_id)
    update = await db.get(CourseUpdate, update_id)
    if course is None or update is None:
        return []
    learners = set((await db.execute(
        select(TrailRun.user_id).where(TrailRun.course_id == course.id)
    )).scalars().all())
    learners.discard(author_id)
    if not learners:
        return []
    return await notify(db, [
        NotificationInput(
            user_id=uid,
            org_id=course.org_id,
            type="course_update",
            title=f"{course.name}: {update.title}",
            body=update.content or "",
            data={
                "course_uuid": course.course_uuid,
                "courseupdate_uuid": update.courseupdate_uuid,
                "path": course_path(course.course_uuid),
                "params": {"course": course.name, "update": update.title},
            },
            image=course.thumbnail_image or None,
            dedupe_key=f"course_update:{update.id}",
            actor_id=author_id,
        )
        for uid in learners
    ])


@_never_raise
async def notify_certificate(db: AsyncSession, user_id: int, course, user_certification_uuid: str):
    return await notify(db, [NotificationInput(
        user_id=user_id,
        org_id=course.org_id,
        type="certificate",
        title="You earned a certificate",
        body=course.name,
        data={
            "course_uuid": course.course_uuid,
            "user_certification_uuid": user_certification_uuid,
            "path": f"/certificates/{user_certification_uuid}/verify",
            "params": {"course": course.name},
        },
        image=course.thumbnail_image or None,
        dedupe_key=f"certificate:{user_certification_uuid}",
    )])


# ---------------------------------------------------------------------------
# Live sessions (EE calls this; the inbox itself is core)
# ---------------------------------------------------------------------------

LIVE_COPY = {
    "24h": ("Tomorrow: {title}", "{when}"),
    "15m": ("Starting in 15 minutes: {title}", "Get ready, it's about to start."),
    "live": ("Live now: {title}", "The host just started. Tap to join."),
}


@_never_raise
async def notify_live_session(
    db: AsyncSession,
    *,
    user_ids: list[int],
    org_id: int,
    session_id: int,
    session_uuid: str,
    title: str,
    kind: str,
    path: str,
    when: str = "",
    course_uuid: Optional[str] = None,
    expires_at: Optional[str] = None,
    starts_at: Optional[str] = None,
    host_id: Optional[int] = None,
):
    head, body = LIVE_COPY.get(kind, LIVE_COPY["live"])
    return await notify(db, [
        NotificationInput(
            user_id=uid,
            org_id=org_id,
            type="live_session",
            title=head.format(title=title),
            body=body.format(when=when) if body else "",
            data={
                "live_session_uuid": session_uuid,
                "kind": kind,
                "course_uuid": course_uuid,
                "path": path,
                "params": {"title": title, "starts_at": starts_at},
            },
            actor_id=host_id,
            # One row per session: "starting soon" turns into "live now".
            group_key=f"live:{session_id}",
            expires_at=expires_at,
            dedupe_key=f"live:{session_id}:{kind}",
        )
        for uid in user_ids
    ])
