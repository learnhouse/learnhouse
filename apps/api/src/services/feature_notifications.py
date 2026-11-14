"""Inbox notifications raised by OSS features (assignments, paths,
communities, editor comments, user groups, org members, plan usage, AI
credits).

Each function is called by the feature that owns the event, after it has
committed its own work. They build the English ``title``/``body`` (mobile and
push) and the ``params`` the web uses for its translated headline, then hand
off to :func:`src.services.notifications.emit.emit` / ``emit_admin``. None of
them raise: a broken notification never fails the feature.
"""

from __future__ import annotations

import functools
import logging
from datetime import datetime, timezone
from typing import Iterable, Optional

from sqlalchemy import func
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.services.notifications.events import _name, activity_path

logger = logging.getLogger(__name__)

SNIPPET = 180
USERS_PATH = "/dash/users/settings/users"
PLAN_PATH = "/dash/org/settings/plan"


def _never_raise(fn):
    @functools.wraps(fn)
    async def wrapper(*args, **kwargs):
        try:
            return await fn(*args, **kwargs)
        except Exception:
            logger.warning("Notification hook %s failed", fn.__name__, exc_info=True)
            return []
    return wrapper


def _today() -> str:
    # ISO date, the same stamp the EE hourly plan signals use, so an
    # "AI credits low" raised by both lands once a day.
    return datetime.now(timezone.utc).date().isoformat()


async def _user(db: AsyncSession, user_id: Optional[int]):
    from src.db.users import User

    return await db.get(User, user_id) if user_id else None


# ---------------------------------------------------------------------------
# Assignments
# ---------------------------------------------------------------------------


@_never_raise
async def notify_submission_to_grade(db: AsyncSession, *, assignment, course, activity, learner_id: int):
    """A learner handed in an assignment that now waits for a teacher. One row
    per learner and assignment: a resubmission replaces the older row (read or
    not). The title names the learner; the detail line says where."""
    from src.db.courses.chapter_activities import ChapterActivity
    from src.db.courses.chapters import Chapter
    from src.services.notifications.emit import emit_admin

    learner = await _user(db, learner_id)
    actor = _name(learner)
    activity_id = getattr(activity, "id", None)
    chapter = (await db.execute(
        select(Chapter).join(ChapterActivity, ChapterActivity.chapter_id == Chapter.id)  # type: ignore[arg-type]
        .where(ChapterActivity.activity_id == activity_id)
    )).scalars().first() if activity_id else None
    where = f"{course.name} › {chapter.name}" if chapter is not None and chapter.name else course.name
    return await emit_admin(
        db, "submission_to_grade",
        org_id=course.org_id,
        course_uuid=course.course_uuid,
        title=f"New submission: {assignment.title}",
        body=where,
        params={"actor": actor, "assignment": assignment.title, "course": course.name},
        path=f"/dash/assignments/{assignment.assignment_uuid.removeprefix('assignment_')}?subpage=submissions",
        data={
            "course_uuid": course.course_uuid,
            "assignment_uuid": assignment.assignment_uuid,
            "activity_uuid": activity.activity_uuid,
        },
        image=course.thumbnail_image or None,
        actor_id=learner_id,
        group_key=f"submit:{assignment.id}:{learner_id}",
        replace_read=True,
    )


# ---------------------------------------------------------------------------
# Learning paths
# ---------------------------------------------------------------------------


@_never_raise
async def notify_path_completed(db: AsyncSession, path, user_id: int):
    from src.services.notifications.emit import emit

    return await emit(
        db, "path_completed", [user_id],
        org_id=path.org_id,
        title="You completed a path",
        body=path.name,
        params={"path": path.name},
        path=f"/path/{path.path_uuid.removeprefix('path_')}",
        data={"path_uuid": path.path_uuid},
        dedupe_key=f"path_completed:{path.id}",
    )


# ---------------------------------------------------------------------------
# Mentions
# ---------------------------------------------------------------------------


async def mentioned_org_members(db: AsyncSession, org_id: int, text: str) -> list[int]:
    """Members of the org named by an ``@username`` in ``text``."""
    from src.db.user_organizations import UserOrganization
    from src.db.users import User
    from src.services.courses.activities.comments import body_handles

    handles = body_handles(text)
    if not handles:
        return []
    rows = (await db.execute(
        select(User.id)
        .join(UserOrganization, UserOrganization.user_id == User.id)  # type: ignore[arg-type]
        .where(UserOrganization.org_id == org_id, func.lower(User.username).in_(handles))
    )).scalars().all()
    return sorted(set(rows))


# ---------------------------------------------------------------------------
# Communities
# ---------------------------------------------------------------------------


