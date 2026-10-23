"""
Org-scoped CRUD for Skyroom live classes, plus join-link generation.

Mirrors the webhook service conventions: module-level ``async def`` functions
that take ``(request, db_session, org_id, ..., current_user)``, enforce org
authorization, mutate through the session, and return Pydantic read schemas.

The remote Skyroom calls go through ``src.services.skyroom.client``. Skyroom
application errors (``SkyroomError``) and transport/network errors
(``SkyroomTransportError``) are translated into HTTP responses the frontend can
render, and a missing configuration (``SkyroomNotConfigured``) becomes a 503 so
the feature can be probed without crashing.
"""

import logging
from datetime import datetime
from typing import List, Optional
from uuid import uuid4

from fastapi import HTTPException, Request, status
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.organizations import Organization
from src.db.skyroom import (
    SkyroomJoinLinkRequest,
    SkyroomJoinLinkResponse,
    SkyroomLiveClass,
    SkyroomLiveClassCreate,
    SkyroomLiveClassRead,
    SkyroomLiveClassUpdate,
    SkyroomRemoteRoom,
    SkyroomRoomImportRequest,
)
from src.db.users import AnonymousUser, APITokenUser, PublicUser
from src.security.auth import resolve_acting_user_id
from src.security.org_auth import require_org_admin, require_org_role_permission
from src.security.rbac.rbac import authorization_verify_if_user_is_anon
from src.services.skyroom import client as skyroom_client
from src.services.skyroom.client import (
    SkyroomError,
    SkyroomNotConfigured,
    SkyroomTransportError,
)

logger = logging.getLogger(__name__)

# Cap concurrent rooms per org. Skyroom bills on a per-service basis and the
# docs discourage creating rooms indiscriminately, so a soft ceiling keeps a
# single org from exhausting its Skyroom service quota by accident.
MAX_LIVE_CLASSES_PER_ORG = 200


def _to_read(row: SkyroomLiveClass) -> SkyroomLiveClassRead:
    return SkyroomLiveClassRead(
        id=row.id,  # type: ignore[arg-type]
        liveclass_uuid=row.liveclass_uuid,
        org_id=row.org_id,
        course_id=row.course_id,
        activity_id=row.activity_id,
        skyroom_room_id=row.skyroom_room_id,
        room_name=row.room_name,
        title=row.title,
        room_url=row.room_url,
        guest_login=row.guest_login,
        op_login_first=row.op_login_first,
        max_users=row.max_users,
        is_active=row.is_active,
        created_by_user_id=row.created_by_user_id,
        creation_date=row.creation_date,
        update_date=row.update_date,
    )


def _translate_skyroom_error(exc: Exception) -> HTTPException:
    """Map a Skyroom client exception to an HTTPException for the API layer."""
    if isinstance(exc, SkyroomNotConfigured):
        return HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Skyroom integration is not configured for this instance.",
        )
    if isinstance(exc, SkyroomTransportError):
        return HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Could not reach the Skyroom service. Please try again later.",
        )
    if isinstance(exc, SkyroomError):
        # 15 = not found on Skyroom's side; everything else is a 400-class
        # problem with the request we sent.
        code = (
            status.HTTP_404_NOT_FOUND
            if exc.error_code == 15
            else status.HTTP_400_BAD_REQUEST
        )
        return HTTPException(status_code=code, detail=f"Skyroom: {exc.error_message}")
    return HTTPException(
        status_code=status.HTTP_502_BAD_GATEWAY,
        detail="Unexpected error talking to Skyroom.",
    )


async def _verify_org_exists(db_session: AsyncSession, org_id: int) -> None:
    statement = select(Organization).where(Organization.id == org_id)
    if not (await db_session.execute(statement)).scalars().first():
        raise HTTPException(status_code=404, detail="Organization not found")


async def _get_live_class_or_404(
    db_session: AsyncSession, org_id: int, liveclass_uuid: str
) -> SkyroomLiveClass:
    statement = select(SkyroomLiveClass).where(
        SkyroomLiveClass.org_id == org_id,
        SkyroomLiveClass.liveclass_uuid == liveclass_uuid,
    )
    row = (await db_session.execute(statement)).scalars().first()
    if not row:
        raise HTTPException(status_code=404, detail="Live class not found")
    return row


# ---------------------------------------------------------------------------
# CRUD
# ---------------------------------------------------------------------------


