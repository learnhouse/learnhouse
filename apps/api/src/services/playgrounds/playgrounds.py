from typing import List
from uuid import uuid4
from datetime import datetime
from fastapi import HTTPException, Request, UploadFile
from sqlmodel import Session, select

from src.db.playgrounds import (
    Playground,
    PlaygroundCreate,
    PlaygroundRead,
    PlaygroundUpdate,
    PlaygroundAccessType,
)
from src.db.usergroup_resources import UserGroupResource
from src.db.usergroup_user import UserGroupUser
from src.db.users import PublicUser, AnonymousUser, User
from src.db.organizations import Organization
from src.db.user_organizations import UserOrganization
from src.db.courses.courses import Course
from src.security.rbac.constants import ADMIN_OR_MAINTAINER_ROLE_IDS
from src.services.utils.upload_content import upload_file


def _playground_to_read(playground: Playground, db_session: Session) -> PlaygroundRead:
    """Convert a Playground model to PlaygroundRead, enriching with org_uuid, org_slug, and author info."""
    read = PlaygroundRead.model_validate(playground)
    org = db_session.get(Organization, playground.org_id)
    if org:
        read.org_uuid = org.org_uuid
        read.org_slug = org.slug
    if playground.created_by:
        author = db_session.get(User, playground.created_by)
        if author:
            read.author_username = author.username
            read.author_first_name = author.first_name
            read.author_last_name = author.last_name
            read.author_user_uuid = author.user_uuid
            read.author_avatar_image = author.avatar_image
    return read


def _get_user_rights(
    user_id: int,
    org_id: int,
    db_session: Session,
) -> dict:
    """Return the first role's rights for the user in the org, or empty dict."""
    statement = (
        select(UserOrganization)
        .where(UserOrganization.user_id == user_id)
        .where(UserOrganization.org_id == org_id)
    )
    user_org = db_session.exec(statement).first()
    if not user_org:
        return {}

    from src.db.roles import Role
    role = db_session.get(Role, user_org.role_id)
    if not role or not role.rights:
        return {}

    rights = role.rights
    if isinstance(rights, dict):
        return rights
    return rights.model_dump() if hasattr(rights, "model_dump") else {}


def _is_org_admin(user_id: int, org_id: int, db_session: Session) -> bool:
    statement = (
        select(UserOrganization)
        .where(UserOrganization.user_id == user_id)
        .where(UserOrganization.org_id == org_id)
    )
    user_org = db_session.exec(statement).first()
    if not user_org:
        return False
    return user_org.role_id in ADMIN_OR_MAINTAINER_ROLE_IDS


def _user_in_playground_usergroup(
    user_id: int, playground_uuid: str, db_session: Session
) -> bool:
    usergroup_stmt = select(UserGroupResource).where(
        UserGroupResource.resource_uuid == playground_uuid
    )
    ugrs = db_session.exec(usergroup_stmt).all()
    if not ugrs:
        return False

    usergroup_ids = [ugr.usergroup_id for ugr in ugrs]
    membership_stmt = select(UserGroupUser).where(
        UserGroupUser.usergroup_id.in_(usergroup_ids),
        UserGroupUser.user_id == user_id,
    )
    return db_session.exec(membership_stmt).first() is not None


def _check_read_access(
    playground: Playground,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
) -> None:
    """Raise 403 if current_user cannot read this playground."""
    if playground.access_type == PlaygroundAccessType.PUBLIC:
        return

    if isinstance(current_user, AnonymousUser):
        raise HTTPException(status_code=401, detail="Authentication required")

    if playground.access_type == PlaygroundAccessType.AUTHENTICATED:
        return

    # RESTRICTED
    if _is_org_admin(current_user.id, playground.org_id, db_session):
        return
    if playground.created_by == current_user.id:
        return
    if _user_in_playground_usergroup(current_user.id, playground.playground_uuid, db_session):
        return

    raise HTTPException(status_code=403, detail="Access denied to this playground")


async def create_playground(
    request: Request,
    org_id: int,
    playground_data: PlaygroundCreate,
    current_user: PublicUser,
    db_session: Session,
) -> PlaygroundRead:
    # Verify org exists
    org = db_session.get(Organization, org_id)
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    # Check rights
    rights = _get_user_rights(current_user.id, org_id, db_session)
    pg_rights = rights.get("playgrounds", {})
    if not pg_rights.get("action_create", False):
        raise HTTPException(status_code=403, detail="Insufficient permissions to create playgrounds")

    # Resolve course_id if course_uuid provided
    course_id = None
    if playground_data.course_uuid:
        course = db_session.exec(
            select(Course).where(Course.course_uuid == playground_data.course_uuid)
        ).first()
        if course and course.org_id == org_id:
            course_id = course.id

    now = datetime.utcnow().isoformat()
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
        created_by=current_user.id,
        creation_date=now,
        update_date=now,
    )
    db_session.add(playground)
    db_session.commit()
    db_session.refresh(playground)
    return _playground_to_read(playground, db_session)


