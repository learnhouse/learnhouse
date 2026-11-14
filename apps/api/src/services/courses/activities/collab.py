"""Collaborative editing of activity pages (the collab server's API side).

While an activity page is edited collaboratively, the collab server is its
only content writer: editors' browsers sync through it and never save
content themselves, so their saves can't clash. The server saves through
``put_collab_state`` (internal key), guarded by the version its room is
based on; a write that happened outside the room in the meantime (legacy
save, AI tools, version restore) makes the save fail with 409 and the room
re-syncs from the API instead of overwriting it.

Version history is coalesced: a collab save adds a history entry at most
every ``SNAPSHOT_INTERVAL`` per activity, or when the set of people editing
changes; other saves only update the content. Editors can also save a named
version ("checkpoint").
"""

import base64
import binascii
import hashlib
import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Literal, Optional

from fastapi import HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm.attributes import flag_modified
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.courses.activities import Activity, ActivitySubTypeEnum, ActivityTypeEnum
from src.db.courses.activity_collab import ActivityCollabState
from src.db.courses.activity_versions import ActivityVersion
from src.db.courses.courses import Course
from src.db.resource_authors import ResourceAuthor, ResourceAuthorshipStatusEnum
from src.db.users import AnonymousUser, PublicUser, User
from src.security.org_auth import is_org_member
from src.security.auth import resolve_acting_user_id
from src.security.features_utils.usage import check_feature_access
from src.security.rbac import AccessAction, check_resource_access
from src.services.ai.rag.queue import index_activity
from src.services.courses.activities.versioning import cleanup_old_versions
from src.services.webhooks.dispatch import dispatch_webhooks

logger = logging.getLogger(__name__)

# A collab save adds a version-history entry at most this often per activity
SNAPSHOT_INTERVAL = timedelta(minutes=5)
# Same cap as the collab server's
MAX_YDOC_BYTES = 5 * 1024 * 1024
MAX_CONTRIBUTORS = 100

# Caret and avatar colors, picked per user so everyone sees the same one
PRESENCE_COLORS = (
    "#2563eb", "#db2777", "#059669", "#d97706", "#7c3aed",
    "#0891b2", "#dc2626", "#65a30d", "#c026d3", "#4f46e5",
)


class CollabUser(BaseModel):
    id: int
    username: str
    display_name: str
    user_uuid: str
    avatar_image: Optional[str] = None
    avatar_url: Optional[str] = None
    color: str


class CollabAccessRead(BaseModel):
    role: Literal["editor", "viewer"]
    user: CollabUser


class CollabEditorRead(BaseModel):
    id: int
    name: str


class CollabStateRead(BaseModel):
    content: dict
    current_version: int
    ydoc_b64: Optional[str] = None
    ydoc_version: Optional[int] = None
    last_modified_by: Optional[CollabEditorRead] = None


class CollabCheckpoint(BaseModel):
    label: str = Field(default="", max_length=120)
    user_id: int


class CollabStateWrite(BaseModel):
    base_version: int
    ydoc_b64: str
    content: Optional[dict] = None
    contributor_user_ids: list[int] = Field(default_factory=list)
    checkpoint: Optional[CollabCheckpoint] = None


class NamedVersionWrite(BaseModel):
    label: str = Field(min_length=1, max_length=120)


class NamedVersionRead(BaseModel):
    version_number: int
    label: str


class CollabStateWriteResult(BaseModel):
    current_version: int
    version_number: Optional[int] = None


def collab_enabled() -> bool:
    """Collaboration needs the key the collab server saves with."""
    return bool(os.getenv("COLLAB_INTERNAL_KEY"))


def is_collab_activity(activity: Activity) -> bool:
    """Only page activities (the block editor) are edited collaboratively."""
    return (
        activity.activity_type == ActivityTypeEnum.TYPE_DYNAMIC
        and activity.activity_sub_type == ActivitySubTypeEnum.SUBTYPE_DYNAMIC_PAGE
    )