async def create_live_class(
    request: Request,
    db_session: AsyncSession,
    org_id: int,
    liveclass_object: SkyroomLiveClassCreate,
    current_user: PublicUser | AnonymousUser | APITokenUser,
) -> SkyroomLiveClassRead:
    acting_user_id = resolve_acting_user_id(current_user)
    await authorization_verify_if_user_is_anon(acting_user_id)
    await _verify_org_exists(db_session, org_id)
    await require_org_role_permission(
        acting_user_id, org_id, db_session, "organizations", "action_update"
    )

    # A room created against a shared demo org would stay live on the external
    # Skyroom account long after the demo is recycled; keep it out.
    from src.services.demo.guards import require_not_demo_org

    await require_not_demo_org(org_id, db_session)

    await _enforce_live_class_cap(db_session, org_id)

    # Create the remote room first; only persist the mapping once Skyroom has
    # handed us a room id, so we never store a dangling local row.
    try:
        room_id = await skyroom_client.create_room(
            name=liveclass_object.room_name,
            title=liveclass_object.title,
            guest_login=liveclass_object.guest_login,
            op_login_first=liveclass_object.op_login_first,
            max_users=liveclass_object.max_users,
        )
    except Exception as exc:  # noqa: BLE001 - translated to HTTPException
        raise _translate_skyroom_error(exc)

    # Best-effort fetch of the canonical room URL; non-fatal if it fails.
    room_url: Optional[str] = None
    try:
        room_url = await skyroom_client.get_room_url(room_id)
    except Exception as exc:  # noqa: BLE001
        logger.info("Could not fetch Skyroom room url for %s: %s", room_id, exc)

    now = str(datetime.now())
    row = SkyroomLiveClass(
        liveclass_uuid=f"liveclass_{uuid4()}",
        org_id=org_id,
        course_id=liveclass_object.course_id,
        activity_id=liveclass_object.activity_id,
        skyroom_room_id=room_id,
        room_name=liveclass_object.room_name,
        title=liveclass_object.title,
        room_url=room_url,
        guest_login=liveclass_object.guest_login,
        op_login_first=liveclass_object.op_login_first,
        max_users=liveclass_object.max_users,
        is_active=True,
        created_by_user_id=acting_user_id,
        creation_date=now,
        update_date=now,
    )
    db_session.add(row)
    await db_session.commit()
    await db_session.refresh(row)
    return _to_read(row)


async def _enforce_live_class_cap(db_session: AsyncSession, org_id: int) -> None:
    from sqlalchemy import func

    existing = (
        await db_session.execute(
            select(func.count())
            .select_from(SkyroomLiveClass)
            .where(SkyroomLiveClass.org_id == org_id)
        )
    ).scalar() or 0
    if existing >= MAX_LIVE_CLASSES_PER_ORG:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"An organization can have at most {MAX_LIVE_CLASSES_PER_ORG} "
                "Skyroom live classes. Delete one before adding another."
            ),
        )


async def list_live_classes(
    request: Request,
    db_session: AsyncSession,
    org_id: int,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    course_id: Optional[int] = None,
) -> List[SkyroomLiveClassRead]:
    acting_user_id = resolve_acting_user_id(current_user)
    await authorization_verify_if_user_is_anon(acting_user_id)
    await require_org_admin(acting_user_id, org_id, db_session)

    statement = select(SkyroomLiveClass).where(SkyroomLiveClass.org_id == org_id)
    if course_id is not None:
        statement = statement.where(SkyroomLiveClass.course_id == course_id)
    rows = (await db_session.execute(statement)).scalars().all()
    return [_to_read(r) for r in rows]


async def get_live_class(
    request: Request,
    db_session: AsyncSession,
    org_id: int,
    liveclass_uuid: str,
    current_user: PublicUser | AnonymousUser | APITokenUser,
) -> SkyroomLiveClassRead:
    acting_user_id = resolve_acting_user_id(current_user)
    await authorization_verify_if_user_is_anon(acting_user_id)
    await require_org_admin(acting_user_id, org_id, db_session)

    row = await _get_live_class_or_404(db_session, org_id, liveclass_uuid)
    return _to_read(row)


