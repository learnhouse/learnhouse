"""Notifications for course contributions. Never raise.

- A new suggestion or piece of feedback reaches whoever the org routes
  ``suggestion_submitted`` / ``feedback_submitted`` to (by default the
  course's authors), in the dashboard bell.
- The contributor hears back in their personal inbox when a suggestion is
  accepted, rejected or sent back, and when the team answers their feedback.
"""

from __future__ import annotations

import logging

from sqlmodel.ext.asyncio.session import AsyncSession

from src.services.notifications.events import _name, _never_raise, activity_path, _short

logger = logging.getLogger(__name__)

SNIPPET = 180


async def _user(db: AsyncSession, user_id):
    from src.db.users import User

    return await db.get(User, user_id) if user_id else None


def _dash_path(course_uuid: str) -> str:
    return f"/dash/courses/course/{_short(course_uuid, 'course_')}/contributions"


@_never_raise
async def suggestion_submitted(db: AsyncSession, *, course, activity, suggestion, author):
    from src.services.notifications.emit import emit_admin

    actor = _name(author)
    return await emit_admin(
        db, "suggestion_submitted",
        org_id=course.org_id,
        course_uuid=course.course_uuid,
        title=f"{actor} suggested an edit to {activity.name}",
        body=(suggestion.note or suggestion.summary or "")[:SNIPPET],
        params={"actor": actor, "activity": activity.name, "course": course.name},
        path=f"{_dash_path(course.course_uuid)}?suggestion={suggestion.suggestion_uuid}",
        data={
            "course_uuid": course.course_uuid,
            "activity_uuid": activity.activity_uuid,
            "suggestion_uuid": suggestion.suggestion_uuid,
        },
        actor_id=author.id,
        group_key=f"suggestions:{course.id}",
    )


@_never_raise
async def suggestion_decided(db: AsyncSession, *, course, activity, suggestion, reviewer_id):
    from src.services.notifications.emit import emit

    type_ = {
        "accepted": "suggestion_accepted",
        "rejected": "suggestion_rejected",
        "changes_requested": "suggestion_changes_requested",
    }.get(suggestion.status)
    if type_ is None or not suggestion.author_id or suggestion.author_id == reviewer_id:
        return []
    reviewer = await _user(db, reviewer_id)
    actor = _name(reviewer)
    verb = {
        "suggestion_accepted": "accepted your edit to",
        "suggestion_rejected": "declined your edit to",
        "suggestion_changes_requested": "asked for changes to your edit to",
    }[type_]
    path = activity_path(course.course_uuid, activity.activity_uuid)
    if type_ != "suggestion_accepted":
        path = f"{path}?contribution={suggestion.suggestion_uuid}"
    return await emit(
        db, type_, [suggestion.author_id],
        org_id=course.org_id,
        title=f"{actor or 'The course team'} {verb} {activity.name}",
        body=(suggestion.review_note or suggestion.summary or "")[:SNIPPET],
        params={"actor": actor, "activity": activity.name, "course": course.name},
        path=path,
        data={
            "course_uuid": course.course_uuid,
            "activity_uuid": activity.activity_uuid,
            "suggestion_uuid": suggestion.suggestion_uuid,
        },
        actor_id=reviewer_id,
    )


@_never_raise
async def feedback_submitted(db: AsyncSession, *, course, activity, thread, author, body: str):
    from src.services.notifications.emit import emit_admin

    actor = _name(author)
    return await emit_admin(
        db, "feedback_submitted",
        org_id=course.org_id,
        course_uuid=course.course_uuid,
        title=f"{actor} left feedback on {activity.name}",
        body=body[:SNIPPET],
        params={"actor": actor, "activity": activity.name, "course": course.name, "type": thread.feedback_type},
        path=f"{_dash_path(course.course_uuid)}?tab=feedback&feedback={thread.thread_uuid}",
        data={
            "course_uuid": course.course_uuid,
            "activity_uuid": activity.activity_uuid,
            "thread_uuid": thread.thread_uuid,
        },
        actor_id=author.id,
        group_key=f"feedback:{course.id}",
    )


@_never_raise
async def feedback_replied(db: AsyncSession, *, course, activity, thread, author, body: str, from_team: bool):
    """The team answered: tell the learner. The learner answered: tell the
    team members who replied in the thread (or, if none yet, the routing)."""
    from src.db.courses.activity_comments import ActivityComment
    from sqlmodel import select

    from src.services.notifications.emit import emit, emit_admin

    actor = _name(author)
    params = {"actor": actor, "activity": activity.name, "course": course.name}
    data = {
        "course_uuid": course.course_uuid,
        "activity_uuid": activity.activity_uuid,
        "thread_uuid": thread.thread_uuid,
    }
    if from_team:
        return await emit(
            db, "feedback_reply", [thread.created_by],
            org_id=course.org_id,
            title=f"{actor} replied to your feedback on {activity.name}",
            body=body[:SNIPPET],
            params=params,
            path=f"{activity_path(course.course_uuid, activity.activity_uuid)}?feedback={thread.thread_uuid}",
            data=data,
            actor_id=author.id,
            group_key=f"feedback:{thread.id}",
        )
    team = set((await db.execute(
        select(ActivityComment.author_id).where(
            ActivityComment.thread_id == thread.id, ActivityComment.author_id != thread.created_by
        )
    )).scalars().all())
    common = dict(
        org_id=course.org_id,
        title=f"{actor} replied about their feedback on {activity.name}",
        body=body[:SNIPPET],
        params=params,
        path=f"{_dash_path(course.course_uuid)}?tab=feedback&feedback={thread.thread_uuid}",
        data=data,
        actor_id=author.id,
        group_key=f"feedback:{course.id}",
    )
    if team:
        return await emit(db, "feedback_submitted", team, audience="admin", **common)
    return await emit_admin(db, "feedback_submitted", course_uuid=course.course_uuid, **common)
