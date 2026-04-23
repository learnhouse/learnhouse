from datetime import datetime
from uuid import uuid4
from src.db.organizations import Organization
from fastapi import HTTPException, status, UploadFile, Request
from sqlmodel import Session, select
from src.db.courses.activities import Activity
from src.db.courses.blocks import Block, BlockRead, BlockTypeEnum
from src.db.courses.courses import Course
from src.db.users import AnonymousUser, PublicUser
from src.security.org_auth import is_org_member
from src.security.rbac import check_resource_access, AccessAction
from src.services.blocks.utils.upload_files import upload_file_and_return_file_object


async def create_pdf_block(
    request: Request, pdf_file: UploadFile, activity_uuid: str, db_session: Session,
    current_user: PublicUser | AnonymousUser = None,
):
    statement = select(Activity).where(Activity.activity_uuid == activity_uuid)
    activity = db_session.exec(statement).first()

    if not activity:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Activity not found"
        )

    block_type = "pdfBlock"

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
        pdf_file,
        activity_uuid,
        block_uuid,
        ["pdf"],
        block_type,
        org.org_uuid,
        str(course.course_uuid),
    )

    # create block
    block = Block(
        activity_id=activity.id if activity.id else 0,
        block_type=BlockTypeEnum.BLOCK_DOCUMENT_PDF,
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


async def get_pdf_block(
    request: Request, block_uuid: str, current_user: PublicUser | AnonymousUser, db_session: Session
):
    statement = select(Block).where(Block.block_uuid == block_uuid)
    block = db_session.exec(statement).first()

    if not block:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="PDF block does not exist"
        )

    # SECURITY: enforce RBAC on the owning course so the block UUID does not
    # act as a capability token across organizations.
    activity = db_session.exec(
        select(Activity).where(Activity.id == block.activity_id)
    ).first()
    if not activity:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="PDF block does not exist"
        )
    course = db_session.exec(
        select(Course).where(Course.id == activity.course_id)
    ).first()
    if not course:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="PDF block does not exist"
        )
    await check_resource_access(
        request, db_session, current_user, course.course_uuid, AccessAction.READ
    )

    if not course.public and isinstance(current_user, PublicUser):
        if not is_org_member(current_user.id, block.org_id, db_session):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You do not have access to this resource",
            )

    return BlockRead.model_validate(block)
