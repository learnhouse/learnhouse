"""Editor comment threads on activity content.

Who: anyone who may edit the activity (course UPDATE) reads, writes, replies,
resolves and reopens. Authors edit and delete their own comments; org admins
and maintainers may delete anyone's. Learners, anonymous visitors and API
tokens are refused: comments are a conversation between the people building
the course, and none of it is ever served on a learner path.

Where the thread sits in the text is the editor's business (the ``comment``
mark, see ``comment_marks.py``); this module stores the conversation.
"""

from __future__ import annotations

import logging
import re
from datetime import datetime, timezone
from typing import Iterable, Optional
from uuid import uuid4

from fastapi import BackgroundTasks, HTTPException, Request
from sqlalchemy import func, or_
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.courses.activities import Activity
from src.db.courses.activity_comments import (
    QUOTE_MAX,
    ActivityComment,
    ActivityCommentThread,
    CommentAuthor,
    CommentCreate,
    CommentRead,
    CommentUpdate,
    ThreadCreate,
    ThreadList,
    ThreadRead,
    ThreadStatusUpdate,
)
from src.db.courses.courses import Course
from src.db.resource_authors import (
    ResourceAuthor,
    ResourceAuthorshipEnum,
    ResourceAuthorshipStatusEnum,
)
from src.db.roles import Role
from src.db.user_organizations import UserOrganization
from src.db.users import AnonymousUser, PublicUser, User
from src.security.rbac import AccessAction, check_resource_access
from src.security.rbac.constants import ADMIN_OR_MAINTAINER_ROLE_IDS
from src.services.courses.locks import is_org_admin

logger = logging.getLogger(__name__)

# Writes per user per minute, across all activities. Generous for a person
# typing replies, low enough that a script can't flood a thread or an inbox.
WRITE_LIMIT = 30
WRITE_WINDOW_SECONDS = 60
MENTIONABLE_LIMIT = 20


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _check_write_rate(user_id: int) -> None:
    """Fail open when Redis is unreachable: comments are not worth an outage."""
    from src.services.security.rate_limiting import check_rate_limit

    try:
        allowed, _count, retry_after = check_rate_limit(
            key=f"activity_comments:{user_id}",
            max_attempts=WRITE_LIMIT,
            window_seconds=WRITE_WINDOW_SECONDS,
        )
    except Exception:
        logger.warning("Comment rate limit unavailable", exc_info=True)
        return
    if not allowed:
        raise HTTPException(
            status_code=429,
            detail="Too many comments, try again shortly",
            headers={"Retry-After": str(retry_after)},
        )


def _require_person(current_user) -> PublicUser:
    if isinstance(current_user, AnonymousUser) or not isinstance(current_user, PublicUser):
        # API tokens included: a comment is said by a person.
        raise HTTPException(status_code=401, detail="Sign in to use comments")
    return current_user


async def _load_activity(
    request: Request, activity_uuid: str, current_user, db_session: AsyncSession
) -> tuple[Activity, Course, PublicUser]:
    user = _require_person(current_user)
    row = (await db_session.execute(
        select(Activity, Course)
        .join(Course, Course.id == Activity.course_id)  # type: ignore[arg-type]
        .where(Activity.activity_uuid == activity_uuid)
    )).first()
    if not row:
        raise HTTPException(status_code=404, detail="Activity not found")
    activity, course = row
    # Editing the activity is what lets you see and write its comments; the
    # check is org-scoped, so another org's editor is refused here too.
    await check_resource_access(request, db_session, user, course.course_uuid, AccessAction.UPDATE)
    return activity, course, user


async def _load_thread(
    activity: Activity, thread_uuid: str, db_session: AsyncSession
) -> ActivityCommentThread:
    thread = (await db_session.execute(
        select(ActivityCommentThread).where(
            ActivityCommentThread.thread_uuid == thread_uuid,
            ActivityCommentThread.activity_id == activity.id,
        )
    )).scalars().first()
    if not thread:
        raise HTTPException(status_code=404, detail="Thread not found")
    return thread


