from uuid import uuid4
from pydantic import BaseModel
from fastapi import HTTPException, status, UploadFile, Request
from fastapi.responses import StreamingResponse
import os

from src.services.users import PublicUser


class PhotoFile(BaseModel):
    file_id: str
    file_format: str
    file_name: str
    file_size: int
    file_type: str
    lecture_id: str


async def create_picture_file(request: Request,picture_file: UploadFile, lecture_id: str):
    photos = request.app.db["files"]

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
        lecture_id=lecture_id
    )

    # create folder for lecture
    if not os.path.exists(f"content/uploads/files/pictures/{lecture_id}"):
        os.mkdir(f"content/uploads/files/pictures/{lecture_id}")

    # upload file to server
    with open(f"content/uploads/files/pictures/{lecture_id}/{file_id}.{file_format}", 'wb') as f:
        f.write(file)
        f.close()

    # insert file object into database
    photo_file_in_db = photos.insert_one(uploadable_file.dict())

    if not photo_file_in_db:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Photo file could not be created")

    return uploadable_file


async def get_picture_object(request: Request,file_id: str):
    photos = request.app.db["files"]

    photo_file = photos.find_one({"file_id": file_id})

    if photo_file:
        photo_file = PhotoFile(**photo_file)
        return photo_file

    else:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Photo file does not exist")


async def get_picture_file(request: Request,file_id: str, current_user: PublicUser):
    photos = request.app.db["files"]

    photo_file = photos.find_one({"file_id": file_id})

    # TODO : check if user has access to file

    if photo_file:

        # check media type
        if photo_file.format not in ["jpg", "jpeg", "png", "gif"]:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail="Photo file format not supported")

        # stream file
        photo_file = PhotoFile(**photo_file)
        file_format = photo_file.file_format
        lecture_id = photo_file.lecture_id
        file = open(
            f"content/uploads/files/pictures/{lecture_id}/{file_id}.{file_format}", 'rb')
        return StreamingResponse(file, media_type=photo_file.file_type)

    else:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Photo file does not exist")
