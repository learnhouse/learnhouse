from datetime import datetime
from uuid import uuid4
from src.db.organizations import Organization
from fastapi import HTTPException, status, UploadFile, Request
from sqlmodel import Session, select
from src.db.courses.activities import Activity
from src.db.courses.blocks import Block, BlockRead, BlockTypeEnum
from src.db.courses.courses import Course
from src.db.users import AnonymousUser, PublicUser
from src.security.rbac import check_resource_access, AccessAction
from src.services.blocks.utils.upload_files import upload_file_and_return_file_object


async def create_audio_block(
    request: Request, audio_file: UploadFile, activity_uuid: str, db_session: Session,
    current_user: PublicUser | AnonymousUser = None,
):
    statement = select(Activity).where(Activity.activity_uuid == activity_uuid)
    activity = db_session.exec(statement).first()

    if not activity:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Activity not found"
        )

    block_type = "audioBlock"

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

    if current_user:
        await check_resource_access(request, db_session, current_user, course.course_uuid, AccessAction.UPDATE)

    # get block id
    block_uuid = str(f"block_{uuid4()}")

    block_data = await upload_file_and_return_file_object(
        request,
        audio_file,
        activity_uuid,
        block_uuid,
        ["mp3", "wav", "ogg", "m4a"],
        block_type,
        org.org_uuid,
        str(course.course_uuid),
    )

    # create block
    block = Block(
        activity_id=activity.id if activity.id else 0,
        block_type=BlockTypeEnum.BLOCK_AUDIO,
        content=block_data.model_dump(),
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

    block = BlockRead.model_validate(block)

    return block


async def get_audio_block(
    request: Request, block_uuid: str, current_user: PublicUser, db_session: Session
):
    statement = select(Block).where(Block.block_uuid == block_uuid)
    block = db_session.exec(statement).first()

    if not block:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Audio file does not exist"
        )

    block = BlockRead.model_validate(block)

    return block