def presence_color(user_uuid: str) -> str:
    digest = hashlib.sha256(user_uuid.encode()).digest()
    return PRESENCE_COLORS[digest[0] % len(PRESENCE_COLORS)]


def display_name(user: User) -> str:
    full = f"{user.first_name or ''} {user.last_name or ''}".strip()
    return full or user.username


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


async def _activity_and_course(activity_uuid: str, db_session: AsyncSession) -> tuple[Activity, Course]:
    row = (await db_session.execute(
        select(Activity, Course)
        .join(Course, Activity.course_id == Course.id)
        .where(Activity.activity_uuid == activity_uuid)
    )).first()
    if not row:
        raise HTTPException(status_code=404, detail="Activity not found")
    return row[0], row[1]


async def _is_course_reviewer(course: Course, user_id: int, db_session: AsyncSession) -> bool:
    """An active author of the course (a reviewer, say) who may not edit it."""
    author = (await db_session.execute(
        select(ResourceAuthor.id).where(
            ResourceAuthor.resource_uuid == course.course_uuid,
            ResourceAuthor.user_id == user_id,
            ResourceAuthor.authorship_status == ResourceAuthorshipStatusEnum.ACTIVE,
        )
    )).first()
    return author is not None and await is_org_member(user_id, course.org_id, db_session)


async def recently_snapshotted_by(activity_id: int, user_id: Optional[int], db_session: AsyncSession) -> bool:
    """True when the activity's latest history entry is an unnamed one taken
    for this user less than SNAPSHOT_INTERVAL ago (saves of the autosaving
    editor then share it)."""
    if not user_id:
        return False
    latest = (await db_session.execute(
        select(ActivityVersion)
        .where(ActivityVersion.activity_id == activity_id)
        .order_by(ActivityVersion.version_number.desc())
        .limit(1)
    )).scalars().first()
    return bool(
        latest
        and latest.created_by_id == user_id
        and not latest.label
        and latest.created_at is not None
        and _utcnow() - latest.created_at < SNAPSHOT_INTERVAL
    )


async def get_collab_access(
    request: Request,
    activity_uuid: str,
    current_user: PublicUser | AnonymousUser,
    db_session: AsyncSession,
    locale: Optional[str] = None,
) -> CollabAccessRead:
    """Who the user is in the collab room and whether they may edit.

    Editors are users who may update the activity (same check as saving it);
    active course authors without that right join read-only. Everyone else,
    learners and anonymous visitors included, is refused.
    """
    if not collab_enabled():
        raise HTTPException(status_code=503, detail="Collaborative editing is not configured")
    # Sessions only: API tokens and anonymous visitors never join a room
    if not isinstance(current_user, PublicUser) or not current_user.id:
        raise HTTPException(status_code=401, detail="Authentication required")

    activity, course = await _activity_and_course(activity_uuid, db_session)
    if not is_collab_activity(activity):
        raise HTTPException(status_code=404, detail="Collaborative editing is not available for this activity")
    if locale is not None:
        # A language version's room (`activity:{uuid}:{locale}`): the
        # language must be added to the course.
        from src.services.courses.translations.service import require_language, require_locale

        await require_language(db_session, course, require_locale(locale))

    # Turned off for the org or this activity: no room, manual saving
    from src.services.courses.activities.collab_settings import live_editing_enabled
    if not await live_editing_enabled(activity, db_session):
        raise HTTPException(status_code=403, detail="collab_disabled")

    role: Literal["editor", "viewer"] = "editor"
    try:
        await check_resource_access(request, db_session, current_user, course.course_uuid, AccessAction.UPDATE)
    except HTTPException as exc:
        if exc.status_code not in (401, 403) or not await _is_course_reviewer(course, current_user.id, db_session):
            raise HTTPException(status_code=403, detail="Not allowed to edit this activity") from exc
        role = "viewer"

    from src.security.impersonation import SUPPORT_LABEL, current_impersonation

    impersonation = current_impersonation()
    if impersonation is not None and impersonation.read_only:
        # A read-only impersonation's socket never writes.
        role = "viewer"

    user = await db_session.get(User, current_user.id)
    if not user:
        raise HTTPException(status_code=401, detail="Authentication required")
    avatar = user.avatar_image or None
    shown_name = display_name(user)
    if impersonation is not None:
        # Other people in the room see who is really there.
        shown_name = f"{shown_name} ({SUPPORT_LABEL})"
    return CollabAccessRead(
        role=role,
        user=CollabUser(
            id=user.id,
            username=user.username,
            display_name=shown_name,
            user_uuid=user.user_uuid,
            avatar_image=avatar,
            avatar_url=avatar if avatar and avatar.startswith(("http://", "https://")) else None,
            color=presence_color(user.user_uuid),
        ),
    )


