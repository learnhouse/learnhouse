from fastapi import HTTPException, status, Request
from passlib.context import CryptContext
from passlib.hash import pbkdf2_sha256

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


async def verify_user_rights_with_roles(request: Request,action: str, user_id: str, element_id: str):
    """
    Check if the user has the right to perform the action on the element
    """
    roles = request.app.db["roles"]

    # find data where user_id is in linked_users or * is in linked_users
    user_roles_cursor = roles.find({"$or": [{"linked_users": user_id}, {"linked_users": "*"}]})

    

    user_roles = []

    # Info: permission actions are: read, create, delete, update

    for role in await user_roles_cursor.to_list(length=100):
        user_roles.append(role)

    for role in user_roles:
        for policy in role['policies']:
            element = policy["elements"][await check_element_type(element_id)]
            permission_state = policy["permissions"][f'action_{action}']

            ##
            if ("*" in element or element_id in element) and (permission_state is True):
                return True
            else:
                return False


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
    elif element_id.startswith("lecture_"):
        return "lectures"
    else:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Issue verifying element nature")


### 🔒 Roles checking  ##############################################################