async def _load_comment(
    thread: ActivityCommentThread, comment_uuid: str, db_session: AsyncSession
) -> ActivityComment:
    comment = (await db_session.execute(
        select(ActivityComment).where(
            ActivityComment.comment_uuid == comment_uuid,
            ActivityComment.thread_id == thread.id,
        )
    )).scalars().first()
    if not comment or comment.deleted:
        raise HTTPException(status_code=404, detail="Comment not found")
    return comment


def _clean_body(body: str) -> str:
    text = body.replace("\r\n", "\n").strip()
    if not text:
        raise HTTPException(status_code=400, detail="A comment cannot be empty")
    return text


def _author(user: Optional[User]) -> Optional[CommentAuthor]:
    if user is None:
        return None
    return CommentAuthor(
        id=user.id or 0,
        user_uuid=user.user_uuid,
        username=user.username,
        first_name=user.first_name or "",
        last_name=user.last_name or "",
        avatar_image=user.avatar_image or "",
    )


async def _users_by_id(ids: Iterable[Optional[int]], db_session: AsyncSession) -> dict[int, User]:
    wanted = {i for i in ids if i}
    if not wanted:
        return {}
    rows = (await db_session.execute(select(User).where(User.id.in_(wanted)))).scalars().all()  # type: ignore[union-attr]
    return {u.id: u for u in rows if u.id is not None}


def _comment_read(comment: ActivityComment, users: dict[int, User]) -> CommentRead:
    if comment.deleted:
        return CommentRead(
            comment_uuid=comment.comment_uuid,
            author=_author(users.get(comment.author_id or 0)),
            body="",
            mentions=[],
            created_at=comment.created_at,
            deleted=True,
        )
    return CommentRead(
        comment_uuid=comment.comment_uuid,
        author=_author(users.get(comment.author_id or 0)),
        body=comment.body,
        mentions=[m for m in (comment.mentions or []) if isinstance(m, int)],
        edited_at=comment.edited_at,
        created_at=comment.created_at,
    )


def _thread_read(
    thread: ActivityCommentThread, comments: list[ActivityComment], users: dict[int, User]
) -> ThreadRead:
    return ThreadRead(
        thread_uuid=thread.thread_uuid,
        quote=thread.quote,
        status="resolved" if thread.status == "resolved" else "open",
        created_by=_author(users.get(thread.created_by or 0)),
        resolved_by=_author(users.get(thread.resolved_by or 0)),
        resolved_at=thread.resolved_at,
        created_at=thread.created_at,
        updated_at=thread.updated_at,
        comments=[_comment_read(c, users) for c in comments],
    )


async def _read_threads(
    threads: list[ActivityCommentThread], db_session: AsyncSession
) -> list[ThreadRead]:
    if not threads:
        return []
    by_thread: dict[int, list[ActivityComment]] = {t.id: [] for t in threads if t.id is not None}
    comments = (await db_session.execute(
        select(ActivityComment)
        .where(ActivityComment.thread_id.in_(list(by_thread)))  # type: ignore[attr-defined]
        .order_by(ActivityComment.id)
    )).scalars().all()
    for c in comments:
        by_thread[c.thread_id].append(c)
    users = await _users_by_id(
        [t.created_by for t in threads]
        + [t.resolved_by for t in threads]
        + [c.author_id for c in comments],
        db_session,
    )
    out = []
    for t in threads:
        items = by_thread.get(t.id or 0, [])
        # A thread whose every comment was deleted is gone for everyone.
        if items and all(c.deleted for c in items):
            continue
        out.append(_thread_read(t, items, users))
    return out


# ─── mentions ────────────────────────────────────────────────────────────────


async def _editor_role_ids(org_id: int, db_session: AsyncSession) -> set[int]:
    """Roles held in this org that may edit any of its courses."""
    roles = (await db_session.execute(
        select(Role).where(or_(Role.org_id == org_id, Role.org_id.is_(None)))  # type: ignore[union-attr]
    )).scalars().all()
    ids = set(ADMIN_OR_MAINTAINER_ROLE_IDS)
    for role in roles:
        rights = role.rights if isinstance(role.rights, dict) else {}
        courses = rights.get("courses") if isinstance(rights.get("courses"), dict) else {}
        if courses.get("action_update") is True and role.id is not None:
            ids.add(role.id)
    return ids


