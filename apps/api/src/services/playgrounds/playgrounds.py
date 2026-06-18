from typing import List
from uuid import uuid4
from datetime import datetime, timezone
from fastapi import HTTPException, Request, UploadFile
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.playgrounds import (
    Playground,
    PlaygroundCreate,
    PlaygroundRead,
    PlaygroundUpdate,
    PlaygroundAccessType,
)
from src.db.usergroup_resources import UserGroupResource
from src.db.usergroup_user import UserGroupUser
from src.db.users import PublicUser, AnonymousUser, APITokenUser, User
from src.security.auth import resolve_acting_user_id
from src.db.organizations import Organization
from src.db.user_organizations import UserOrganization
from src.db.courses.courses import Course
from src.security.rbac.constants import ADMIN_OR_MAINTAINER_ROLE_IDS
from src.security.superadmin import is_user_superadmin
from src.services.utils.upload_content import upload_file
from src.services.webhooks.dispatch import dispatch_webhooks


_SUPERADMIN_PLAYGROUND_RIGHTS = {
    "action_create": True,
    "action_read": True,
    "action_read_own": True,
    "action_update": True,
    "action_update_own": True,
    "action_delete": True,
    "action_delete_own": True,
}


async def _playground_to_read(playground: Playground, db_session: AsyncSession) -> PlaygroundRead:
    """Convert a Playground model to PlaygroundRead, enriching with org_uuid, org_slug, and author info."""
    read = PlaygroundRead.model_validate(playground)
    org = (await db_session.execute(select(Organization).where(Organization.id == playground.org_id))).scalars().first()
    if org:
        read.org_uuid = org.org_uuid
        read.org_slug = org.slug
    if playground.created_by:
        author = (await db_session.execute(select(User).where(User.id == playground.created_by))).scalars().first()
        if author:
            read.author_username = author.username
            read.author_first_name = author.first_name
            read.author_last_name = author.last_name
            read.author_user_uuid = author.user_uuid
            read.author_avatar_image = author.avatar_image
    return read


async def _get_user_rights(
    user_id: int,
    org_id: int,
    db_session: AsyncSession,
) -> dict:
    # Superadmins administer every tenant from the platform panel; they don't
    # need an org membership row.
    if await is_user_superadmin(user_id, db_session):
        return {"playgrounds": dict(_SUPERADMIN_PLAYGROUND_RIGHTS)}

    statement = (
        select(UserOrganization)
        .where(UserOrganization.user_id == user_id)
        .where(UserOrganization.org_id == org_id)
    )
    user_org = (await db_session.execute(statement)).scalars().first()
    if not user_org:
        return {}

    from src.db.roles import Role
    role = (await db_session.execute(select(Role).where(Role.id == user_org.role_id))).scalars().first()
    if not role or not role.rights:
        return {}

    rights = role.rights
    if isinstance(rights, dict):
        return rights
    return rights.model_dump() if hasattr(rights, "model_dump") else {}


async def _is_org_admin(user_id: int, org_id: int, db_session: AsyncSession) -> bool:
    statement = (
        select(UserOrganization)
        .where(UserOrganization.user_id == user_id)
        .where(UserOrganization.org_id == org_id)
    )
    user_org = (await db_session.execute(statement)).scalars().first()
    if not user_org:
        return False
    return user_org.role_id in ADMIN_OR_MAINTAINER_ROLE_IDS


async def _user_in_playground_usergroup(
    user_id: int, playground_uuid: str, db_session: AsyncSession
) -> bool:
    usergroup_stmt = select(UserGroupResource).where(
        UserGroupResource.resource_uuid == playground_uuid
    )
    ugrs = (await db_session.execute(usergroup_stmt)).scalars().all()
    if not ugrs:
        return False

    usergroup_ids = [ugr.usergroup_id for ugr in ugrs]
    membership_stmt = select(UserGroupUser).where(
        UserGroupUser.usergroup_id.in_(usergroup_ids),
        UserGroupUser.user_id == user_id,
    )
    return (await db_session.execute(membership_stmt)).scalars().first() is not None