async def update_live_class(
    request: Request,
    db_session: AsyncSession,
    org_id: int,
    liveclass_uuid: str,
    liveclass_object: SkyroomLiveClassUpdate,
    current_user: PublicUser | AnonymousUser | APITokenUser,
) -> SkyroomLiveClassRead:
    acting_user_id = resolve_acting_user_id(current_user)
    await authorization_verify_if_user_is_anon(acting_user_id)
    await require_org_role_permission(
        acting_user_id, org_id, db_session, "organizations", "action_update"
    )

    row = await _get_live_class_or_404(db_session, org_id, liveclass_uuid)

    # Collect the fields that map onto the remote room so we can push them to
    # Skyroom in a single updateRoom call.
    remote_fields: dict = {}
    if liveclass_object.title is not None:
        row.title = liveclass_object.title
        remote_fields["title"] = liveclass_object.title
    if liveclass_object.guest_login is not None:
        row.guest_login = liveclass_object.guest_login
        remote_fields["guest_login"] = liveclass_object.guest_login
    if liveclass_object.op_login_first is not None:
        row.op_login_first = liveclass_object.op_login_first
        remote_fields["op_login_first"] = liveclass_object.op_login_first
    if liveclass_object.max_users is not None:
        row.max_users = liveclass_object.max_users
        remote_fields["max_users"] = liveclass_object.max_users
    if liveclass_object.is_active is not None:
        row.is_active = liveclass_object.is_active
        # Skyroom status: 0 = inactive, 1 = active.
        remote_fields["status"] = 1 if liveclass_object.is_active else 0

    if remote_fields:
        try:
            await skyroom_client.update_room(row.skyroom_room_id, **remote_fields)
        except Exception as exc:  # noqa: BLE001
            raise _translate_skyroom_error(exc)

    row.update_date = str(datetime.now())
    db_session.add(row)
    await db_session.commit()
    await db_session.refresh(row)
    return _to_read(row)


async def delete_live_class(
    request: Request,
    db_session: AsyncSession,
    org_id: int,
    liveclass_uuid: str,
    current_user: PublicUser | AnonymousUser | APITokenUser,
) -> dict:
    acting_user_id = resolve_acting_user_id(current_user)
    await authorization_verify_if_user_is_anon(acting_user_id)
    await require_org_role_permission(
        acting_user_id, org_id, db_session, "organizations", "action_update"
    )

    row = await _get_live_class_or_404(db_session, org_id, liveclass_uuid)

    # Remove the remote room first. A 15 (not found) means it is already gone on
    # Skyroom's side, so treat that as success and clean up the local mapping.
    try:
        await skyroom_client.delete_room(row.skyroom_room_id)
    except SkyroomError as exc:
        if exc.error_code != 15:
            raise _translate_skyroom_error(exc)
    except Exception as exc:  # noqa: BLE001
        raise _translate_skyroom_error(exc)

    await db_session.delete(row)
    await db_session.commit()
    return {"detail": "Live class deleted"}


async def list_remote_rooms(
    request: Request,
    db_session: AsyncSession,
    org_id: int,
    current_user: PublicUser | AnonymousUser | APITokenUser,
) -> List[SkyroomRemoteRoom]:
    """List the rooms that exist on the Skyroom account, each annotated with
    whether this org has already imported it.

    This lets an admin adopt rooms they created directly in the Skyroom panel
    instead of only rooms created through LearnHouse.
    """
    acting_user_id = resolve_acting_user_id(current_user)
    await authorization_verify_if_user_is_anon(acting_user_id)
    await _verify_org_exists(db_session, org_id)
    await require_org_admin(acting_user_id, org_id, db_session)

    try:
        rooms = await skyroom_client.get_rooms()
    except Exception as exc:  # noqa: BLE001 - translated to HTTPException
        raise _translate_skyroom_error(exc)

    # Map remote room_id -> local liveclass_uuid for rooms already imported by
    # THIS org, so the UI can disable re-importing.
    existing = (
        await db_session.execute(
            select(
                SkyroomLiveClass.skyroom_room_id,
                SkyroomLiveClass.liveclass_uuid,
            ).where(SkyroomLiveClass.org_id == org_id)
        )
    ).all()
    imported_by_room = {row[0]: row[1] for row in existing}

    out: List[SkyroomRemoteRoom] = []
    for room in rooms:
        if not isinstance(room, dict) or "id" not in room:
            continue
        room_id = int(room["id"])
        uuid = imported_by_room.get(room_id)
        out.append(
            SkyroomRemoteRoom(
                skyroom_room_id=room_id,
                name=str(room.get("name") or ""),
                title=str(room.get("title") or room.get("name") or ""),
                status=int(room.get("status", 0)),
                already_imported=uuid is not None,
                liveclass_uuid=uuid,
            )
        )
    return out