async def get_playground(
    request: Request,
    playground_uuid: str,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
) -> PlaygroundRead:
    playground = db_session.exec(
        select(Playground).where(Playground.playground_uuid == playground_uuid)
    ).first()
    if not playground:
        raise HTTPException(status_code=404, detail="Playground not found")

    _check_read_access(playground, current_user, db_session)
    return _playground_to_read(playground, db_session)


async def list_org_playgrounds(
    request: Request,
    org_id: int,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
) -> List[PlaygroundRead]:
    statement = select(Playground).where(Playground.org_id == org_id)
    playgrounds = db_session.exec(statement).all()

    result = []
    for pg in playgrounds:
        try:
            _check_read_access(pg, current_user, db_session)
            # Only include published ones for non-admins
            if not pg.published:
                if isinstance(current_user, AnonymousUser):
                    continue
                if not _is_org_admin(current_user.id, org_id, db_session) and pg.created_by != current_user.id:
                    continue
            result.append(_playground_to_read(pg, db_session))
        except HTTPException:
            continue

    return result


async def update_playground(
    request: Request,
    playground_uuid: str,
    playground_data: PlaygroundUpdate,
    current_user: PublicUser,
    db_session: Session,
) -> PlaygroundRead:
    playground = db_session.exec(
        select(Playground).where(Playground.playground_uuid == playground_uuid)
    ).first()
    if not playground:
        raise HTTPException(status_code=404, detail="Playground not found")

    rights = _get_user_rights(current_user.id, playground.org_id, db_session)
    pg_rights = rights.get("playgrounds", {})

    is_owner = playground.created_by == current_user.id
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
            course = db_session.exec(
                select(Course).where(Course.course_uuid == new_course_uuid)
            ).first()
            if course and course.org_id == playground.org_id:
                playground.course_id = course.id
            else:
                playground.course_id = None
        else:
            playground.course_id = None

    for key, value in update_data.items():
        setattr(playground, key, value)

    playground.update_date = datetime.utcnow().isoformat()
    db_session.add(playground)
    db_session.commit()
    db_session.refresh(playground)
    return _playground_to_read(playground, db_session)


async def delete_playground(
    request: Request,
    playground_uuid: str,
    current_user: PublicUser,
    db_session: Session,
) -> dict:
    playground = db_session.exec(
        select(Playground).where(Playground.playground_uuid == playground_uuid)
    ).first()
    if not playground:
        raise HTTPException(status_code=404, detail="Playground not found")

    rights = _get_user_rights(current_user.id, playground.org_id, db_session)
    pg_rights = rights.get("playgrounds", {})

    is_owner = playground.created_by == current_user.id
    can_delete = pg_rights.get("action_delete", False) or (
        is_owner and pg_rights.get("action_delete_own", False)
    )
    if not can_delete:
        raise HTTPException(status_code=403, detail="Insufficient permissions to delete playground")

    # Remove usergroup associations
    ugrs = db_session.exec(
        select(UserGroupResource).where(
            UserGroupResource.resource_uuid == playground_uuid
        )
    ).all()
    for ugr in ugrs:
        db_session.delete(ugr)

    db_session.delete(playground)
    db_session.commit()
    return {"detail": "Playground deleted"}


async def duplicate_playground(
    request: Request,
    playground_uuid: str,
    current_user: PublicUser,
    db_session: Session,
) -> PlaygroundRead:
    playground = db_session.exec(
        select(Playground).where(Playground.playground_uuid == playground_uuid)
    ).first()
    if not playground:
        raise HTTPException(status_code=404, detail="Playground not found")

    rights = _get_user_rights(current_user.id, playground.org_id, db_session)
    pg_rights = rights.get("playgrounds", {})
    if not pg_rights.get("action_create", False):
        raise HTTPException(status_code=403, detail="Insufficient permissions to create playgrounds")

    now = datetime.utcnow().isoformat()
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
        created_by=current_user.id,
        creation_date=now,
        update_date=now,
    )
    db_session.add(new_playground)
    db_session.commit()
    db_session.refresh(new_playground)
    return _playground_to_read(new_playground, db_session)


