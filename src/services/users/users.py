from datetime import datetime
from typing import Literal
from uuid import uuid4
from fastapi import HTTPException, Request, status
from src.services.roles.schemas.roles import Role
from src.security.security import security_hash_password, security_verify_password
from src.services.users.schemas.users import PasswordChangeForm, PublicUser, User, UserOrganization, UserWithPassword, UserInDB


async def create_user(request: Request, current_user: PublicUser | None,  user_object: UserWithPassword, org_id: str):
    users = request.app.db["users"]

    isUsernameAvailable = await users.find_one({"username": user_object.username})
    isEmailAvailable = await users.find_one({"email": user_object.email})


    if isUsernameAvailable:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Username already exists")
    
    if isEmailAvailable:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Email already exists")

    # Generate user_id with uuid4
    user_id = str(f"user_{uuid4()}")

    # Check if the requesting user is authenticated
    if current_user is not None:
        # Verify rights
        await verify_user_rights_on_user(request, current_user, "create", user_id)

    # Set the username & hash the password
    user_object.username = user_object.username.lower()
    user_object.password = await security_hash_password(user_object.password)

    # Create initial orgs list with the org_id passed in
    orgs = [UserOrganization(org_id=org_id, org_role="member")]

    # Give role
    roles = ["role_1"]

    # Create the user
    user = UserInDB(user_id=user_id, creation_date=str(datetime.now()),
                    update_date=str(datetime.now()), orgs=orgs, roles=roles, **user_object.dict())

    # Insert the user into the database
    await users.insert_one(user.dict())

    return User(**user.dict())


async def read_user(request: Request, current_user: PublicUser, user_id: str):
    users = request.app.db["users"]

    # Check if the user exists
    isUserExists = await users.find_one({"user_id": user_id})

    # Verify rights
    await verify_user_rights_on_user(request, current_user, "read", user_id)

    # If the user does not exist, raise an error
    if not isUserExists:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="User does not exist")

    return User(**isUserExists)


async def update_user(request: Request,  user_id: str, user_object: User,current_user: PublicUser):
    users = request.app.db["users"]

    # Verify rights
    await verify_user_rights_on_user(request, current_user, "update", user_id)

    isUserExists = await users.find_one({"user_id": user_id})
    isUsernameAvailable = await users.find_one({"username": user_object.username})
    isEmailAvailable = await users.find_one({"email": user_object.email})

    if not isUserExists:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="User does not exist")

    # okay if username is not changed
    if isUserExists["username"] == user_object.username:
        user_object.username = user_object.username.lower()

    else:
        if isUsernameAvailable:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail="Username already used")
        
        if isEmailAvailable:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail="Email already used")

    updated_user = {"$set": user_object.dict()}
    users.update_one({"user_id": user_id}, updated_user)

    return User(**user_object.dict())



async def update_user_password(request: Request, current_user: PublicUser, user_id: str, password_change_form: PasswordChangeForm):
    users = request.app.db["users"]

    isUserExists = await users.find_one({"user_id": user_id})

    # Verify rights
    await verify_user_rights_on_user(request, current_user, "update", user_id)

    if not isUserExists:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="User does not exist")

    if not await security_verify_password(password_change_form.old_password, isUserExists["password"]):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Wrong password")

    new_password = await security_hash_password(password_change_form.new_password)

    updated_user = {"$set": {"password": new_password}}
    await users.update_one({"user_id": user_id}, updated_user)

    return {"detail": "Password updated"}


async def delete_user(request: Request, current_user: PublicUser, user_id: str):
    users = request.app.db["users"]

    isUserExists = await users.find_one({"user_id": user_id})

    # Verify is user has permission to delete the user
    await verify_user_rights_on_user(request, current_user, "delete", user_id)

    if not isUserExists:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="User does not exist")

    await users.delete_one({"user_id": user_id})

    return {"detail": "User deleted"}


# Utils & Security functions

async def security_get_user(request: Request, email: str):
    users = request.app.db["users"]

    
    user = await users.find_one({"email": email})

    if not user:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="User with Email does not exist")

    return UserInDB(**user)

async def get_userid_by_username(request: Request, username: str):
    users = request.app.db["users"]

    user = await users.find_one({"username": username})

    if not user:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="User does not exist")

    return user["user_id"]

async def get_user_by_userid(request: Request, user_id: str):
    users = request.app.db["users"]

    user = await users.find_one({"user_id": user_id})

    if not user:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="User does not exist")

    user = User(**user)
    return user

async def get_profile_metadata(request: Request, user):
    users = request.app.db["users"]
    roles = request.app.db["roles"]

    user = await users.find_one({"user_id": user['user_id']})

    if not user:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="User does not exist")

    

    return {
        "user_object": PublicUser(**user),
        "roles": "random"
    }


# Verification of the user's permissions on the roles

async def verify_user_rights_on_user(request: Request, current_user: PublicUser, action: Literal["create", "read", "update", "delete"], user_id: str):
    users = request.app.db["users"]
    user = UserInDB(**await users.find_one({"user_id": user_id}))

    if action == "create":
        return True

    if action == "read":
        if current_user.user_id == user_id:
            return True

        for org in current_user.orgs:
            if org.org_id in [org.org_id for org in user.orgs]:
                return True

        return False

    if action == "update":
        if current_user.user_id == user_id:
            return True

        for org in current_user.orgs:
            if org.org_id in [org.org_id for org in user.orgs]:

                if org.org_role == "owner":
                    return True

                # TODO: Verify user roles on the org

        return False

    if action == "delete":
        if current_user.user_id == user_id:
            return True

        for org in current_user.orgs:
            if org.org_id in [org.org_id for org in user.orgs]:

                if org.org_role == "owner":
                    return True

                # TODO: Verify user roles on the org