def discussion_path(community, discussion) -> str:
    return (
        f"/community/{community.community_uuid.removeprefix('community_')}"
        f"/discussion/{discussion.discussion_uuid.removeprefix('discussion_')}"
    )


async def community_readers(db: AsyncSession, community, user_ids: list[int]) -> list[int]:
    """The subset of ``user_ids`` who can see ``community`` (its listing's own
    visibility rule, plus org admins and maintainers): a mention never shows a
    restricted discussion's title to someone outside it."""
    if not user_ids:
        return []
    from src.db.user_organizations import UserOrganization
    from src.security.rbac.constants import ADMIN_OR_MAINTAINER_ROLE_IDS
    from src.services.communities.communities import accessible_community_ids_select

    staff = set((await db.execute(
        select(UserOrganization.user_id).where(
            UserOrganization.org_id == community.org_id,
            UserOrganization.user_id.in_(user_ids),  # type: ignore[attr-defined]
            UserOrganization.role_id.in_(ADMIN_OR_MAINTAINER_ROLE_IDS),  # type: ignore[attr-defined]
        )
    )).scalars().all())
    out = []
    for uid in user_ids:
        if uid in staff:
            out.append(uid)
            continue
        stmt = accessible_community_ids_select(community.org_id, uid)
        visible = (await db.execute(stmt.where(stmt.selected_columns[0] == community.id))).scalars().first()
        if visible is not None:
            out.append(uid)
    return out


def _discussion_data(community, discussion) -> dict:
    return {"community_uuid": community.community_uuid, "discussion_uuid": discussion.discussion_uuid}


@_never_raise
async def notify_discussion_posted(db: AsyncSession, *, community, discussion, author_id: int):
    """@mentions in a new discussion."""
    from src.services.notifications.emit import emit

    mentioned = await community_readers(
        db, community, await mentioned_org_members(db, discussion.org_id, f"{discussion.title}\n{discussion.content or ''}")
    )
    if not mentioned:
        return []
    actor = _name(await _user(db, author_id))
    return await emit(
        db, "discussion_mention", mentioned,
        org_id=discussion.org_id,
        title=f"{actor} mentioned you in {discussion.title}",
        body=(discussion.content or "")[:SNIPPET],
        params={"actor": actor, "discussion": discussion.title},
        path=discussion_path(community, discussion),
        data=_discussion_data(community, discussion),
        actor_id=author_id,
        dedupe_key=f"discussion_mention:{discussion.id}",
    )


@_never_raise
async def notify_discussion_comment(db: AsyncSession, *, community, discussion, comment, author_id: int):
    """A comment on a discussion: the discussion's author hears about the
    reply, anyone @mentioned hears about the mention (one row each, the
    mention wins). Comments are flat, so there is no parent comment author."""
    from src.services.notifications.emit import emit

    actor = _name(await _user(db, author_id))
    body = (comment.content or "")[:SNIPPET]
    params = {"actor": actor, "discussion": discussion.title}
    common = {
        "org_id": discussion.org_id,
        "body": body,
        "params": params,
        "path": discussion_path(community, discussion),
        "data": {**_discussion_data(community, discussion), "comment_uuid": comment.comment_uuid},
        "actor_id": author_id,
    }
    mentioned = await community_readers(db, community, await mentioned_org_members(db, discussion.org_id, comment.content or ""))
    rows = await emit(
        db, "discussion_mention", mentioned,
        title=f"{actor} mentioned you in {discussion.title}",
        dedupe_key=f"discussion_mention:c{comment.id}",
        **common,
    )
    rows += await emit(
        db, "discussion_reply", [discussion.author_id],
        title=f"{actor} replied to {discussion.title}",
        group_key=f"discussion:{discussion.id}",
        exclude=mentioned,
        **common,
    )
    return rows


# ---------------------------------------------------------------------------
# Editor comments on activities
# ---------------------------------------------------------------------------


async def _thread_participants(db: AsyncSession, thread) -> set[int]:
    from src.db.courses.activity_comments import ActivityComment

    authors = (await db.execute(
        select(ActivityComment.author_id).where(
            ActivityComment.thread_id == thread.id,
            ActivityComment.deleted == False,  # noqa: E712
        )
    )).scalars().all()
    return {a for a in authors if a} | ({thread.created_by} if thread.created_by else set())


