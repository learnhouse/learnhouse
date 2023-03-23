from uuid import uuid4
from pydantic import BaseModel
import os
from fastapi import HTTPException, status, UploadFile,Request
from fastapi.responses import StreamingResponse

from src.services.users.users import PublicUser


class VideoFile(BaseModel):
    file_id: str
    file_format: str
    file_name: str
    file_size: int
    file_type: str
    lecture_id: str


async def create_video_file(request: Request,video_file: UploadFile, lecture_id: str):
    files = request.app.db["files"]

    # generate file_id
    file_id = str(f"file_{uuid4()}")

    # get file format
    file_format = video_file.filename.split(".")[-1]

    # validate file format
    if file_format not in ["mp4", "webm", "ogg"]:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Video file format not supported")

    # create file
    file = await video_file.read()

    # get file size
    file_size = len(file)

    # get file type
    file_type = video_file.content_type

    # get file name
    file_name = video_file.filename

    # create file object
    uploadable_file = VideoFile(
        file_id=file_id,
        file_format=file_format,
        file_name=file_name,
        file_size=file_size,
        file_type=file_type,
        lecture_id=lecture_id
    )

    # create folder for lecture
    if not os.path.exists(f"content/uploads/files/videos/{lecture_id}"):
        os.mkdir(f"content/uploads/files/videos/{lecture_id}")

    # upload file to server
    with open(f"content/uploads/files/videos/{lecture_id}/{file_id}.{file_format}", 'wb') as f:
        f.write(file)
        f.close()

    # insert file object into database
    video_file_in_db = await files.insert_one(uploadable_file.dict())

    if not video_file_in_db:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Video file could not be created")

    return uploadable_file


async def get_video_object(request: Request,file_id: str, current_user: PublicUser):
    photos = request.app.db["files"]

    video_file = await photos.find_one({"file_id": file_id})

    if video_file:
        video_file = VideoFile(**video_file)
        return video_file

    else:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Photo file does not exist")


async def get_video_file(request: Request,file_id: str, current_user: PublicUser):
    photos = request.app.db["files"]

    video_file = await photos.find_one({"file_id": file_id})

    # TODO : check if user has access to file

    if video_file:

        # check media type
        if video_file.format not in ["mp4", "webm", "ogg"]:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail="Video file format not supported")

        # stream file
        video_file = VideoFile(**video_file)
        file_format = video_file.file_format
        lecture_id = video_file.lecture_id

        def iterfile():  #
            #
            with open(f"content/uploads/files/videos/{lecture_id}/{file_id}.{file_format}", mode="rb") as file_like:
                yield from file_like
        return StreamingResponse(iterfile(), media_type=video_file.file_type)

    else:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Video file does not exist")