async def get_collab_state(activity_uuid: str, db_session: AsyncSession) -> CollabStateRead:
    """Content, version and stored ydoc for the collab server (internal key)."""
    activity, _ = await _activity_and_course(activity_uuid, db_session)
    if not is_collab_activity(activity):
        raise HTTPException(status_code=404, detail="Collaborative editing is not available for this activity")
    state = await db_session.get(ActivityCollabState, activity.id)
    editor = await db_session.get(User, activity.last_modified_by_id) if activity.last_modified_by_id else None
    return CollabStateRead(
        content=activity.content or {},
        current_version=activity.current_version or 1,
        ydoc_b64=base64.b64encode(state.ydoc_state).decode() if state and state.ydoc_state else None,
        ydoc_version=state.ydoc_version if state and state.ydoc_state else None,
        last_modified_by=CollabEditorRead(id=editor.id, name=display_name(editor)) if editor else None,
    )


def _decode_ydoc(ydoc_b64: str) -> bytes:
    try:
        ydoc = base64.b64decode(ydoc_b64, validate=True)
    except (binascii.Error, ValueError):
        raise HTTPException(status_code=422, detail="ydoc_b64 is not valid base64")
    if len(ydoc) > MAX_YDOC_BYTES:
        raise HTTPException(status_code=413, detail="Document is too large")
    return ydoc


async def _existing_user_ids(ids: list[int], db_session: AsyncSession) -> list[int]:
    wanted = sorted({i for i in ids if isinstance(i, int) and i > 0})[:MAX_CONTRIBUTORS]
    if not wanted:
        return []
    rows = (await db_session.execute(select(User.id).where(User.id.in_(wanted)))).scalars().all()
    return sorted(rows)


async def _has_version(activity_id: int, version_number: int, db_session: AsyncSession) -> bool:
    row = (await db_session.execute(
        select(ActivityVersion.id).where(
            ActivityVersion.activity_id == activity_id,
            ActivityVersion.version_number == version_number,
        )
    )).first()
    return row is not None