async def _check_read_access(
    playground: Playground,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    db_session: AsyncSession,
) -> None:
    """Raise 403 if current_user cannot read this playground."""
    if playground.access_type == PlaygroundAccessType.PUBLIC:
        return

    if isinstance(current_user, AnonymousUser):
        raise HTTPException(status_code=401, detail="Authentication required")

    if playground.access_type == PlaygroundAccessType.AUTHENTICATED:
        return

    # RESTRICTED
    acting_user_id = resolve_acting_user_id(current_user)
    if await _is_org_admin(acting_user_id, playground.org_id, db_session):
        return
    if playground.created_by == acting_user_id:
        return
    if await _user_in_playground_usergroup(acting_user_id, playground.playground_uuid, db_session):
        return

    raise HTTPException(status_code=403, detail="Access denied to this playground")


async def create_playground(
    request: Request,
    org_id: int,
    playground_data: PlaygroundCreate,
    current_user: PublicUser,
    db_session: AsyncSession,
) -> PlaygroundRead:
    # Verify org exists
    org = (await db_session.execute(select(Organization).where(Organization.id == org_id))).scalars().first()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    # Check rights. Resolve the real acting user id: an API token authenticates
    # as APITokenUser whose .id is the token id (often 0), not a user id. Using
    # current_user.id directly would (a) make every rights/ownership check fail
    # for token callers and (b) store the token id as created_by, which is a FK
    # to user.id — corrupting the author reference.
    acting_user_id = resolve_acting_user_id(current_user)
    rights = await _get_user_rights(acting_user_id, org_id, db_session)
    pg_rights = rights.get("playgrounds", {})
    if not pg_rights.get("action_create", False):
        raise HTTPException(status_code=403, detail="Insufficient permissions to create playgrounds")

    # Resolve course_id if course_uuid provided
    course_id = None
    if playground_data.course_uuid:
        course = (await db_session.execute(
            select(Course).where(Course.course_uuid == playground_data.course_uuid)
        )).scalars().first()
        if course and course.org_id == org_id:
            course_id = course.id

    now = datetime.now(timezone.utc).replace(tzinfo=None).isoformat()
    playground = Playground(
        name=playground_data.name,
        description=playground_data.description,
        thumbnail_image=playground_data.thumbnail_image,
        access_type=playground_data.access_type,
        published=False,
        course_uuid=playground_data.course_uuid,
        html_content=playground_data.html_content,
        org_id=org_id,
        playground_uuid=str(uuid4()),
        course_id=course_id,
        created_by=acting_user_id,
        creation_date=now,
        update_date=now,
    )
    db_session.add(playground)
    await db_session.commit()
    await db_session.refresh(playground)

    await dispatch_webhooks(
        event_name="playground_created",
        org_id=org_id,
        data={
            "playground_uuid": playground.playground_uuid,
            "name": playground.name,
            "created_by": acting_user_id,
        },
    )

    return await _playground_to_read(playground, db_session)


async def get_playground(
    request: Request,
    playground_uuid: str,
    current_user: PublicUser | AnonymousUser,
    db_session: AsyncSession,
) -> PlaygroundRead:
    playground = (await db_session.execute(
        select(Playground).where(Playground.playground_uuid == playground_uuid)
    )).scalars().first()
    if not playground:
        raise HTTPException(status_code=404, detail="Playground not found")

    await _check_read_access(playground, current_user, db_session)

    # Unpublished (draft) playgrounds must never be exposed by uuid to anyone
    # other than the owner or an org admin. _check_read_access only validates
    # access_type, so without this guard a draft PUBLIC/AUTHENTICATED playground
    # would be readable by anonymous/any authenticated user via its uuid — the
    # same content list_org_playgrounds deliberately hides.
    if not playground.published:
        if isinstance(current_user, AnonymousUser):
            raise HTTPException(status_code=404, detail="Playground not found")
        acting_user_id = resolve_acting_user_id(current_user)
        if playground.created_by != acting_user_id and not await _is_org_admin(
            acting_user_id, playground.org_id, db_session
        ):
            raise HTTPException(status_code=404, detail="Playground not found")

    return await _playground_to_read(playground, db_session)


