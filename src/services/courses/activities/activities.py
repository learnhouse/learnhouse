from pydantic import BaseModel
from src.security.security import verify_user_rights_with_roles
from src.services.users.schemas.users import PublicUser
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
    coursechapter_id: str
    org_id: str
    creationDate: str
    updateDate: str

#### Classes ####################################################


####################################################
# CRUD
####################################################


async def create_activity(request: Request, activity_object: Activity, org_id: str, coursechapter_id: str, current_user: PublicUser):
    activities = request.app.db["activities"]
    courses = request.app.db["courses"]

    # generate activity_id
    activity_id = str(f"activity_{uuid4()}")

    hasRoleRights = await verify_user_rights_with_roles(request, "create", current_user.user_id, activity_id, org_id)

    if not hasRoleRights:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Roles : Insufficient rights to perform this action")

    # create activity
    activity = ActivityInDB(**activity_object.dict(), creationDate=str(
        datetime.now()), coursechapter_id=coursechapter_id, updateDate=str(datetime.now()), activity_id=activity_id, org_id=org_id)
    await activities.insert_one(activity.dict())

    # update chapter
    await courses.update_one({"chapters_content.coursechapter_id": coursechapter_id}, {
        "$addToSet": {"chapters_content.$.activities": activity_id}})

    return activity


async def get_activity(request: Request, activity_id: str, current_user: PublicUser):
    activities = request.app.db["activities"]

    activity = await activities.find_one({"activity_id": activity_id})

    # verify course rights
    hasRoleRights = await verify_user_rights_with_roles(request, "read", current_user.user_id, activity_id, element_org_id=activity["org_id"])

    if not hasRoleRights:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Roles : Insufficient rights to perform this action")

    if not activity:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Course does not exist")

    activity = ActivityInDB(**activity)
    return activity


async def update_activity(request: Request, activity_object: Activity, activity_id: str, current_user: PublicUser):

    activities = request.app.db["activities"]

    activity = await activities.find_one({"activity_id": activity_id})
    # verify course rights
    await verify_user_rights_with_roles(request, "update", current_user.user_id, activity_id, element_org_id=activity["org_id"])

    if activity:
        creationDate = activity["creationDate"]

        # get today's date
        datetime_object = datetime.now()

        updated_course = ActivityInDB(
            activity_id=activity_id, coursechapter_id=activity["coursechapter_id"], creationDate=creationDate, updateDate=str(datetime_object), org_id=activity["org_id"], **activity_object.dict())

        await activities.update_one({"activity_id": activity_id}, {
            "$set": updated_course.dict()})

        return ActivityInDB(**updated_course.dict())

    else:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="activity does not exist")


async def delete_activity(request: Request, activity_id: str, current_user: PublicUser):

    activities = request.app.db["activities"]

    activity = await activities.find_one({"activity_id": activity_id})

    # verify course rights
    await verify_user_rights_with_roles(request, "delete", current_user.user_id, activity_id, element_org_id=activity["org_id"])

    if not activity:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="activity does not exist")

    isDeleted = await activities.delete_one({"activity_id": activity_id})

    if isDeleted:
        return {"detail": "activity deleted"}
    else:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Unavailable database")

####################################################
# Misc
####################################################


async def get_activities(request: Request, coursechapter_id: str,  current_user: PublicUser):
    activities = request.app.db["activities"]

    # TODO : TERRIBLE SECURITY ISSUE HERE, NEED TO FIX ASAP
    # TODO : TERRIBLE SECURITY ISSUE HERE, NEED TO FIX ASAP
    # TODO : TERRIBLE SECURITY ISSUE HERE, NEED TO FIX ASAP

    activities = activities.find({"coursechapter_id": coursechapter_id})

    if not activities:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Course does not exist")

    activities = [ActivityInDB(**activity) for activity in await activities.to_list(length=100)]

    return activities
