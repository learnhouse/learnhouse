from datetime import datetime
from typing import List, Literal, Optional
from uuid import uuid4
from fastapi import HTTPException, Request, status
from pydantic import BaseModel
from src.services.courses.chapters import get_coursechapters_meta
from src.services.orgs.orgs import PublicOrganization

from src.services.users.users import PublicUser

#### Classes ####################################################


class ActivityData(BaseModel):
    activity_id: str
    activity_type: str
    data: Optional[dict]


class TrailCourse(BaseModel):
    course_id: str
    elements_type: Optional[Literal["course"]] = "course"
    status: Optional[Literal["ongoing", "done", "closed"]] = "ongoing"
    course_object: dict
    masked: Optional[bool] = False
    activities_marked_complete: Optional[List[str]]
    activities_data: Optional[List[ActivityData]]
    progress: Optional[int]


class Trail(BaseModel):
    status: Optional[Literal["ongoing", "done", "closed"]] = "ongoing"
    masked: Optional[bool] = False
    courses: Optional[List[TrailCourse]]


class TrailInDB(Trail):
    trail_id: str
    org_id: str
    user_id: str
    creationDate: str = datetime.now().isoformat()
    updateDate: str = datetime.now().isoformat()


#### Classes ####################################################


async def create_trail(
    request: Request, user: PublicUser, org_id: str, trail_object: Trail
) -> Trail:
    trails = request.app.db["trails"]

    # get list of courses
    if trail_object.courses:
        courses = trail_object.courses
        # get course ids
        course_ids = [course.course_id for course in courses]

        # find if the user has already started the course
        existing_trail = await trails.find_one(
            {"user_id": user.user_id, "courses.course_id": {"$in": course_ids}}
        )
        if existing_trail:
            # update the status of the element with the matching course_id to "ongoing"
            for element in existing_trail["courses"]:
                if element["course_id"] in course_ids:
                    element["status"] = "ongoing"
            # update the existing trail in the database
            await trails.replace_one(
                {"trail_id": existing_trail["trail_id"]}, existing_trail
            )

    # create trail id
    trail_id = f"trail_{uuid4()}"

    # create trail
    trail = TrailInDB(
        **trail_object.dict(), trail_id=trail_id, user_id=user.user_id, org_id=org_id
    )

    await trails.insert_one(trail.dict())

    return trail


async def get_user_trail(request: Request, org_slug: str, user: PublicUser) -> Trail:
    trails = request.app.db["trails"]
    trail = await trails.find_one({"user_id": user.user_id})
    if not trail:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Trail not found"
        )
    for element in trail["courses"]:
        course_id = element["course_id"]
        chapters_meta = await get_coursechapters_meta(request, course_id, user)
        activities = chapters_meta["activities"]
        num_activities = len(activities)

        num_completed_activities = len(element.get("activities_marked_complete", []))
        element["progress"] = (
            round((num_completed_activities / num_activities) * 100, 2)
            if num_activities > 0
            else 0
        )

    return Trail(**trail)


async def get_user_trail_with_orgslug(
    request: Request, user: PublicUser, org_slug: str
) -> Trail:
    trails = request.app.db["trails"]
    orgs = request.app.db["organizations"]
    courses_mongo = request.app.db["courses"]

    # get org_id from orgslug
    org = await orgs.find_one({"slug": org_slug})

    trail = await trails.find_one({"user_id": user.user_id, "org_id": org["org_id"]})

    if not trail:
        return Trail(masked=False, courses=[])

    course_ids = [course["course_id"] for course in trail["courses"]]

    live_courses = await courses_mongo.find({"course_id": {"$in": course_ids}}).to_list(
        length=None
    )

    for course in trail["courses"]:
        course_id = course["course_id"]

        if course_id not in [course["course_id"] for course in live_courses]:
            course["masked"] = True
            continue

        chapters_meta = await get_coursechapters_meta(request, course_id, user)
        activities = chapters_meta["activities"]

        # get course object without _id
        course_object = await courses_mongo.find_one(
            {"course_id": course_id}, {"_id": 0}
        )

        course["course_object"] = course_object
        num_activities = len(activities)

        num_completed_activities = len(course.get("activities_marked_complete", []))
        course["progress"] = (
            round((num_completed_activities / num_activities) * 100, 2)
            if num_activities > 0
            else 0
        )

    return Trail(**trail)