async def add_usergroup_to_playground(
    request: Request,
    playground_uuid: str,
    usergroup_uuid: str,
    current_user: PublicUser,
    db_session: Session,
) -> dict:
    playground = db_session.exec(
        select(Playground).where(Playground.playground_uuid == playground_uuid)
    ).first()
    if not playground:
        raise HTTPException(status_code=404, detail="Playground not found")

    rights = _get_user_rights(current_user.id, playground.org_id, db_session)
    pg_rights = rights.get("playgrounds", {})
    is_owner = playground.created_by == current_user.id
    can_update = pg_rights.get("action_update", False) or (
        is_owner and pg_rights.get("action_update_own", False)
    )
    if not can_update:
        raise HTTPException(status_code=403, detail="Insufficient permissions")

    from src.db.usergroups import UserGroup
    ug = db_session.exec(
        select(UserGroup).where(UserGroup.usergroup_uuid == usergroup_uuid)
    ).first()
    if not ug:
        raise HTTPException(status_code=404, detail="User group not found")

    existing = db_session.exec(
        select(UserGroupResource).where(
            UserGroupResource.resource_uuid == playground_uuid,
            UserGroupResource.usergroup_id == ug.id,
        )
    ).first()
    if existing:
        return {"detail": "User group already has access"}

    now = datetime.utcnow().isoformat()
    ugr = UserGroupResource(
        usergroup_id=ug.id,
        resource_uuid=playground_uuid,
        org_id=playground.org_id,
        creation_date=now,
        update_date=now,
    )
    db_session.add(ugr)
    db_session.commit()
    return {"detail": "User group added to playground"}


async def remove_usergroup_from_playground(
    request: Request,
    playground_uuid: str,
    usergroup_uuid: str,
    current_user: PublicUser,
    db_session: Session,
) -> dict:
    playground = db_session.exec(
        select(Playground).where(Playground.playground_uuid == playground_uuid)
    ).first()
    if not playground:
        raise HTTPException(status_code=404, detail="Playground not found")

    rights = _get_user_rights(current_user.id, playground.org_id, db_session)
    pg_rights = rights.get("playgrounds", {})
    is_owner = playground.created_by == current_user.id
    can_update = pg_rights.get("action_update", False) or (
        is_owner and pg_rights.get("action_update_own", False)
    )
    if not can_update:
        raise HTTPException(status_code=403, detail="Insufficient permissions")

    from src.db.usergroups import UserGroup
    ug = db_session.exec(
        select(UserGroup).where(UserGroup.usergroup_uuid == usergroup_uuid)
    ).first()
    if not ug:
        raise HTTPException(status_code=404, detail="User group not found")

    ugr = db_session.exec(
        select(UserGroupResource).where(
            UserGroupResource.resource_uuid == playground_uuid,
            UserGroupResource.usergroup_id == ug.id,
        )
    ).first()
    if not ugr:
        raise HTTPException(status_code=404, detail="User group not associated with playground")

    db_session.delete(ugr)
    db_session.commit()
    return {"detail": "User group removed from playground"}


async def update_playground_thumbnail(
    request: Request,
    playground_uuid: str,
    current_user: PublicUser,
    db_session: Session,
    thumbnail_file: UploadFile | None = None,
) -> PlaygroundRead:
    playground = db_session.exec(
        select(Playground).where(Playground.playground_uuid == playground_uuid)
    ).first()
    if not playground:
        raise HTTPException(status_code=404, detail="Playground not found")

    rights = _get_user_rights(current_user.id, playground.org_id, db_session)
    pg_rights = rights.get("playgrounds", {})
    is_owner = playground.created_by == current_user.id
    can_update = pg_rights.get("action_update", False) or (
        is_owner and pg_rights.get("action_update_own", False)
    )
    if not can_update:
        raise HTTPException(status_code=403, detail="Insufficient permissions to update playground")

    org = db_session.get(Organization, playground.org_id)
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
    playground.update_date = datetime.utcnow().isoformat()
    db_session.add(playground)
    db_session.commit()
    db_session.refresh(playground)
    return _playground_to_read(playground, db_session)


async def get_playground_usergroups(
    request: Request,
    playground_uuid: str,
    current_user: PublicUser,
    db_session: Session,
) -> List[dict]:
    playground = db_session.exec(
        select(Playground).where(Playground.playground_uuid == playground_uuid)
    ).first()
    if not playground:
        raise HTTPException(status_code=404, detail="Playground not found")

    ugrs = db_session.exec(
        select(UserGroupResource).where(
            UserGroupResource.resource_uuid == playground_uuid
        )
    ).all()

    result = []
    from src.db.usergroups import UserGroup
    for ugr in ugrs:
        ug = db_session.get(UserGroup, ugr.usergroup_id)
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