async def list_org_playgrounds(
    request: Request,
    org_id: int,
    current_user: PublicUser | AnonymousUser,
    db_session: AsyncSession,
) -> List[PlaygroundRead]:
    playgrounds = (await db_session.execute(
        select(Playground).where(Playground.org_id == org_id)
    )).scalars().all()
    if not playgrounds:
        return []

    is_anon = isinstance(current_user, AnonymousUser)
    # An API token's .id is the token id, not a user id; resolve to the real
    # acting user so ownership/admin visibility checks below evaluate correctly.
    user_id = None if is_anon else resolve_acting_user_id(current_user)

    is_admin = False if is_anon else await _is_org_admin(user_id, org_id, db_session)

    # Batch resolve usergroup access for RESTRICTED playgrounds (only needed for
    # authenticated non-admin non-owner users).
    accessible_restricted_uuids: set[str] = set()
    if not is_anon and not is_admin:
        restricted_uuids = [
            pg.playground_uuid
            for pg in playgrounds
            if pg.access_type == PlaygroundAccessType.RESTRICTED
            and pg.created_by != user_id
        ]
        if restricted_uuids:
            ugrs = (await db_session.execute(
                select(
                    UserGroupResource.resource_uuid,
                    UserGroupResource.usergroup_id,
                ).where(UserGroupResource.resource_uuid.in_(restricted_uuids))
            )).all()
            if ugrs:
                ug_ids = list({row[1] for row in ugrs})
                member_ug_ids = set(
                    (await db_session.execute(
                        select(UserGroupUser.usergroup_id).where(
                            UserGroupUser.usergroup_id.in_(ug_ids),
                            UserGroupUser.user_id == user_id,
                        )
                    )).scalars().all()
                )
                for resource_uuid, ug_id in ugrs:
                    if ug_id in member_ug_ids:
                        accessible_restricted_uuids.add(resource_uuid)

    allowed: list[Playground] = []
    for pg in playgrounds:
        if pg.access_type == PlaygroundAccessType.AUTHENTICATED and is_anon:
            continue
        if pg.access_type == PlaygroundAccessType.RESTRICTED:
            if is_anon:
                continue
            if (
                not is_admin
                and pg.created_by != user_id
                and pg.playground_uuid not in accessible_restricted_uuids
            ):
                continue

        if not pg.published:
            if is_anon:
                continue
            if not is_admin and pg.created_by != user_id:
                continue

        allowed.append(pg)

    if not allowed:
        return []

    org = (await db_session.execute(select(Organization).where(Organization.id == org_id))).scalars().first()
    author_ids = {pg.created_by for pg in allowed if pg.created_by}
    authors_map: dict[int, User] = {}
    if author_ids:
        authors = (await db_session.execute(
            select(User).where(User.id.in_(author_ids))
        )).scalars().all()
        authors_map = {u.id: u for u in authors}

    result: List[PlaygroundRead] = []
    for pg in allowed:
        read = PlaygroundRead.model_validate(pg)
        if org:
            read.org_uuid = org.org_uuid
            read.org_slug = org.slug
        author = authors_map.get(pg.created_by) if pg.created_by else None
        if author:
            read.author_username = author.username
            read.author_first_name = author.first_name
            read.author_last_name = author.last_name
            read.author_user_uuid = author.user_uuid
            read.author_avatar_image = author.avatar_image
        result.append(read)

    return result


async def update_playground(
    request: Request,
    playground_uuid: str,
    playground_data: PlaygroundUpdate,
    current_user: PublicUser,
    db_session: AsyncSession,
) -> PlaygroundRead:
    playground = (await db_session.execute(
        select(Playground).where(Playground.playground_uuid == playground_uuid)
    )).scalars().first()
    if not playground:
        raise HTTPException(status_code=404, detail="Playground not found")

    acting_user_id = resolve_acting_user_id(current_user)
    rights = await _get_user_rights(acting_user_id, playground.org_id, db_session)
    pg_rights = rights.get("playgrounds", {})

    is_owner = playground.created_by == acting_user_id
    can_update = pg_rights.get("action_update", False) or (
        is_owner and pg_rights.get("action_update_own", False)
    )
    if not can_update:
        raise HTTPException(status_code=403, detail="Insufficient permissions to update playground")

    update_data = playground_data.model_dump(exclude_unset=True)

    # Resolve course_id if course_uuid changed
    if "course_uuid" in update_data:
        new_course_uuid = update_data.get("course_uuid")
        if new_course_uuid:
            course = (await db_session.execute(
                select(Course).where(Course.course_uuid == new_course_uuid)
            )).scalars().first()
            if course and course.org_id == playground.org_id:
                playground.course_id = course.id
            else:
                playground.course_id = None
        else:
            playground.course_id = None

    for key, value in update_data.items():
        setattr(playground, key, value)

    playground.update_date = datetime.now(timezone.utc).replace(tzinfo=None).isoformat()
    db_session.add(playground)
    await db_session.commit()
    await db_session.refresh(playground)
    return await _playground_to_read(playground, db_session)


