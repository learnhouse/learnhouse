from uuid import uuid4
from pydantic import BaseModel
from src.services.database import check_database,  learnhouseDB, learnhouseDB
from fastapi import HTTPException, status, UploadFile
from fastapi.responses import StreamingResponse
import os

from src.services.users import PublicUser


class PhotoFile(BaseModel):
    file_id: str
    file_format: str
    file_name: str
    file_size: int
    file_type: str
    element_id: str


async def create_picture_file(picture_file: UploadFile, element_id: str):
    await check_database()
    photos = learnhouseDB["files"]

    # generate file_id
    file_id = str(f"file_{uuid4()}")

    # get file format
    file_format = picture_file.filename.split(".")[-1]

    # validate file format
    if file_format not in ["jpg", "jpeg", "png", "gif"]:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Picture file format not supported")

    # create file
    file = await picture_file.read()
    

    # get file size
    file_size = len(file)

    # get file type
    file_type = picture_file.content_type

    # get file name
    file_name = picture_file.filename

    # create file object
    uploadable_file = PhotoFile(
        file_id=file_id,
        file_format=file_format,
        file_name=file_name,
        file_size=file_size,
        file_type=file_type,
        element_id=element_id
    )

    # create folder for element
    if not os.path.exists(f"content/uploads/files/pictures/{element_id}"):
        os.mkdir(f"content/uploads/files/pictures/{element_id}")

    # upload file to server
    with open(f"content/uploads/files/pictures/{element_id}/{file_id}.{file_format}", 'wb') as f:
        f.write(file)
        f.close()

    # insert file object into database
    photo_file_in_db = photos.insert_one(uploadable_file.dict())

    if not photo_file_in_db:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Photo file could not be created")

    return uploadable_file


async def get_picture_object(file_id: str):
    await check_database()
    photos = learnhouseDB["files"]

    photo_file = photos.find_one({"file_id": file_id})

    if photo_file:
        photo_file = PhotoFile(**photo_file)
        return photo_file

    else:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Photo file does not exist")


async def get_picture_file(file_id: str, current_user: PublicUser):
    await check_database()
    photos = learnhouseDB["files"]

    photo_file = photos.find_one({"file_id": file_id})

    # check media type 
    if photo_file.format not in ["jpg", "jpeg", "png", "gif"]:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Photo file format not supported")
            
    # TODO : check if user has access to file

    if photo_file:
        # stream file
        photo_file = PhotoFile(**photo_file)
        file_format = photo_file.file_format
        element_id = photo_file.element_id
        file = open(
            f"content/uploads/files/pictures/{element_id}/{file_id}.{file_format}", 'rb')
        return StreamingResponse(file, media_type=photo_file.file_type)

    else:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Photo file does not exist")
