from pprint import pprint
from fastapi import HTTPException, status, Request
from passlib.context import CryptContext
from passlib.hash import pbkdf2_sha256
from src.services.roles.schemas.roles import RoleInDB

from src.services.users.schemas.users import User, UserInDB

### 🔒 JWT ##############################################################

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

ACCESS_TOKEN_EXPIRE_MINUTES = 30
SECRET_KEY = "09d25e094faa6ca2556c818166b7a9563b93f7099f6f0f4caa6cf63b88e8d3e7"
ALGORITHM = "HS256"

### 🔒 JWT ##############################################################


### 🔒 Passwords Hashing ##############################################################

async def security_hash_password(password: str):
    return pbkdf2_sha256.hash(password)


async def security_verify_password(plain_password: str, hashed_password: str):
    return pbkdf2_sha256.verify(plain_password, hashed_password)

### 🔒 Passwords Hashing ##############################################################

### 🔒 Roles checking  ##############################################################


async def verify_user_rights_with_roles(request: Request, action: str, user_id: str, element_id: str, element_org_id: str):
    """
    Check if the user has the right to perform the action on the element
    """
    roles = request.app.db["roles"]
    users = request.app.db["users"]

    user = await users.find_one({"user_id": user_id})

    # Check if user is available
    if not user and user_id != "anonymous":
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    
    # Check if user is anonymous
    if user_id == "anonymous":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="The ressource you are trying to access is not publicly available")

    # Check if the user is an admin
    user: UserInDB = UserInDB(**await users.find_one({"user_id": user_id}))

    # Organization roles verification
    for org in user.orgs:
        # TODO: Check if the org_id (user) is the same as the org_id (element)

        if org.org_id == element_org_id:
            return True

        # Check if user is owner or reader of the organization
        if org.org_role == ("owner" or "editor"):
            return True

    # If the user is not an owner or a editor, check if he has a role
    # Get user roles
    user_roles = user.roles

    # TODO: Check if the org_id of the role is the same as the org_id of the element using find

    if action != "create":
        await check_user_role_org_with_element_org(request, element_id, user_roles)

    # Check if user has the right role

    element_type = await check_element_type(element_id)
    for role_id in user_roles:
        role = RoleInDB(**await roles.find_one({"role_id": role_id}))
        if role.elements[element_type][f"action_{action}"]:
            return True

    # If no role is found, raise an error
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN, detail="You don't have the right to perform this action")


async def check_element_type(element_id):
    """
    Check if the element is a course, a user, a house or a collection, by checking its prefix
    """
    if element_id.startswith("course_"):
        return "courses"
    elif element_id.startswith("user_"):
        return "users"
    elif element_id.startswith("house_"):
        return "houses"
    elif element_id.startswith("org_"):
        return "organizations"
    elif element_id.startswith("coursechapter_"):
        return "coursechapters"
    elif element_id.startswith("collection_"):
        return "collections"
    elif element_id.startswith("activity_"):
        return "activities"
    else:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Issue verifying element nature")


async def check_user_role_org_with_element_org(request: Request, element_id: str, roles_list: list[str]):

    element_type = await check_element_type(element_id)
    element = request.app.db[element_type]
    roles = request.app.db["roles"]

    # get singular element type
    singular_form_element = element_type[:-1]

    element_type_id = singular_form_element + "_id"
    
    element_org = await element.find_one({element_type_id: element_id})


    for role_id in roles_list:
        role = RoleInDB(**await roles.find_one({"role_id": role_id}))
        if role.org_id == element_org["org_id"]:
            return True
        if role.org_id == "*":
            return True

        else:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN, detail="You don't have the right to perform this action")

### 🔒 Roles checking  ##############################################################