async def put_collab_state(
    activity_uuid: str,
    body: CollabStateWrite,
    db_session: AsyncSession,
) -> CollabStateWriteResult:
    """Saves the collab server's state of an activity (internal key).

    Without ``content`` only the ydoc is stored (a fresh room, or a room
    rewritten after an outside write) and the version doesn't move. With it,
    the content is saved, the version bumped and the version history updated.
    Refused with 409 when the activity moved past ``base_version``.
    """
    activity = (await db_session.execute(
        select(Activity).where(Activity.activity_uuid == activity_uuid).with_for_update()
    )).scalars().first()
    if not activity:
        raise HTTPException(status_code=404, detail="Activity not found")
    if not is_collab_activity(activity):
        raise HTTPException(status_code=404, detail="Collaborative editing is not available for this activity")
    if body.base_version != (activity.current_version or 1):
        raise HTTPException(status_code=409, detail="Activity changed since this room loaded it")

    ydoc = _decode_ydoc(body.ydoc_b64)
    if body.content is not None and body.content.get("type") != "doc":
        raise HTTPException(status_code=422, detail="content must be a ProseMirror document")

    now = _utcnow()
    state = await db_session.get(ActivityCollabState, activity.id)
    if state is None:
        state = ActivityCollabState(activity_id=activity.id, org_id=activity.org_id)

    new_versions: list[ActivityVersion] = []
    checkpoint_version: Optional[int] = None
    if body.content is not None:
        contributors = await _existing_user_ids(body.contributor_user_ids, db_session)
        checkpoint_user = (
            (await _existing_user_ids([body.checkpoint.user_id], db_session) or [None])[0]
            if body.checkpoint
            else None
        )
        acting_user = checkpoint_user or (contributors[0] if contributors else activity.last_modified_by_id)

        # History entry for the content this save replaces, coalesced: at most
        # every SNAPSHOT_INTERVAL, or when someone new starts editing
        previous = set(state.last_snapshot_contributors or [])
        interval_elapsed = state.last_snapshot_at is None or now - state.last_snapshot_at >= SNAPSHOT_INTERVAL
        due = interval_elapsed or bool(set(contributors) - previous)
        version_number = activity.current_version or 1
        if due and activity.content and not await _has_version(activity.id, version_number, db_session):
            new_versions.append(ActivityVersion(
                activity_id=activity.id,
                org_id=activity.org_id,
                version_number=version_number,
                content=activity.content,
                created_by_id=acting_user,
                created_at=now,
            ))
        if due:
            state.last_snapshot_at = now
        # Everyone who edited since the interval started; a new interval
        # starts with this save's editors
        state.last_snapshot_contributors = (
            contributors if interval_elapsed else sorted(previous | set(contributors))
        )

        activity.content = body.content
        flag_modified(activity, "content")
        activity.current_version = version_number + 1
        activity.update_date = str(datetime.now())
        if acting_user:
            activity.last_modified_by_id = acting_user

        if body.checkpoint:
            # A named version of the content as saved now
            checkpoint_version = activity.current_version
            new_versions.append(ActivityVersion(
                activity_id=activity.id,
                org_id=activity.org_id,
                version_number=checkpoint_version,
                content=body.content,
                created_by_id=checkpoint_user,
                created_at=now,
                label=body.checkpoint.label.strip()[:120] or None,
            ))
            state.last_snapshot_at = now

    activity_id, org_id = activity.id, activity.org_id
    current_version = activity.current_version or 1
    created = [(v.version_number, v.created_by_id) for v in new_versions]
    state.ydoc_state = ydoc
    state.ydoc_version = current_version
    state.updated_at = now
    db_session.add(state)
    db_session.add(activity)
    for version in new_versions:
        db_session.add(version)
    await db_session.commit()

    if body.content is not None:
        index_activity(activity_id)
    if created:
        await cleanup_old_versions(activity_id, db_session)
        for version_number, created_by_id in created:
            await dispatch_webhooks(
                event_name="activity_version_created",
                org_id=org_id,
                data={
                    "activity_id": activity_id,
                    "version_number": version_number,
                    "created_by_id": created_by_id,
                },
            )

    return CollabStateWriteResult(current_version=current_version, version_number=checkpoint_version)


async def name_current_version(
    request: Request,
    activity_uuid: str,
    body: NamedVersionWrite,
    current_user: PublicUser | AnonymousUser,
    db_session: AsyncSession,
) -> NamedVersionRead:
    """Names the activity's current content as a version ("Name this
    version…" in the editor when it isn't collaborative; collaborative rooms
    save a named version through the collab server instead). Names the
    existing history entry of the current version when there is one."""
    activity, course = await _activity_and_course(activity_uuid, db_session)
    await check_feature_access("versioning", activity.org_id, db_session)
    await check_resource_access(request, db_session, current_user, course.course_uuid, AccessAction.UPDATE)
    label = body.label.strip()[:120]
    if not label:
        raise HTTPException(status_code=422, detail="label must not be blank")
    version_number = activity.current_version or 1
    version = (await db_session.execute(
        select(ActivityVersion).where(
            ActivityVersion.activity_id == activity.id,
            ActivityVersion.version_number == version_number,
        )
    )).scalars().first()
    created = version is None
    if created:
        version = ActivityVersion(
            activity_id=activity.id,
            org_id=activity.org_id,
            version_number=version_number,
            content=activity.content or {},
            created_by_id=resolve_acting_user_id(current_user) or None,
            created_at=_utcnow(),
        )
    version.label = label
    activity_id, org_id = activity.id, activity.org_id
    db_session.add(version)
    await db_session.commit()
    if created:
        await cleanup_old_versions(activity_id, db_session)
        await dispatch_webhooks(
            event_name="activity_version_created",
            org_id=org_id,
            data={"activity_id": activity_id, "version_number": version_number, "created_by_id": version.created_by_id},
        )
    return NamedVersionRead(version_number=version_number, label=label)


