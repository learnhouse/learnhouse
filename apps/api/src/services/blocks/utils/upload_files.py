import uuid
from fastapi import HTTPException, Request, UploadFile, status
from src.services.blocks.schemas.files import BlockFile
from src.services.utils.upload_content import upload_file


async def upload_file_and_return_file_object(
    request: Request,
    file: UploadFile,
    activity_uuid: str,
    block_id: str,
    list_of_allowed_file_formats: list,
    type_of_block: str,
    org_uuid: str,
    course_uuid: str,
):
    """Upload file for blocks."""
    file_id = str(uuid.uuid4())
    
    # Map legacy format list to type system
    allowed_types = []
    if any(fmt in ['jpg', 'jpeg', 'png', 'gif', 'webp'] for fmt in list_of_allowed_file_formats):
        allowed_types.append('image')
    if any(fmt in ['mp4', 'webm'] for fmt in list_of_allowed_file_formats):
        allowed_types.append('video')
    if any(fmt in ['pdf'] for fmt in list_of_allowed_file_formats):
        allowed_types.append('document')
    
    if not allowed_types:
        raise HTTPException(status_code=400, detail="No valid file types specified")

    # Upload file
    filename = await upload_file(
        file=file,
        directory=f"courses/{course_uuid}/activities/{activity_uuid}/dynamic/blocks/{type_of_block}/{block_id}",
        type_of_dir='orgs',
        uuid=org_uuid,
        allowed_types=allowed_types,
        filename_prefix=f"block_{file_id}",
        max_size=50 * 1024 * 1024  # 50MB
    )

    # Get file metadata
    file.file.seek(0)
    content = await file.read()
    ext = filename.split(".")[-1] if "." in filename else "bin"

    return BlockFile(
        file_id=file_id,
        file_format=ext,
        file_name=file.filename,
        file_size=len(content),
        file_type=file.content_type,
        activity_uuid=activity_uuid,
    )
