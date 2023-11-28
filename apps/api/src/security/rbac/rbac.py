from math import e
from typing import Literal
from fastapi import HTTPException, status, Request
from sqlalchemy import func, null, or_
from sqlmodel import Session, select
from src.db.collections import Collection
from src.db.courses import Course
from src.db.resource_authors import ResourceAuthor, ResourceAuthorshipEnum
from src.db.roles import Role
from src.db.user_organizations import UserOrganization
from src.security.rbac.utils import check_element_type


# Tested and working
async def authorization_verify_if_element_is_public(
    request,
    element_uuid: str,
    action: Literal["read"],
    db_session: Session,
):
    element_nature = await check_element_type(element_uuid)
    # Verifies if the element is public
    if element_nature == ("courses" or "collections") and action == "read":
        if element_nature == "courses":
            statement = select(Course).where(
                Course.public == True, Course.course_uuid == element_uuid
            )
            course = db_session.exec(statement).first()
            if course:
                return True
            else:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="User rights (public content) : You don't have the right to perform this action",
                )

        if element_nature == "collections":
            statement = select(Collection).where(
                Collection.public == True, Collection.collection_uuid == element_uuid
            )
            collection = db_session.exec(statement).first()

            if collection:
                return True
            else:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="User rights (public content) : You don't have the right to perform this action",
                )
    else:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User rights (public content) : You don't have the right to perform this action",
        )


# Tested and working
async def authorization_verify_if_user_is_author(
    request,
    user_id: int,
    action: Literal["read", "update", "delete", "create"],
    element_uuid: str,
    db_session: Session,
):
    if action == "update" or "delete" or "read":
        statement = select(ResourceAuthor).where(
            ResourceAuthor.resource_uuid == element_uuid
        )
        resource_author = db_session.exec(statement).first()

        if resource_author:
            if resource_author.user_id == int(user_id):
                if (resource_author.authorship == ResourceAuthorshipEnum.CREATOR) or (
                    resource_author.authorship == ResourceAuthorshipEnum.MAINTAINER
                ):
                    return True
                else:
                    return False
            else:
                return False
        else:
            return False


# Tested and working
async def authorization_verify_based_on_roles(
    request: Request,
    user_id: int,
    action: Literal["read", "update", "delete", "create"],
    element_uuid: str,
    db_session: Session,
):
    element_type = await check_element_type(element_uuid)

    # Get user roles bound to an organization and standard roles
    statement = (
        select(Role)
        .join(UserOrganization)
        .where((UserOrganization.org_id == Role.org_id) | (Role.org_id == null()))
        .where(UserOrganization.user_id == user_id)
    )

    user_roles_in_organization_and_standard_roles = db_session.exec(statement).all()

    # Find in roles list if there is a role that matches users action for this type of element
    for role in user_roles_in_organization_and_standard_roles:
        role = Role.from_orm(role)
        if role.rights:
            rights = role.rights
            if rights[element_type][f"action_{action}"] is True:
                return True
            else:
                return False
    else:
        return False


# Tested and working
async def authorization_verify_based_on_roles_and_authorship(
    request: Request,
    user_id: int,
    action: Literal["read", "update", "delete", "create"],
    element_uuid: str,
    db_session: Session,
):
    isAuthor = await authorization_verify_if_user_is_author(
        request, user_id, action, element_uuid, db_session
    )

    isRole = await authorization_verify_based_on_roles(
        request, user_id, action, element_uuid, db_session
    )

    if isAuthor or isRole:
        return True
    else:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User rights (roles & authorship) : You don't have the right to perform this action",
        )


async def authorization_verify_if_user_is_anon(user_id: int):
    if user_id == 0:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You should be logged in to perform this action",
        )
