from datetime import datetime
from uuid import uuid4
from src.db.organizations import Organization
from fastapi import HTTPException, status, UploadFile, Request
from sqlmodel import Session, select
from src.db.activities import Activity
from src.db.blocks import Block, BlockRead, BlockTypeEnum
from src.db.courses import Course
from src.services.blocks.utils.upload_files import upload_file_and_return_file_object
from src.services.users.users import PublicUser


async def create_image_block(
    request: Request, image_file: UploadFile, activity_uuid: str, db_session: Session
):
    statement = select(Activity).where(Activity.activity_uuid == activity_uuid)
    activity = db_session.exec(statement).first()

    if not activity:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Activity not found"
        )

    block_type = "imageBlock"

    # get org_uuid 
    statement = select(Organization).where(Organization.id == activity.org_id)
    org = db_session.exec(statement).first()

    # get course
    statement = select(Course).where(Course.id == activity.course_id)
    course = db_session.exec(statement).first()

    if not course:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Course not found"
        )

    # get block id
    block_uuid = str(f"block_{uuid4()}")

    block_data = await upload_file_and_return_file_object(
        request,
        image_file,
        activity_uuid,
        block_uuid,
        ["jpg", "jpeg", "png", "gif", "webp"],
        block_type,
        org.org_uuid,
        str(course.course_uuid),
    )
    
    # create block
    block = Block(
        activity_id=activity.id if activity.id else 0,
        block_type=BlockTypeEnum.BLOCK_IMAGE,
        content=block_data.dict(),
        org_id=org.id if org.id else 0,
        course_id=course.id if course.id else 0,
        block_uuid=block_uuid,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )

    # insert block
    db_session.add(block)
    db_session.commit()
    db_session.refresh(block)

    block = BlockRead.from_orm(block)

    return block


async def get_image_block(
    request: Request, block_uuid: str, current_user: PublicUser, db_session: Session
):
    statement = select(Block).where(Block.block_uuid == block_uuid)
    block = db_session.exec(statement).first()

    if block:

        block = BlockRead.from_orm(block)
        
        return block
    else:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Image block does not exist"
        )