async def import_remote_room(
    request: Request,
    db_session: AsyncSession,
    org_id: int,
    skyroom_room_id: int,
    import_object: SkyroomRoomImportRequest,
    current_user: PublicUser | AnonymousUser | APITokenUser,
) -> SkyroomLiveClassRead:
    """Adopt a pre-existing Skyroom room as a local live class.

    Unlike ``create_live_class`` this does not create a remote room; it looks up
    the existing one (by id), verifies it really exists on Skyroom, and persists
    the mapping. Idempotent per org: re-importing a room returns the existing
    live class instead of creating a duplicate.
    """
    acting_user_id = resolve_acting_user_id(current_user)
    await authorization_verify_if_user_is_anon(acting_user_id)
    await _verify_org_exists(db_session, org_id)
    await require_org_role_permission(
        acting_user_id, org_id, db_session, "organizations", "action_update"
    )

    from src.services.demo.guards import require_not_demo_org

    await require_not_demo_org(org_id, db_session)

    # Idempotency: if this org already mapped the room, return that mapping.
    existing = (
        await db_session.execute(
            select(SkyroomLiveClass).where(
                SkyroomLiveClass.org_id == org_id,
                SkyroomLiveClass.skyroom_room_id == skyroom_room_id,
            )
        )
    ).scalars().first()
    if existing:
        return _to_read(existing)

    await _enforce_live_class_cap(db_session, org_id)

    # Verify the room exists on Skyroom and pull its canonical fields.
    try:
        room = await skyroom_client.get_room(skyroom_room_id)
    except Exception as exc:  # noqa: BLE001
        raise _translate_skyroom_error(exc)

    if not isinstance(room, dict) or "id" not in room:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="That room was not found on Skyroom.",
        )

    room_name = str(room.get("name") or f"room-{skyroom_room_id}")[:128]
    title = (import_object.title or str(room.get("title") or room_name))[:128]

    room_url: Optional[str] = None
    try:
        room_url = await skyroom_client.get_room_url(skyroom_room_id)
    except Exception as exc:  # noqa: BLE001
        logger.info(
            "Could not fetch Skyroom room url for %s: %s", skyroom_room_id, exc
        )

    now = str(datetime.now())
    row = SkyroomLiveClass(
        liveclass_uuid=f"liveclass_{uuid4()}",
        org_id=org_id,
        course_id=import_object.course_id,
        activity_id=import_object.activity_id,
        skyroom_room_id=skyroom_room_id,
        room_name=room_name,
        title=title,
        room_url=room_url,
        guest_login=bool(room.get("guest_login", False)),
        op_login_first=bool(room.get("op_login_first", True)),
        max_users=room.get("max_users"),
        # Reflect the remote room's active state (Skyroom status: 1 = active).
        is_active=int(room.get("status", 1)) == 1,
        created_by_user_id=acting_user_id,
        creation_date=now,
        update_date=now,
    )
    db_session.add(row)
    await db_session.commit()
    await db_session.refresh(row)
    return _to_read(row)


async def create_join_link(
    request: Request,
    db_session: AsyncSession,
    org_id: int,
    liveclass_uuid: str,
    join_object: SkyroomJoinLinkRequest,
    current_user: PublicUser | AnonymousUser | APITokenUser,
) -> SkyroomJoinLinkResponse:
    """Generate a direct, login-free join URL for a participant.

    Admin/maintainer gated: issuing an operator (access=3) link hands control of
    the room to the holder, so link creation is an admin action rather than a
    member self-service one.
    """
    acting_user_id = resolve_acting_user_id(current_user)
    await authorization_verify_if_user_is_anon(acting_user_id)
    await require_org_admin(acting_user_id, org_id, db_session)

    row = await _get_live_class_or_404(db_session, org_id, liveclass_uuid)

    if join_object.access not in (1, 2, 3):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="access must be 1 (user), 2 (presenter) or 3 (operator).",
        )

    # Default the opaque user_id to the acting user so the link is tied to one
    # identity (prevents unlimited concurrent reuse) when the caller omits it.
    opaque_user_id = join_object.user_id or f"lh-{acting_user_id}"

    try:
        url = await skyroom_client.create_login_url(
            room_id=row.skyroom_room_id,
            user_id=opaque_user_id,
            nickname=join_object.nickname,
            access=join_object.access,
            concurrent=join_object.concurrent,
            language=join_object.language,
            ttl=join_object.ttl,
        )
    except Exception as exc:  # noqa: BLE001
        raise _translate_skyroom_error(exc)

    return SkyroomJoinLinkResponse(url=url)
