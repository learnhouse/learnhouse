from typing import Literal
from fastapi import HTTPException, status, Request
from src.security.rbac.utils import check_element_type, get_id_identifier_of_element
from src.services.roles.schemas.roles import RoleInDB
from src.services.users.schemas.users import UserRolesInOrganization


async def authorization_verify_if_element_is_public(
    request,
    element_id: str,
    user_id: str,
    action: Literal["read"],
):
    element_nature = await check_element_type(element_id)

    # Verifies if the element is public
    if (
        element_nature == ("courses" or "collections")
        and action == "read"
        and user_id == "anonymous"
    ):
        if element_nature == "courses":
            courses = request.app.db["courses"]
            course = await courses.find_one({"course_id": element_id})

            if course["public"]:
                return True
            else:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="User rights (public content) : You don't have the right to perform this action",
                )

        if element_nature == "collections":
            collections = request.app.db["collections"]
            collection = await collections.find_one({"collection_id": element_id})

            if collection["public"]:
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


async def authorization_verify_if_user_is_author(
    request,
    user_id: str,
    action: Literal["read", "update", "delete", "create"],
    element_id: str,
):
    if action == "update" or "delete" or "read":
        element_nature = await check_element_type(element_id)
        elements = request.app.db[element_nature]
        element_identifier = await get_id_identifier_of_element(element_id)
        element = await elements.find_one({element_identifier: element_id})
        if user_id in element["authors"]:
            return True
        else:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="User rights (author) : You don't have the right to perform this action",
            )
    else:
        return False


async def authorization_verify_based_on_roles(
    request: Request,
    user_id: str,
    action: Literal["read", "update", "delete", "create"],
    roles_list: list[UserRolesInOrganization],
    element_id: str,
):
    element_type = await check_element_type(element_id)
    element = request.app.db[element_type]
    roles = request.app.db["roles"]

    # Get the element
    element_identifier = await get_id_identifier_of_element(element_id)
    element = await element.find_one({element_identifier: element_id})

    # Get the roles of the user
    roles_id_list = [role["role_id"] for role in roles_list]
    roles = await roles.find({"role_id": {"$in": roles_id_list}}).to_list(length=100)

    # Get the rights of the roles
    for role in roles:
        role = RoleInDB(**role)
        if role.elements[element_type][f"action_{action}"] is True:
            return True
        else:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="User rights (roles) : You don't have the right to perform this action",
            )


async def authorization_verify_based_on_roles_and_authorship(
    request: Request,
    user_id: str,
    action: Literal["read", "update", "delete", "create"],
    roles_list: list[UserRolesInOrganization],
    element_id: str,
):
    isAuthor = await authorization_verify_if_user_is_author(
        request, user_id, action, element_id
    )

    isRole = await authorization_verify_based_on_roles(
        request, user_id, action, roles_list, element_id
    )

    if isAuthor or isRole:
        return True
    else:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User rights (roles & authorship) : You don't have the right to perform this action",
        )


async def authorization_verify_if_user_is_anon(user_id: str):
    if user_id == "anonymous":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You should be logged in to perform this action",
        )