# ── Autosave (editor outside live editing) ──────────────────────────────────


class AutosaveWrite(BaseModel):
    content: dict
    base_version: int


class AutosaveResult(BaseModel):
    current_version: int
    update_date: str


async def autosave_content(
    request: Request,
    activity_uuid: str,
    body: AutosaveWrite,
    current_user: PublicUser | AnonymousUser,
    db_session: AsyncSession,
) -> AutosaveResult:
    """Saves a page's content from the autosaving editor. The version check
    happens here, atomically (409 when the page moved past ``base_version``,
    so the editor shows its conflict prompt instead of overwriting), and
    the history keeps one entry per person per SNAPSHOT_INTERVAL instead of
    one per save."""
    from src.services.courses.activities.collab_notify import notify_collab_content_changed

    row = (await db_session.execute(
        select(Activity, Course)
        .join(Course, Activity.course_id == Course.id)
        .where(Activity.activity_uuid == activity_uuid)
        .with_for_update(of=Activity)
    )).first()
    if not row:
        raise HTTPException(status_code=404, detail="Activity not found")
    activity, course = row
    await check_resource_access(request, db_session, current_user, course.course_uuid, AccessAction.UPDATE)
    if not is_collab_activity(activity):
        raise HTTPException(status_code=404, detail="Autosave is not available for this activity")
    if body.content.get("type") != "doc":
        raise HTTPException(status_code=422, detail="content must be a ProseMirror document")
    current = activity.current_version or 1
    if body.base_version != current:
        editor = await db_session.get(User, activity.last_modified_by_id) if activity.last_modified_by_id else None
        raise HTTPException(
            status_code=409,
            detail={
                "code": "version_conflict",
                "current_version": current,
                "last_modified_by": display_name(editor) if editor else None,
                "update_date": activity.update_date,
            },
        )

    user_id = resolve_acting_user_id(current_user) or None
    snapshot = None
    if activity.content and not await recently_snapshotted_by(activity.id, user_id, db_session):
        snapshot = ActivityVersion(
            activity_id=activity.id,
            org_id=activity.org_id,
            version_number=current,
            content=activity.content,
            created_by_id=user_id,
            created_at=_utcnow(),
        )
        db_session.add(snapshot)
    activity.content = body.content
    flag_modified(activity, "content")
    activity.current_version = current + 1
    activity.update_date = str(datetime.now())
    activity.last_modified_by_id = user_id
    db_session.add(activity)
    await db_session.commit()
    await db_session.refresh(activity)

    index_activity(activity.id)
    notify_collab_content_changed(activity, current_user)
    if snapshot is not None:
        await cleanup_old_versions(activity.id, db_session)
        await dispatch_webhooks(
            event_name="activity_version_created",
            org_id=activity.org_id,
            data={"activity_id": activity.id, "version_number": current, "created_by_id": user_id},
        )
    return AutosaveResult(current_version=activity.current_version, update_date=activity.update_date)


# ── Language versions (rooms `activity:{uuid}:{locale}`) ────────────────────
#
# Same protocol as the default room, on the activity's translation in one
# language: `current_version` is the translation's own version, the ydoc is
# stored next to it, and there is no version history (checkpoints ignored).