async def add_activity_to_trail(
    request: Request, user: PublicUser, course_id: str, org_slug: str, activity_id: str
) -> Trail:
    trails = request.app.db["trails"]
    orgs = request.app.db["organizations"]
    courseid = "course_" + course_id
    activityid = "activity_" + activity_id

    # get org_id from orgslug
    org = await orgs.find_one({"slug": org_slug})
    org_id = org["org_id"]

    # find a trail with the user_id and course_id in the courses array
    trail = await trails.find_one(
        {"user_id": user.user_id, "courses.course_id": courseid, "org_id": org_id}
    )

    if user.user_id == "anonymous":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Anonymous users cannot add activity to trail",
        )

    if not trail:
        return Trail(masked=False, courses=[])

    # if a trail has course_id in the courses array, then add the activity_id to the activities_marked_complete array
    for element in trail["courses"]:
        if element["course_id"] == courseid:
            if "activities_marked_complete" in element:
                # check if activity_id is already in the array
                if activityid not in element["activities_marked_complete"]:
                    element["activities_marked_complete"].append(activityid)
                else:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail="Activity already marked complete",
                    )
            else:
                element["activities_marked_complete"] = [activity_id]

    # modify trail object
    await trails.replace_one({"trail_id": trail["trail_id"]}, trail)

    return Trail(**trail)


async def add_course_to_trail(
    request: Request, user: PublicUser, orgslug: str, course_id: str
) -> Trail:
    trails = request.app.db["trails"]
    orgs = request.app.db["organizations"]

    if user.user_id == "anonymous":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Anonymous users cannot add activity to trail",
        )

    org = await orgs.find_one({"slug": orgslug})

    org = PublicOrganization(**org)

    trail = await trails.find_one({"user_id": user.user_id, "org_id": org["org_id"]})

    if not trail:
        trail_to_insert = TrailInDB(
            trail_id=f"trail_{uuid4()}",
            user_id=user.user_id,
            org_id=org["org_id"],
            courses=[],
        )
        trail_to_insert = await trails.insert_one(trail_to_insert.dict())

        trail = await trails.find_one({"_id": trail_to_insert.inserted_id})

    # check if course is already present in the trail
    for element in trail["courses"]:
        if element["course_id"] == course_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Course already present in the trail",
            )

    updated_trail = TrailCourse(
        course_id=course_id,
        activities_data=[],
        activities_marked_complete=[],
        progress=0,
        course_object={},
        status="ongoing",
        masked=False,
    )
    trail["courses"].append(updated_trail.dict())
    await trails.replace_one({"trail_id": trail["trail_id"]}, trail)
    return Trail(**trail)


async def remove_course_from_trail(
    request: Request, user: PublicUser, orgslug: str, course_id: str
) -> Trail:
    trails = request.app.db["trails"]
    orgs = request.app.db["organizations"]

    if user.user_id == "anonymous":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Anonymous users cannot add activity to trail",
        )

    org = await orgs.find_one({"slug": orgslug})

    org = PublicOrganization(**org)
    trail = await trails.find_one({"user_id": user.user_id, "org_id": org["org_id"]})

    if not trail:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Trail not found"
        )

    # check if course is already present in the trail

    for element in trail["courses"]:
        if element["course_id"] == course_id:
            trail["courses"].remove(element)
            break

    await trails.replace_one({"trail_id": trail["trail_id"]}, trail)
    return Trail(**trail)
