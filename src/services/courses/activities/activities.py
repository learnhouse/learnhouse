from typing import Literal
from pydantic import BaseModel
from src.security.rbac.rbac import (
    authorization_verify_based_on_roles,
    authorization_verify_if_element_is_public,
    authorization_verify_if_user_is_anon,
)
from src.services.users.schemas.users import AnonymousUser, PublicUser
from fastapi import HTTPException, status, Request
from uuid import uuid4
from datetime import datetime

#### Classes ####################################################


class Activity(BaseModel):
    name: str
    type: str
    content: object


class ActivityInDB(Activity):
    activity_id: str
    course_id: str
    coursechapter_id: str
    org_id: str
    creationDate: str
    updateDate: str


#### Classes ####################################################


####################################################
# CRUD
####################################################


async def create_activity(
    request: Request,
    activity_object: Activity,
    org_id: str,
    coursechapter_id: str,
    current_user: PublicUser,
):
    activities = request.app.db["activities"]
    courses = request.app.db["courses"]
    users = request.app.db["users"]

    # get user
    user = await users.find_one({"user_id": current_user.user_id})

    # generate activity_id
    activity_id = str(f"activity_{uuid4()}")

    # verify activity rights
    await authorization_verify_based_on_roles(
        request,
        current_user.user_id,
        "create",
        user["roles"],
        activity_id,
    )

    # get course_id from activity
    course = await courses.find_one({"chapters": coursechapter_id})

    # create activity
    activity = ActivityInDB(
        **activity_object.dict(),
        creationDate=str(datetime.now()),
        coursechapter_id=coursechapter_id,
        updateDate=str(datetime.now()),
        activity_id=activity_id,
        org_id=org_id,
        course_id=course["course_id"],
    )
    await activities.insert_one(activity.dict())

    # update chapter
    await courses.update_one(
        {"chapters_content.coursechapter_id": coursechapter_id},
        {"$addToSet": {"chapters_content.$.activities": activity_id}},
    )

    return activity


async def get_activity(request: Request, activity_id: str, current_user: PublicUser):
    activities = request.app.db["activities"]
    courses = request.app.db["courses"]

    activity = await activities.find_one({"activity_id": activity_id})

    # get course_id from activity
    coursechapter_id = activity["coursechapter_id"]
    await courses.find_one({"chapters": coursechapter_id})

    # verify course rights
    await verify_rights(request, activity["course_id"], current_user, "read")

    if not activity:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Course does not exist"
        )

    activity = ActivityInDB(**activity)
    return activity


async def update_activity(
    request: Request,
    activity_object: Activity,
    activity_id: str,
    current_user: PublicUser,
):
    activities = request.app.db["activities"]

    activity = await activities.find_one({"activity_id": activity_id})

    # verify course rights
    await verify_rights(request, activity_id, current_user, "update")

    if activity:
        creationDate = activity["creationDate"]

        # get today's date
        datetime_object = datetime.now()

        updated_course = ActivityInDB(
            activity_id=activity_id,
            coursechapter_id=activity["coursechapter_id"],
            creationDate=creationDate,
            updateDate=str(datetime_object),
            course_id=activity["course_id"],
            org_id=activity["org_id"],
            **activity_object.dict(),
        )

        await activities.update_one(
            {"activity_id": activity_id}, {"$set": updated_course.dict()}
        )

        return ActivityInDB(**updated_course.dict())

    else:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="activity does not exist"
        )


async def delete_activity(request: Request, activity_id: str, current_user: PublicUser):
    activities = request.app.db["activities"]

    activity = await activities.find_one({"activity_id": activity_id})

    # verify course rights
    await verify_rights(request, activity_id, current_user, "delete")

    if not activity:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="activity does not exist"
        )

    # Remove Activity
    isDeleted = await activities.delete_one({"activity_id": activity_id})

    # Remove Activity from chapter
    courses = request.app.db["courses"]
    isDeletedFromChapter = await courses.update_one(
        {"chapters_content.activities": activity_id},
        {"$pull": {"chapters_content.$.activities": activity_id}},
    )

    if isDeleted and isDeletedFromChapter:
        return {"detail": "Activity deleted"}
    else:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Unavailable database",
        )


####################################################
# Misc
####################################################


async def get_activities(
    request: Request, coursechapter_id: str, current_user: PublicUser
):
    activities = request.app.db["activities"]

    activities = activities.find({"coursechapter_id": coursechapter_id})

    if not activities:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Course does not exist"
        )

    activities = [
        ActivityInDB(**activity) for activity in await activities.to_list(length=100)
    ]

    return activities


#### Security ####################################################


async def verify_rights(
    request: Request,
    activity_id: str,  # course_id in case of read
    current_user: PublicUser | AnonymousUser,
    action: Literal["create", "read", "update", "delete"],
):
    if action == "read":
        if current_user.user_id == "anonymous":
            await authorization_verify_if_element_is_public(
                request, activity_id, current_user.user_id, action
            )
        else:
            users = request.app.db["users"]
            user = await users.find_one({"user_id": current_user.user_id})

            await authorization_verify_if_user_is_anon(current_user.user_id)

            await authorization_verify_based_on_roles(
                request,
                current_user.user_id,
                action,
                user["roles"],
                activity_id,
            )
    else:
        users = request.app.db["users"]
        user = await users.find_one({"user_id": current_user.user_id})

        await authorization_verify_if_user_is_anon(current_user.user_id)

        await authorization_verify_based_on_roles(
            request,
            current_user.user_id,
            action,
            user["roles"],
            activity_id,
        )


#### Security ####################################################