async def get_translation_collab_state(activity_uuid: str, locale: str, db_session: AsyncSession) -> CollabStateRead:
    from src.services.courses.translations.service import translation_collab_state

    activity, _ = await _activity_and_course(activity_uuid, db_session)
    if not is_collab_activity(activity):
        raise HTTPException(status_code=404, detail="Collaborative editing is not available for this activity")
    t, state = await translation_collab_state(db_session, activity, locale)
    editor = await db_session.get(User, t.updated_by_id) if t.updated_by_id else None
    return CollabStateRead(
        content=t.content or {"type": "doc", "content": []},
        current_version=t.version or 1,
        ydoc_b64=base64.b64encode(state.ydoc_state).decode() if state and state.ydoc_state else None,
        ydoc_version=state.ydoc_version if state and state.ydoc_state else None,
        last_modified_by=CollabEditorRead(id=editor.id, name=display_name(editor)) if editor else None,
    )


async def put_translation_collab_state(
    activity_uuid: str, locale: str, body: CollabStateWrite, db_session: AsyncSession
) -> CollabStateWriteResult:
    from src.db.courses.translations import ActivityTranslation, ActivityTranslationCollabState
    activity, course = await _activity_and_course(activity_uuid, db_session)
    if not is_collab_activity(activity):
        raise HTTPException(status_code=404, detail="Collaborative editing is not available for this activity")
    t = (await db_session.execute(
        select(ActivityTranslation)
        .where(ActivityTranslation.activity_id == activity.id, ActivityTranslation.locale == locale)
        .with_for_update()
    )).scalars().first()
    if t is None:
        raise HTTPException(status_code=404, detail="This page has no translation in this language")
    if body.base_version != (t.version or 1):
        raise HTTPException(status_code=409, detail="Translation changed since this room loaded it")
    ydoc = _decode_ydoc(body.ydoc_b64)
    if body.content is not None and body.content.get("type") != "doc":
        raise HTTPException(status_code=422, detail="content must be a ProseMirror document")
    now = _utcnow()
    state = await db_session.get(ActivityTranslationCollabState, t.id)
    if state is None:
        state = ActivityTranslationCollabState(translation_id=t.id, org_id=t.org_id)
    if body.content is not None:
        contributors = await _existing_user_ids(body.contributor_user_ids, db_session)
        t.content = body.content
        flag_modified(t, "content")
        t.version = (t.version or 1) + 1
        t.updated_at = now
        if contributors:
            t.updated_by_id = contributors[0]
        t.translated_by = "user"
    current_version = t.version or 1
    state.ydoc_state = ydoc
    state.ydoc_version = current_version
    state.updated_at = now
    activity_id = activity.id
    db_session.add(state)
    db_session.add(t)
    await db_session.commit()
    if body.content is not None:
        index_activity(activity_id)
        try:
            from src.services.courses.cache import invalidate_course_meta_cache

            invalidate_course_meta_cache(course.course_uuid)
        except Exception:  # pragma: no cover - best effort
            pass
    return CollabStateWriteResult(current_version=current_version, version_number=None)


async def autosave_translation(
    request: Request,
    activity_uuid: str,
    locale: str,
    body: AutosaveWrite,
    current_user: PublicUser | AnonymousUser,
    db_session: AsyncSession,
) -> AutosaveResult:
    """Autosave of a language version (live editing unavailable)."""
    from src.services.courses.translations.service import (
        _activity_for_editor,
        write_activity_translation,
    )

    activity, course, code = await _activity_for_editor(request, db_session, current_user, activity_uuid, locale)
    if not is_collab_activity(activity):
        raise HTTPException(status_code=404, detail="Autosave is not available for this activity")
    t = await write_activity_translation(
        db_session, activity, course, code, content=body.content, base_version=body.base_version,
        user_id=resolve_acting_user_id(current_user) or None, mark_current=False,
    )
    return AutosaveResult(current_version=t.version or 1, update_date=str(t.updated_at))
