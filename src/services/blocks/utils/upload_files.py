import os
import uuid
from fastapi import HTTPException, Request, UploadFile, status
from src.services.blocks.schemas.files import BlockFile



async def upload_file_and_return_file_object(request: Request, file: UploadFile, activity_id: str, block_id: str, list_of_allowed_file_formats: list, type_of_block: str):
    # get file id
    file_id = str(uuid.uuid4())

    # get file format
    file_format = file.filename.split(".")[-1]

    # validate file format
    if file_format not in list_of_allowed_file_formats:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="File format not supported")
    
    # create file
    file_binary = await file.read()

    # get file size
    file_size = len(await file.read())

    # get file type
    file_type = file.content_type

    # get file name
    file_name = file.filename

    # create file object
    uploadable_file = BlockFile(
        file_id=file_id,
        file_format=file_format,
        file_name=file_name,
        file_size=file_size,
        file_type=file_type,
        activity_id=activity_id
    )

    # create folder for activity
    if not os.path.exists(f"content/uploads/files/activities/{activity_id}/blocks/{type_of_block}/{block_id}"):
        # create folder for activity
        os.makedirs(f"content/uploads/files/activities/{activity_id}/blocks/{type_of_block}/{block_id}")

    # upload file to server
    with open(f"content/uploads/files/activities/{activity_id}/blocks/{type_of_block}/{block_id}/{file_id}.{file_format}", 'wb') as f:
        f.write(file_binary)
        f.close()

    # TODO: do some error handling here

    return uploadable_file
