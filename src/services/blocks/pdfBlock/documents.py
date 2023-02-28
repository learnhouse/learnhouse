from uuid import uuid4
from pydantic import BaseModel
from fastapi import HTTPException, status, UploadFile, Request
from fastapi.responses import StreamingResponse
import os

from src.services.users import PublicUser


class DocumentFile(BaseModel):
    file_id: str
    file_format: str
    file_name: str
    file_size: int
    file_type: str
    lecture_id: str


async def create_document_file(request: Request, document_file: UploadFile, lecture_id: str):
    documents = request.app.db["files"]

    # generate file_id
    file_id = str(f"file_{uuid4()}")

    # get file format
    file_format = document_file.filename.split(".")[-1]

    # validate file format
    if file_format not in ["pdf"]:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Document file format not supported")

    # create file
    file = await document_file.read()

    # get file size
    file_size = len(file)

    # get file type
    file_type = document_file.content_type

    # get file name
    file_name = document_file.filename

    # create file object
    uploadable_file = DocumentFile(
        file_id=file_id,
        file_format=file_format,
        file_name=file_name,
        file_size=file_size,
        file_type=file_type,
        lecture_id=lecture_id
    )
    # TODO : this is probably not working as intended
    # create folder for lecture
    if not os.path.exists(f"content/uploads/files/documents/{lecture_id}"):
        os.mkdir(f"content/uploads/files/documents/{lecture_id}")

    # upload file to server
    with open(f"content/uploads/files/documents/{lecture_id}/{file_id}.{file_format}", 'wb') as f:
        f.write(file)
        f.close()

    # insert file object into database
    document_file_in_db = await documents.insert_one(uploadable_file.dict())

    if not document_file_in_db:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Document file could not be created")

    return uploadable_file


async def get_document_object(request: Request, file_id: str):
    documents = request.app.db["files"]

    document_file = await documents.find_one({"file_id": file_id})

    if document_file:
        document_file = DocumentFile(**document_file)
        return document_file

    else:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Document file does not exist")


async def get_document_file(request: Request, file_id: str, current_user: PublicUser):
    documents = request.app.db["files"]

    document_file = await documents.find_one({"file_id": file_id})

    # TODO : check if user has access to file

    if document_file:

        # check media type
        if document_file.format not in ["pdf"]:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail="Document file format not supported")

        # stream file
        document_file = DocumentFile(**document_file)
        file_format = document_file.file_format
        lecture_id = document_file.lecture_id
        file = open(
            f"content/uploads/files/documents/{lecture_id}/{file_id}.{file_format}", 'rb')
        return StreamingResponse(file, media_type=document_file.file_type)

    else:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Document file does not exist")
