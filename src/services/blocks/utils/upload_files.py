import uuid
from fastapi import HTTPException, Request, UploadFile, status
from src.services.blocks.schemas.files import BlockFile
from src.services.utils.upload_content import upload_content


async def upload_file_and_return_file_object(
    request: Request,
    file: UploadFile,
    activity_id: str,
    block_id: str,
    list_of_allowed_file_formats: list,
    type_of_block: str,
    org_id: str,
    course_id: str,
):
    # get file id
    file_id = str(uuid.uuid4())

    # get file format
    file_format = file.filename.split(".")[-1]

    # validate file format
    if file_format not in list_of_allowed_file_formats:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="File format not supported"
        )

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
        activity_id=activity_id,
    )

    await upload_content(
        f"courses/{course_id}/activities/{activity_id}/dynamic/blocks/{type_of_block}/{block_id}",
        org_id=org_id,
        file_binary=file_binary,
        file_and_format=f"{file_id}.{file_format}",
    )

    return uploadable_file
