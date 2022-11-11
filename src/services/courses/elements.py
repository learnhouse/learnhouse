from pydantic import BaseModel
from src.services.database import create_config_collection, check_database, create_database, learnhouseDB
from src.services.security import verify_user_rights_with_roles
from src.services.users import PublicUser, User
from fastapi import FastAPI, HTTPException, status, Request, Response, BackgroundTasks, UploadFile, File
from uuid import uuid4
from datetime import datetime

#### Classes ####################################################


class Element(BaseModel):
    name: str
    type: str
    content: object


class ElementInDB(Element):
    element_id: str
    coursechapter_id: str
    creationDate: str
    updateDate: str

#### Classes ####################################################


####################################################
# CRUD
####################################################


async def create_element(element_object: Element, coursechapter_id: str, current_user: PublicUser):
    await check_database()
    elements = learnhouseDB["elements"]
    coursechapters = learnhouseDB["coursechapters"]

    # generate element_id
    element_id = str(f"element_{uuid4()}")

    hasRoleRights = await verify_user_rights_with_roles("create", current_user.user_id, element_id)

    if not hasRoleRights:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Roles : Insufficient rights to perform this action")

    # create element
    element = ElementInDB(**element_object.dict(), creationDate=str(
        datetime.now()), coursechapter_id=coursechapter_id, updateDate=str(datetime.now()), element_id=element_id)
    elements.insert_one(element.dict())

    # update chapter
    coursechapters.update_one({"coursechapter_id": coursechapter_id}, {
                       "$addToSet": {"elements": element_id}})

    return element


async def get_element(element_id: str, current_user: PublicUser):
    await check_database()
    elements = learnhouseDB["elements"]

    element = elements.find_one({"element_id": element_id})

    # verify course rights
    hasRoleRights = await verify_user_rights_with_roles("read", current_user.user_id, element_id)

    if not hasRoleRights:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Roles : Insufficient rights to perform this action")

    if not element:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Course does not exist")

    element = ElementInDB(**element)
    return element


async def update_element(element_object: Element, element_id: str, current_user: PublicUser):
    await check_database()

    # verify course rights
    await verify_user_rights_with_roles("update", current_user.user_id, element_id)

    elements = learnhouseDB["elements"]

    element = elements.find_one({"element_id": element_id})

    if element:
        creationDate = element["creationDate"]

        # get today's date
        datetime_object = datetime.now()

        updated_course = ElementInDB(
            element_id=element_id, coursechapter_id=element["coursechapter_id"], creationDate=creationDate, updateDate=str(datetime_object), **element_object.dict())

        elements.update_one({"element_id": element_id}, {
            "$set": updated_course.dict()})

        return ElementInDB(**updated_course.dict())

    else:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Element does not exist")


async def delete_element(element_id: str, current_user: PublicUser):
    await check_database()

    # verify course rights
    await verify_user_rights_with_roles("delete", current_user.user_id, element_id)

    elements = learnhouseDB["elements"]

    element = elements.find_one({"element_id": element_id})

    if not element:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Element does not exist")

    isDeleted = elements.delete_one({"element_id": element_id})

    if isDeleted:
        return {"detail": "Element deleted"}
    else:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Unavailable database")

####################################################
# Misc
####################################################


async def get_elements(coursechapter_id: str, current_user: PublicUser):
    await check_database()
    elements = learnhouseDB["elements"]

    # verify course rights
    await verify_user_rights_with_roles("read", current_user.user_id, coursechapter_id)

    elements = elements.find({"coursechapter_id": coursechapter_id})

    if not elements:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="No elements found")

    elements_list = []

    for element in elements:
        elements_list.append(Element(**element))

    return elements_list
