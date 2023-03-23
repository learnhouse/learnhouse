from uuid import uuid4
from pydantic import BaseModel
from fastapi import HTTPException, status, UploadFile, Request
from fastapi.responses import StreamingResponse
import os
from src.services.blocks.schemas.blocks import Block
from src.services.blocks.utils.upload_files import upload_file_and_return_file_object

from src.services.users.users import PublicUser


async def create_pdf_block(request: Request, pdf_file: UploadFile, lecture_id: str):
    blocks = request.app.db["blocks"]
    lecture = request.app.db["lectures"]

    block_type = "pdfBlock"

    # get org_id from lecture
    lecture = await lecture.find_one({"lecture_id": lecture_id}, {"_id": 0, "org_id": 1})
    org_id = lecture["org_id"]

    # get block id
    block_id = str(f"block_{uuid4()}")

    block_data = await upload_file_and_return_file_object(request, pdf_file,  lecture_id, block_id, ["pdf"], block_type)

    # create block
    block = Block(block_id=block_id, lecture_id=lecture_id,
                  block_type=block_type, block_data=block_data, org_id=org_id)

    # insert block
    await blocks.insert_one(block.dict())

    return block


async def get_pdf_block(request: Request, file_id: str, current_user: PublicUser):
    blocks = request.app.db["blocks"]

    pdf_block = await blocks.find_one({"block_id": file_id})

    if pdf_block:
        return Block(**pdf_block)

    else:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Video file does not exist")
