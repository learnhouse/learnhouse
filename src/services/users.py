from pydantic import BaseModel
from ..services.database import check_database,  learnhouseDB, learnhouseDB
from ..services.security import *
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
    created_date: str
    user_type: str
    bio: str | None = None


class UserInDB(User):
    password: str

#### Classes ####################################################


async def get_user(username: str):
    check_database()
    users = learnhouseDB["users"]

    user = users.find_one({"username": username})

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


async def update_user(user_object: UserInDB):
    check_database()
    users = learnhouseDB["users"]

    isUserAvailable = users.find_one({"username": user_object.username})

    if not isUserAvailable:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="User does not exist")

    user_object.password = await security_hash_password(user_object.password)

    updated_user = {"$set": user_object.dict()}
    users.update_one({"username": user_object.username}, updated_user)

    return User(**user_object.dict())


async def delete_user(username: str):
    check_database()
    users = learnhouseDB["users"]

    isUserAvailable = users.find_one({"username": username})

    if not isUserAvailable:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="User does not exist")

    users.delete_one({"username": username})

    return {"detail": "User deleted"}


async def create_user(user_object: UserInDB):
    check_database()
    users = learnhouseDB["users"]

    isUserAvailable = users.find_one({"username": user_object.username})

    if isUserAvailable:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="User already exists")

    # lowercase username
    user_object.username = user_object.username.lower()

    user_object.created_date = str(datetime.now())

    user_object.password = await security_hash_password(user_object.password)

    users.insert_one(user_object.dict())

    return User(**user_object.dict())
