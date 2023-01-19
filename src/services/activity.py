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
    chapters_marked_complete: Optional[List[str]]
    chapters_data: Optional[List[dict]]


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
    isActivityAlreadyStarted = activities.find_one(
        {"course_id": activity_object.course_id, "user_id": user.user_id})

    if isActivityAlreadyStarted:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Activity already started")

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


async def add_chapter_to_activity(request: Request, user: PublicUser, org_id: str, course_id: str, chapter_id: str):
    activities = request.app.db["activities"]

    activity = activities.find_one(
        {"course_id": course_id,
            "user_id": user.user_id,
            "org_id": org_id
         })

    if not activity:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Activity not found")

    if chapter_id in activity['chapters_marked_complete']:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Chapter already marked complete")

    activity['chapters_marked_complete'].append(chapter_id)

    activities.update_one(
        {"activity_id": activity['activity_id']}, {"$set": activity})

    # send 200 custom message
    return {"message": "Chapter added to activity"}


async def close_activity(request: Request, user: PublicUser, org_id: str, activity_id: str):
    activities = request.app.db["activities"]

    activity = activities.find_one(
        {"activity_id": activity_id, "user_id": user.user_id, "org_id": org_id})

    if not activity:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Activity not found")

    activity['status'] = 'closed'

    activities.update_one(
        {"activity_id": activity['activity_id']}, {"$set": activity})

    activity = ActivityInDB(**activity)

    return activity