async def delete_playground(
    request: Request,
    playground_uuid: str,
    current_user: PublicUser,
    db_session: AsyncSession,
) -> dict:
    playground = (await db_session.execute(
        select(Playground).where(Playground.playground_uuid == playground_uuid)
    )).scalars().first()
    if not playground:
        raise HTTPException(status_code=404, detail="Playground not found")

    acting_user_id = resolve_acting_user_id(current_user)
    rights = await _get_user_rights(acting_user_id, playground.org_id, db_session)
    pg_rights = rights.get("playgrounds", {})

    is_owner = playground.created_by == acting_user_id
    can_delete = pg_rights.get("action_delete", False) or (
        is_owner and pg_rights.get("action_delete_own", False)
    )
    if not can_delete:
        raise HTTPException(status_code=403, detail="Insufficient permissions to delete playground")

    # Remove usergroup associations
    ugrs = (await db_session.execute(
        select(UserGroupResource).where(
            UserGroupResource.resource_uuid == playground_uuid
        )
    )).scalars().all()
    for ugr in ugrs:
        await db_session.delete(ugr)

    await db_session.delete(playground)
    await db_session.commit()
    return {"detail": "Playground deleted"}


async def duplicate_playground(
    request: Request,
    playground_uuid: str,
    current_user: PublicUser,
    db_session: AsyncSession,
) -> PlaygroundRead:
    playground = (await db_session.execute(
        select(Playground).where(Playground.playground_uuid == playground_uuid)
    )).scalars().first()
    if not playground:
        raise HTTPException(status_code=404, detail="Playground not found")

    acting_user_id = resolve_acting_user_id(current_user)
    rights = await _get_user_rights(acting_user_id, playground.org_id, db_session)
    pg_rights = rights.get("playgrounds", {})
    if not pg_rights.get("action_create", False):
        raise HTTPException(status_code=403, detail="Insufficient permissions to create playgrounds")

    now = datetime.now(timezone.utc).replace(tzinfo=None).isoformat()
    new_playground = Playground(
        name=f"{playground.name} (Copy)",
        description=playground.description,
        thumbnail_image=None,
        access_type=playground.access_type,
        published=False,
        course_uuid=playground.course_uuid,
        html_content=playground.html_content,
        org_id=playground.org_id,
        playground_uuid=str(uuid4()),
        course_id=playground.course_id,
        created_by=acting_user_id,
        creation_date=now,
        update_date=now,
    )
    db_session.add(new_playground)
    await db_session.commit()
    await db_session.refresh(new_playground)
    return await _playground_to_read(new_playground, db_session)


async def add_usergroup_to_playground(
    request: Request,
    playground_uuid: str,
    usergroup_uuid: str,
    current_user: PublicUser,
    db_session: AsyncSession,
) -> dict:
    playground = (await db_session.execute(
        select(Playground).where(Playground.playground_uuid == playground_uuid)
    )).scalars().first()
    if not playground:
        raise HTTPException(status_code=404, detail="Playground not found")

    acting_user_id = resolve_acting_user_id(current_user)
    rights = await _get_user_rights(acting_user_id, playground.org_id, db_session)
    pg_rights = rights.get("playgrounds", {})
    is_owner = playground.created_by == acting_user_id
    can_update = pg_rights.get("action_update", False) or (
        is_owner and pg_rights.get("action_update_own", False)
    )
    if not can_update:
        raise HTTPException(status_code=403, detail="Insufficient permissions")

    from src.db.usergroups import UserGroup
    ug = (await db_session.execute(
        select(UserGroup).where(UserGroup.usergroup_uuid == usergroup_uuid)
    )).scalars().first()
    if not ug:
        raise HTTPException(status_code=404, detail="User group not found")

    existing = (await db_session.execute(
        select(UserGroupResource).where(
            UserGroupResource.resource_uuid == playground_uuid,
            UserGroupResource.usergroup_id == ug.id,
        )
    )).scalars().first()
    if existing:
        return {"detail": "User group already has access"}

    now = datetime.now(timezone.utc).replace(tzinfo=None).isoformat()
    ugr = UserGroupResource(
        usergroup_id=ug.id,
        resource_uuid=playground_uuid,
        org_id=playground.org_id,
        creation_date=now,
        update_date=now,
    )
    db_session.add(ugr)
    await db_session.commit()
    return {"detail": "User group added to playground"}


