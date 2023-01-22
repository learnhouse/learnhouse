from cmath import log
from datetime import datetime
import json
from typing import List, Literal, Optional
from uuid import uuid4
from fastapi import HTTPException, Request, status
from pydantic import BaseModel

from src.services.users import PublicUser

#### Classes ####################################################


class Activity(BaseModel):
    course_id: str
    status:  Optional[Literal['ongoing', 'done', 'closed']] = 'ongoing'
    masked: Optional[bool] = False
    lectures_marked_complete: Optional[List[str]] = []
    lectures_data: Optional[List[dict]] = []


class ActivityInDB(Activity):
    activity_id: str = str(f"activity_{uuid4()}")
    user_id: str
    org_id: str
    creationDate: str = datetime.now().isoformat()
    updateDate: str = datetime.now().isoformat()


#### Classes ####################################################


async def create_activity(request: Request, user: PublicUser, activity_object: Activity):
    activities = request.app.db["activities"]

    # find if the user has already started the course
    isActivityAlreadCreated = activities.find_one(
        {"course_id": activity_object.course_id, "user_id": user.user_id})

    if isActivityAlreadCreated:
        if isActivityAlreadCreated['status'] == 'closed':
            activity_object.status = 'ongoing'
            activities.update_one(
                {"activity_id": isActivityAlreadCreated['activity_id']}, {"$set": activity_object.dict()})
            return activity_object
        else:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail="Activity already created")

    # create activity
    activity = ActivityInDB(**activity_object.dict(),
                            user_id=user.user_id, org_id=activity_object.course_id)

    activities.insert_one(activity.dict())

    return activity


async def get_user_activities(request: Request, user: PublicUser, org_id: str):
    activities = request.app.db["activities"]

    user_activities = activities.find(
        {"user_id": user.user_id, "org_id": org_id})

    if not user_activities:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="No activities found")

    return [json.loads(json.dumps(activity, default=str)) for activity in user_activities]


async def add_lecture_to_activity(request: Request, user: PublicUser, org_id: str, course_id: str, lecture_id: str):
    activities = request.app.db["activities"]
    print(lecture_id)
    course_id = f"course_{course_id}"
    lecture_id = f"lecture_{lecture_id}"
    print(lecture_id)
    activity = activities.find_one(
        {"course_id": course_id,
            "user_id": user.user_id
         },  {'_id': 0})

    if not activity:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Activity not found")

    if lecture_id not in activity['lectures_marked_complete']:
        activity['lectures_marked_complete'].append(str(lecture_id))
        activities.update_one(
            {"activity_id": activity['activity_id']}, {"$set": activity})
        return activity
    else:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Lecture already marked complete")


async def close_activity(request: Request, user: PublicUser,  activity_id: str, org_id: str,):
    activities = request.app.db["activities"]
    activity = activities.find_one(
        {"activity_id": activity_id, "user_id": user.user_id})

    if not activity:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Activity not found")

    activity['status'] = 'closed'

    activities.update_one(
        {"activity_id": activity['activity_id']}, {"$set": activity})

    activity = ActivityInDB(**activity)

    return activity