async def _mentionable_query(course: Course, db_session: AsyncSession, q: str = ""):
    """People who can edit this course: org editors and the course's authors."""
    role_ids = await _editor_role_ids(course.org_id, db_session)
    authors = (
        select(ResourceAuthor.user_id).where(
            ResourceAuthor.resource_uuid == course.course_uuid,
            ResourceAuthor.authorship.in_([  # type: ignore[attr-defined]
                ResourceAuthorshipEnum.CREATOR,
                ResourceAuthorshipEnum.MAINTAINER,
                ResourceAuthorshipEnum.CONTRIBUTOR,
            ]),
            ResourceAuthor.authorship_status == ResourceAuthorshipStatusEnum.ACTIVE,
        )
    )
    stmt = (
        select(User)
        .join(UserOrganization, UserOrganization.user_id == User.id)  # type: ignore[arg-type]
        .where(UserOrganization.org_id == course.org_id)
        .where(or_(UserOrganization.role_id.in_(role_ids), User.id.in_(authors)))  # type: ignore[union-attr]
    )
    q = q.strip().lstrip("@")
    if q:
        like = f"%{q.lower()}%"
        stmt = stmt.where(or_(
            func.lower(User.username).like(like),
            func.lower(User.first_name).like(like),
            func.lower(User.last_name).like(like),
        ))
    return stmt


async def list_mentionable(
    request: Request, activity_uuid: str, q: str, current_user, db_session: AsyncSession
) -> list[CommentAuthor]:
    _activity, course, _user = await _load_activity(request, activity_uuid, current_user, db_session)
    stmt = await _mentionable_query(course, db_session, q[:100])
    users = (await db_session.execute(
        stmt.order_by(User.username).limit(MENTIONABLE_LIMIT)
    )).scalars().unique().all()
    return [a for a in (_author(u) for u in users) if a is not None]


# An @handle in a comment body; the trailing dot/dash of a sentence is not part of it.
_HANDLE_RE = re.compile(r"(?<![\w@])@([A-Za-z0-9][\w.-]{0,63})")


def body_handles(body: str) -> set[str]:
    return {m.group(1).rstrip(".-").lower() for m in _HANDLE_RE.finditer(body or "")}


async def _valid_mentions(
    course: Course, mentions: list[int], body: str, author_id: int, db_session: AsyncSession
) -> list[int]:
    """Who this comment mentions: the ids picked in the editor plus any
    ``@username`` typed by hand, kept only for people who may edit the course,
    never the author. Validated server side so mentions can't be used to email
    arbitrary users.
    """
    wanted = [m for m in mentions if isinstance(m, int)]
    handles = body_handles(body)
    if not wanted and not handles:
        return []
    stmt = await _mentionable_query(course, db_session)
    conditions = []
    if wanted:
        conditions.append(User.id.in_(wanted))  # type: ignore[union-attr]
    if handles:
        conditions.append(func.lower(User.username).in_(handles))
    rows = (await db_session.execute(
        stmt.where(or_(*conditions)).with_only_columns(User.id, User.username)
    )).all()
    by_id = {uid: name for uid, name in rows}
    order = wanted + sorted(uid for uid, name in rows if name.lower() in handles)
    return [uid for uid in dict.fromkeys(order) if uid in by_id and uid != author_id]


def _notify_mentions(
    background: Optional[BackgroundTasks],
    request: Request,
    *,
    course: Course,
    activity: Activity,
    thread: ActivityCommentThread,
    author: PublicUser,
    body: str,
    mention_ids: list[int],
) -> None:
    if not mention_ids or background is None:
        return
    from src.services.courses.activities.comments_email import send_mention_emails

    background.add_task(
        send_mention_emails,
        request,
        course_id=course.id,
        activity_id=activity.id,
        thread_uuid=thread.thread_uuid,
        quote=thread.quote,
        author_id=author.id,
        body=body,
        mention_ids=mention_ids,
    )