async def remove_usergroup_from_playground(
    request: Request,
    playground_uuid: str,
    usergroup_uuid: str,
    current_user: PublicUser,
    db_session: AsyncSession,
) -> dict:
    playground = (await db_session.execute(
        select(Playground).where(Playground.playground_uuid == playground_uuid)
    )).scalars().first()
    if not playground:
        raise HTTPException(status_code=404, detail="Playground not found")

    acting_user_id = resolve_acting_user_id(current_user)
    rights = await _get_user_rights(acting_user_id, playground.org_id, db_session)
    pg_rights = rights.get("playgrounds", {})
    is_owner = playground.created_by == acting_user_id
    can_update = pg_rights.get("action_update", False) or (
        is_owner and pg_rights.get("action_update_own", False)
    )
    if not can_update:
        raise HTTPException(status_code=403, detail="Insufficient permissions")

    from src.db.usergroups import UserGroup
    ug = (await db_session.execute(
        select(UserGroup).where(UserGroup.usergroup_uuid == usergroup_uuid)
    )).scalars().first()
    if not ug:
        raise HTTPException(status_code=404, detail="User group not found")

    ugr = (await db_session.execute(
        select(UserGroupResource).where(
            UserGroupResource.resource_uuid == playground_uuid,
            UserGroupResource.usergroup_id == ug.id,
        )
    )).scalars().first()
    if not ugr:
        raise HTTPException(status_code=404, detail="User group not associated with playground")

    await db_session.delete(ugr)
    await db_session.commit()
    return {"detail": "User group removed from playground"}


async def update_playground_thumbnail(
    request: Request,
    playground_uuid: str,
    current_user: PublicUser,
    db_session: AsyncSession,
    thumbnail_file: UploadFile | None = None,
) -> PlaygroundRead:
    playground = (await db_session.execute(
        select(Playground).where(Playground.playground_uuid == playground_uuid)
    )).scalars().first()
    if not playground:
        raise HTTPException(status_code=404, detail="Playground not found")

    acting_user_id = resolve_acting_user_id(current_user)
    rights = await _get_user_rights(acting_user_id, playground.org_id, db_session)
    pg_rights = rights.get("playgrounds", {})
    is_owner = playground.created_by == acting_user_id
    can_update = pg_rights.get("action_update", False) or (
        is_owner and pg_rights.get("action_update_own", False)
    )
    if not can_update:
        raise HTTPException(status_code=403, detail="Insufficient permissions to update playground")

    org = (await db_session.execute(select(Organization).where(Organization.id == playground.org_id))).scalars().first()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    if not thumbnail_file or not thumbnail_file.filename:
        raise HTTPException(status_code=400, detail="No thumbnail file provided")

    name_in_disk = await upload_file(
        file=thumbnail_file,
        directory=f"playgrounds/{playground.playground_uuid}/thumbnails",
        type_of_dir="orgs",
        uuid=org.org_uuid,
        allowed_types=["image"],
        filename_prefix="thumbnail",
    )

    playground.thumbnail_image = name_in_disk
    playground.update_date = datetime.now(timezone.utc).replace(tzinfo=None).isoformat()
    db_session.add(playground)
    await db_session.commit()
    await db_session.refresh(playground)
    return await _playground_to_read(playground, db_session)


async def get_playground_usergroups(
    request: Request,
    playground_uuid: str,
    current_user: PublicUser,
    db_session: AsyncSession,
) -> List[dict]:
    playground = (await db_session.execute(
        select(Playground).where(Playground.playground_uuid == playground_uuid)
    )).scalars().first()
    if not playground:
        raise HTTPException(status_code=404, detail="Playground not found")

    ugrs = (await db_session.execute(
        select(UserGroupResource).where(
            UserGroupResource.resource_uuid == playground_uuid
        )
    )).scalars().all()

    result = []
    from src.db.usergroups import UserGroup
    for ugr in ugrs:
        ug = (await db_session.execute(select(UserGroup).where(UserGroup.id == ugr.usergroup_id))).scalars().first()
        if ug:
            result.append(
                {
                    "usergroup_id": ug.id,
                    "usergroup_uuid": ug.usergroup_uuid,
                    "name": ug.name,
                    "description": ug.description,
                }
            )
    return result
