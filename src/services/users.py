from uuid import uuid4
from pydantic import BaseModel
from src.services.database import check_database,  learnhouseDB, learnhouseDB
from src.services.security import *
from fastapi import HTTPException, status
from datetime import datetime

#### Classes ####################################################


class User(BaseModel):
    username: str
    email: str
    full_name: str | None = None
    disabled: bool | None = None
    avatar_url: str | None = None
    verified: bool
    user_type: str
    bio: str | None = None


class UserWithPassword(User):
    password: str


class PublicUser(User):
    user_id: str
    creationDate: str
    updateDate: str


class UserInDB(UserWithPassword):
    user_id: str
    password: str
    creationDate: str
    updateDate: str

#### Classes ####################################################

# TODO : user actions security


async def get_user(username: str):
    check_database()
    users = learnhouseDB["users"]

    user = users.find_one({"username": username})

    if not user:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="User does not exist")

    user = User(**user)
    return user


async def get_user_by_userid(user_id: str):
    check_database()
    users = learnhouseDB["users"]

    user = users.find_one({"user_id": user_id})

    if not user:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="User does not exist")

    user = User(**user)
    return user


async def security_get_user(username: str):
    check_database()
    users = learnhouseDB["users"]

    user = users.find_one({"username": username})

    if not user:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="User does not exist")

    return UserInDB(**user)


async def get_userid_by_username(username: str):
    check_database()
    users = learnhouseDB["users"]

    user = users.find_one({"username": username})

    if not user:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="User does not exist")

    return user["user_id"]


async def update_user(user_id: str, user_object: UserWithPassword):
    check_database()
    users = learnhouseDB["users"]

    isUserExists = users.find_one({"user_id": user_id})
    isUsernameAvailable = users.find_one({"username": user_object.username})

    if not isUserExists:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="User does not exist")

    if isUsernameAvailable:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Username already used")

    user_object.password = await security_hash_password(user_object.password)

    updated_user = {"$set": user_object.dict()}
    users.update_one({"user_id": user_id}, updated_user)

    return User(**user_object.dict())


async def delete_user(user_id: str):
    check_database()
    users = learnhouseDB["users"]

    isUserAvailable = users.find_one({"user_id": user_id})

    if not isUserAvailable:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="User does not exist")

    users.delete_one({"user_id": user_id})

    return {"detail": "User deleted"}


async def create_user(user_object: UserWithPassword):
    check_database()
    users = learnhouseDB["users"]

    isUserAvailable = users.find_one({"username": user_object.username})

    if isUserAvailable:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Username already exists")

    # generate house_id with uuid4
    user_id = str(f"user_{uuid4()}")

    # lowercase username
    user_object.username = user_object.username.lower()

    user_object.password = await security_hash_password(user_object.password)

    user = UserInDB(user_id=user_id, creationDate=str(datetime.now()),
                    updateDate=str(datetime.now()), **user_object.dict())

    user_in_db = users.insert_one(user.dict())

    return User(**user.dict())