async def _notify_inbox(
    course: Course,
    activity: Activity,
    thread: ActivityCommentThread,
    author: PublicUser,
    body: str,
    mention_ids: list[int],
    db_session: AsyncSession,
    **kwargs,
) -> None:
    """Inbox rows for the comment (mentions, thread participants). Never raises."""
    from src.services.feature_notifications import notify_editor_comment

    await notify_editor_comment(
        db_session, course=course, activity=activity, thread=thread,
        author_id=author.id, body=body, mention_ids=mention_ids, **kwargs,
    )


# ─── endpoints ───────────────────────────────────────────────────────────────


def _thread_locale(locale: Optional[str]) -> Optional[str]:
    """Comments stay per language version; None is the default language."""
    if locale is None or locale == "":
        return None
    from src.services.courses.translations.locales import normalize_locale

    code = normalize_locale(locale)
    if not code:
        raise HTTPException(status_code=422, detail="Invalid locale")
    return code


async def list_threads(
    request: Request, activity_uuid: str, current_user, db_session: AsyncSession, locale: Optional[str] = None
) -> ThreadList:
    activity, course, user = await _load_activity(request, activity_uuid, current_user, db_session)
    code = _thread_locale(locale)
    threads = (await db_session.execute(
        select(ActivityCommentThread)
        .where(
            ActivityCommentThread.activity_id == activity.id,
            ActivityCommentThread.locale == code if code else ActivityCommentThread.locale.is_(None),  # type: ignore[union-attr]
        )
        .order_by(ActivityCommentThread.id)
    )).scalars().all()
    return ThreadList(
        threads=await _read_threads(list(threads), db_session),
        can_moderate=await is_org_admin(user.id, course.org_id, db_session),
        current_user_id=user.id,
    )


async def _thread_response(thread: ActivityCommentThread, db_session: AsyncSession) -> ThreadRead:
    comments = (await db_session.execute(
        select(ActivityComment).where(ActivityComment.thread_id == thread.id).order_by(ActivityComment.id)
    )).scalars().all()
    users = await _users_by_id(
        [thread.created_by, thread.resolved_by] + [c.author_id for c in comments], db_session
    )
    return _thread_read(thread, list(comments), users)


async def create_thread(
    request: Request,
    activity_uuid: str,
    payload: ThreadCreate,
    current_user,
    db_session: AsyncSession,
    background: Optional[BackgroundTasks] = None,
    locale: Optional[str] = None,
) -> ThreadRead:
    activity, course, user = await _load_activity(request, activity_uuid, current_user, db_session)
    code = _thread_locale(locale)
    _check_write_rate(user.id)
    body = _clean_body(payload.body)
    mentions = await _valid_mentions(course, payload.mentions, body, user.id, db_session)
    now = _now()
    thread = ActivityCommentThread(
        thread_uuid=f"thread_{uuid4()}",
        activity_id=activity.id,
        org_id=course.org_id,
        created_by=user.id,
        quote=" ".join(payload.quote.split())[:QUOTE_MAX],
        status="open",
        created_at=now,
        updated_at=now,
        locale=code,
    )
    db_session.add(thread)
    await db_session.flush()
    db_session.add(ActivityComment(
        comment_uuid=f"comment_{uuid4()}",
        thread_id=thread.id,
        author_id=user.id,
        body=body,
        mentions=mentions,
        created_at=now,
    ))
    await db_session.commit()
    await db_session.refresh(thread)
    _notify_mentions(
        background, request, course=course, activity=activity, thread=thread,
        author=user, body=body, mention_ids=mentions,
    )
    await _notify_inbox(course, activity, thread, user, body, mentions, db_session, new_thread=True)
    return await _thread_response(thread, db_session)


