import os
import uuid
from fastapi import Request, UploadFile
from src.services.blocks.schemas.files import BlockFile

from src.services.users.schemas.users import PublicUser


async def upload_file_and_return_file_object(request: Request, file: UploadFile, current_user: PublicUser, lecture_id: str, block_id: str):
    # get file id
    file_id = str(uuid.uuid4())

    # get file format
    file_format = file.filename.split(".")[-1]

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
        lecture_id=lecture_id
    )

    # create folder for lecture
    if not os.path.exists(f"content/uploads/files/lectures/{lecture_id}/blocks/{block_id}"):
        os.mkdir(f"content/uploads/files/lectures/{lecture_id}/blocks/{block_id}")

    # upload file to server
    with open(f"content/uploads/files/lectures/{lecture_id}/blocks/{block_id}/{file_id}.{file_format}", 'wb') as f:
        f.write(await file.read())
        f.close()
    
    # TODO: do some error handling here

    return uploadable_file