@_never_raise
async def notify_editor_comment(
    db: AsyncSession,
    *,
    course,
    activity,
    thread,
    author_id: int,
    body: str,
    mention_ids: Iterable[int],
    new_thread: bool = False,
    mentions_only: bool = False,
):
    """Editor comment threads: people mentioned get ``editor_mention``; the
    rest of the thread (or, for a new thread, the course's authors) get
    ``editor_comment``, collapsed per thread."""
    from src.services.notifications.emit import course_author_ids, emit

    actor = _name(await _user(db, author_id))
    mentioned = sorted(set(mention_ids))
    common = {
        "org_id": course.org_id,
        "body": body[:SNIPPET],
        "params": {"actor": actor, "activity": activity.name},
        "path": f"{activity_path(course.course_uuid, activity.activity_uuid)}/edit?thread={thread.thread_uuid}",
        "data": {
            "course_uuid": course.course_uuid,
            "activity_uuid": activity.activity_uuid,
            "thread_uuid": thread.thread_uuid,
        },
        "actor_id": author_id,
    }
    rows = await emit(db, "editor_mention", mentioned, title=f"{actor} mentioned you on {activity.name}", **common)
    if mentions_only:
        return rows
    if new_thread:
        targets = await course_author_ids(db, course.course_uuid)
    else:
        targets = await _thread_participants(db, thread)
    rows += await emit(
        db, "editor_comment", targets,
        title=f"{actor} commented on {activity.name}",
        group_key=f"thread:{thread.id}",
        exclude=mentioned,
        **common,
    )
    return rows


# ---------------------------------------------------------------------------
# User groups
# ---------------------------------------------------------------------------


@_never_raise
async def warn_group_access_expiring(db: AsyncSession, now: Optional[datetime] = None, lead_days: int = 3) -> int:
    """Members whose group membership ends within ``lead_days`` get one
    warning per membership (and per end date, so an extended membership warns
    again). Safe on every sync tick."""
    from datetime import timedelta

    from src.db.usergroup_user import UserGroupUser
    from src.db.usergroups import UserGroup
    from src.services.notifications.emit import emit
    from src.services.usergroups.common import aware

    now = now or datetime.now(timezone.utc)
    rows = (await db.execute(
        select(UserGroupUser, UserGroup)
        .join(UserGroup, UserGroup.id == UserGroupUser.usergroup_id)  # type: ignore[arg-type]
        .where(
            UserGroupUser.expires_at.is_not(None),  # type: ignore[union-attr]
            UserGroupUser.expires_at > now,  # type: ignore[operator]
            UserGroupUser.expires_at <= now + timedelta(days=lead_days),  # type: ignore[operator]
        )
    )).all()
    written = 0
    for membership, group in rows:
        ends = aware(membership.expires_at)
        created = await emit(
            db, "group_access_expiring", [membership.user_id],
            org_id=group.org_id,
            title=group.name,
            body=f"Your access ends on {ends:%Y-%m-%d}",
            params={"group": group.name},
            path=f"/groups/{group.usergroup_uuid.removeprefix('usergroup_')}",
            data={"usergroup_uuid": group.usergroup_uuid, "expires_at": ends.isoformat()},
            priority="important",
            dedupe_key=f"group_access_expiring:{membership.id}:{ends:%Y%m%d%H%M}",
        )
        written += len(created)
    return written


# ---------------------------------------------------------------------------
# Org members
# ---------------------------------------------------------------------------


@_never_raise
async def notify_member_joined(db: AsyncSession, org_id: int, user):
    """Admins hear about new members; a run of joins collapses into one row."""
    from src.services.notifications.emit import emit_admin

    actor = _name(user)
    return await emit_admin(
        db, "member_joined",
        org_id=org_id,
        title="New member",
        body=f"{actor} joined your organization",
        params={"actor": actor},
        path=USERS_PATH,
        data={"user_uuid": user.user_uuid},
        actor_id=user.id,
        group_key=f"member_joined:{org_id}",
    )


# ---------------------------------------------------------------------------
# Plan usage and AI credits
# ---------------------------------------------------------------------------


@_never_raise
async def notify_plan_limit_near(db: AsyncSession, org_id: int, feature: str, used: int, limit: int):
    from src.services.notifications.emit import emit_admin

    return await emit_admin(
        db, "plan_limit_near",
        org_id=org_id,
        title=f"You're close to your {feature} limit",
        body=f"{used} of {limit} {feature} used on your plan",
        params={"limit": feature},
        path=PLAN_PATH,
        data={"feature": feature, "used": used, "max": limit},
        dedupe_key=f"plan_limit_near:{org_id}:{feature}:{_today()}",
    )


@_never_raise
async def notify_ai_credits_low(db: AsyncSession, org_id: int, remaining: int, total: int):
    from src.services.notifications.emit import emit_admin

    return await emit_admin(
        db, "ai_credits_low",
        org_id=org_id,
        title="AI credits are running low",
        body=f"{max(remaining, 0)} of {total} credits left",
        params={"remaining": max(remaining, 0)},
        path=PLAN_PATH,
        data={"remaining": max(remaining, 0), "total": total},
        dedupe_key=f"ai_credits_low:{org_id}:{_today()}",
    )