async def reply(
    request: Request,
    activity_uuid: str,
    thread_uuid: str,
    payload: CommentCreate,
    current_user,
    db_session: AsyncSession,
    background: Optional[BackgroundTasks] = None,
) -> ThreadRead:
    activity, course, user = await _load_activity(request, activity_uuid, current_user, db_session)
    thread = await _load_thread(activity, thread_uuid, db_session)
    _check_write_rate(user.id)
    body = _clean_body(payload.body)
    mentions = await _valid_mentions(course, payload.mentions, body, user.id, db_session)
    now = _now()
    db_session.add(ActivityComment(
        comment_uuid=f"comment_{uuid4()}",
        thread_id=thread.id,
        author_id=user.id,
        body=body,
        mentions=mentions,
        created_at=now,
    ))
    thread.updated_at = now
    db_session.add(thread)
    await db_session.commit()
    await db_session.refresh(thread)
    _notify_mentions(
        background, request, course=course, activity=activity, thread=thread,
        author=user, body=body, mention_ids=mentions,
    )
    await _notify_inbox(course, activity, thread, user, body, mentions, db_session)
    return await _thread_response(thread, db_session)


async def edit_comment(
    request: Request,
    activity_uuid: str,
    thread_uuid: str,
    comment_uuid: str,
    payload: CommentUpdate,
    current_user,
    db_session: AsyncSession,
    background: Optional[BackgroundTasks] = None,
) -> ThreadRead:
    activity, course, user = await _load_activity(request, activity_uuid, current_user, db_session)
    thread = await _load_thread(activity, thread_uuid, db_session)
    comment = await _load_comment(thread, comment_uuid, db_session)
    if comment.author_id != user.id:
        # Not even admins: putting words in someone's mouth is not moderation.
        raise HTTPException(status_code=403, detail="You can only edit your own comments")
    _check_write_rate(user.id)
    body = _clean_body(payload.body)
    mentions = await _valid_mentions(course, payload.mentions, body, user.id, db_session)
    # Only people newly named by this edit get an email.
    new_mentions = [m for m in mentions if m not in set(comment.mentions or [])]
    now = _now()
    comment.body = body
    comment.mentions = mentions
    comment.edited_at = now
    thread.updated_at = now
    db_session.add(comment)
    db_session.add(thread)
    await db_session.commit()
    await db_session.refresh(thread)
    _notify_mentions(
        background, request, course=course, activity=activity, thread=thread,
        author=user, body=body, mention_ids=new_mentions,
    )
    await _notify_inbox(course, activity, thread, user, body, new_mentions, db_session, mentions_only=True)
    return await _thread_response(thread, db_session)


async def delete_comment(
    request: Request,
    activity_uuid: str,
    thread_uuid: str,
    comment_uuid: str,
    current_user,
    db_session: AsyncSession,
) -> ThreadRead:
    activity, course, user = await _load_activity(request, activity_uuid, current_user, db_session)
    thread = await _load_thread(activity, thread_uuid, db_session)
    comment = await _load_comment(thread, comment_uuid, db_session)
    if comment.author_id != user.id and not await is_org_admin(user.id, course.org_id, db_session):
        raise HTTPException(status_code=403, detail="You can only delete your own comments")
    comment.deleted = True
    comment.body = ""
    comment.mentions = []
    thread.updated_at = _now()
    db_session.add(comment)
    db_session.add(thread)
    await db_session.commit()
    await db_session.refresh(thread)
    return await _thread_response(thread, db_session)


async def set_thread_status(
    request: Request,
    activity_uuid: str,
    thread_uuid: str,
    payload: ThreadStatusUpdate,
    current_user,
    db_session: AsyncSession,
) -> ThreadRead:
    activity, _course, user = await _load_activity(request, activity_uuid, current_user, db_session)
    thread = await _load_thread(activity, thread_uuid, db_session)
    now = _now()
    if payload.status == "resolved":
        if thread.status != "resolved":
            thread.status = "resolved"
            thread.resolved_by = user.id
            thread.resolved_at = now
    else:
        thread.status = "open"
        thread.resolved_by = None
        thread.resolved_at = None
    thread.updated_at = now
    db_session.add(thread)
    await db_session.commit()
    await db_session.refresh(thread)
    return await _thread_response(thread, db_session)
