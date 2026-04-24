from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlmodel import Session, select
from src.core.events.database import get_db_session
from src.db.courses.chapters import (
    Chapter,
    ChapterCreate,
    ChapterRead,
    ChapterUpdate,
    ChapterUpdateOrder,
)
from src.db.usergroup_resources import UserGroupResource
from src.services.courses.chapters import (
    DEPRECEATED_get_course_chapters,
    create_chapter,
    delete_chapter,
    get_chapter,
    get_course_chapters,
    reorder_chapters_and_activities,
    update_chapter,
)
from src.services.courses.lock_usergroups import (
    add_usergroup_to_chapter,
    get_chapter_usergroups,
    remove_usergroup_from_chapter,
)

from src.services.users.users import PublicUser
from src.security.auth import get_current_user

router = APIRouter()


@router.post(
    "/",
    response_model=ChapterRead,
    summary="Create chapter",
    description="Create a new chapter inside an existing course.",
    responses={
        200: {"description": "Chapter created successfully", "model": ChapterRead},
        403: {"description": "User lacks permission to create chapters on this course"},
        404: {"description": "Course not found"},
        422: {"description": "Invalid chapter payload"},
    },
)
async def api_create_coursechapter(
    request: Request,
    coursechapter_object: ChapterCreate,
    current_user: PublicUser = Depends(get_current_user),
    db_session=Depends(get_db_session),
) -> ChapterRead:
    """
    Create new Course Chapter
    """
    return await create_chapter(request, coursechapter_object, current_user, db_session)


@router.get(
    "/{chapter_id}",
    response_model=ChapterRead,
    summary="Get chapter by ID",
    description="Retrieve a single chapter by its numeric ID.",
    responses={
        200: {"description": "Chapter retrieved successfully", "model": ChapterRead},
        403: {"description": "User lacks read access to this chapter"},
        404: {"description": "Chapter not found"},
        409: {"description": "Chapter does not exist"},
    },
)
async def api_get_coursechapter(
    request: Request,
    chapter_id: int,
    current_user: PublicUser = Depends(get_current_user),
    db_session=Depends(get_db_session),
) -> ChapterRead:
    """
    Get single CourseChapter by chapter_id
    """
    return await get_chapter(request, chapter_id, current_user, db_session)


@router.get(
    "/course/{course_uuid}/meta",
    deprecated=True,
    summary="Get chapters metadata (deprecated)",
    description="Deprecated endpoint returning chapter metadata for a course. Use /course/{course_uuid}/meta on the courses router instead.",
    responses={
        200: {"description": "Chapter metadata"},
        403: {"description": "User lacks read access to the course"},
        404: {"description": "Course not found"},
    },
)
async def api_get_chapter_meta(
    request: Request,
    course_uuid: str,
    current_user: PublicUser = Depends(get_current_user),
    db_session=Depends(get_db_session),
):
    """
    Get Chapters metadata
    """
    return await DEPRECEATED_get_course_chapters(
        request, course_uuid, current_user, db_session
    )


@router.put(
    "/course/{course_uuid}/order",
    summary="Reorder chapters and activities",
    description="Update the ordering of chapters and the activities nested inside them for a given course.",
    responses={
        200: {"description": "Order updated successfully"},
        403: {"description": "User lacks permission to modify this course"},
        404: {"description": "Course not found"},
        409: {"description": "Course does not exist"},
        422: {"description": "Invalid order payload"},
    },
)
async def api_update_chapter_meta(
    request: Request,
    course_uuid: str,
    order: ChapterUpdateOrder,
    current_user: PublicUser = Depends(get_current_user),
    db_session=Depends(get_db_session),
):
    """
    Update Chapter metadata
    """
    return await reorder_chapters_and_activities(
        request, course_uuid, order, current_user, db_session
    )


@router.get(
    "/course/{course_id}/page/{page}/limit/{limit}",
    response_model=List[ChapterRead],
    summary="List course chapters",
    description="Paginated list of chapters for the specified course.",
    responses={
        200: {"description": "Paginated list of chapters", "model": List[ChapterRead]},
        403: {"description": "User lacks read access to the course"},
        404: {"description": "Course not found"},
    },
)
async def api_get_chapter_by(
    request: Request,
    course_id: int,
    page: int,
    limit: int,
    current_user: PublicUser = Depends(get_current_user),
    db_session=Depends(get_db_session),
) -> List[ChapterRead]:
    """
    Get Course Chapters by page and limit
    """
    return await get_course_chapters(
        request, course_id, db_session, current_user, page, limit
    )


@router.put(
    "/{chapter_id}",
    response_model=ChapterRead,
    summary="Update chapter",
    description="Update the name or other metadata of a chapter by its ID.",
    responses={
        200: {"description": "Chapter updated successfully", "model": ChapterRead},
        403: {"description": "User lacks permission to modify this chapter"},
        404: {"description": "Chapter not found"},
        409: {"description": "Chapter does not exist"},
        422: {"description": "Invalid chapter payload"},
    },
)
async def api_update_coursechapter(
    request: Request,
    coursechapter_object: ChapterUpdate,
    chapter_id: int,
    current_user: PublicUser = Depends(get_current_user),
    db_session=Depends(get_db_session),
) -> ChapterRead:
    """
    Update CourseChapters by course_id
    """
    return await update_chapter(
        request, coursechapter_object, chapter_id, current_user, db_session
    )


@router.delete(
    "/{chapter_id}",
    summary="Delete chapter",
    description="Delete a chapter and detach its activities from the course.",
    responses={
        200: {"description": "Chapter deleted successfully"},
        403: {"description": "User lacks permission to delete this chapter"},
        404: {"description": "Chapter not found"},
        409: {"description": "Chapter does not exist"},
    },
)
async def api_delete_coursechapter(
    request: Request,
    chapter_id: str,
    current_user: PublicUser = Depends(get_current_user),
    db_session=Depends(get_db_session),
):
    """
    Delete CourseChapters by ID
    """

    return await delete_chapter(request, chapter_id, current_user, db_session)


@router.get(
    "/{chapter_uuid}/usergroups",
    summary="List user groups assigned to a locked chapter",
    description="Return the user groups that can access this chapter when lock_type is 'restricted'.",
)
async def api_list_chapter_usergroups(
    request: Request,
    chapter_uuid: str,
    current_user: PublicUser = Depends(get_current_user),
    db_session=Depends(get_db_session),
):
    return await get_chapter_usergroups(request, chapter_uuid, current_user, db_session)


@router.post(
    "/{chapter_uuid}/usergroups/{usergroup_uuid}",
    summary="Grant a user group access to a locked chapter",
    description="Associate a user group with this chapter so its members can access it when lock_type is 'restricted'.",
)
async def api_add_chapter_usergroup(
    request: Request,
    chapter_uuid: str,
    usergroup_uuid: str,
    current_user: PublicUser = Depends(get_current_user),
    db_session=Depends(get_db_session),
):
    return await add_usergroup_to_chapter(
        request, chapter_uuid, usergroup_uuid, current_user, db_session
    )


@router.delete(
    "/{chapter_uuid}/usergroups/{usergroup_uuid}",
    summary="Revoke a user group's access to a locked chapter",
    description="Remove the association between a user group and this chapter.",
)
async def api_remove_chapter_usergroup(
    request: Request,
    chapter_uuid: str,
    usergroup_uuid: str,
    current_user: PublicUser = Depends(get_current_user),
    db_session=Depends(get_db_session),
):
    return await remove_usergroup_from_chapter(
        request, chapter_uuid, usergroup_uuid, current_user, db_session
    )


@router.get(
    "/{chapter_uuid}/paywall_offer",
    summary="Get paywall offer for a locked chapter",
    description=(
        "Resolve the purchasable offer (if any) that unlocks a RESTRICTED chapter. "
        "Walks chapter → UserGroupResource → PaymentsGroupSync → PaymentsOffer. "
        "Returns 404 when no linked offer exists (free-but-restricted usergroups). "
        "Public endpoint so anonymous visitors can see the price before signup."
    ),
)
async def api_get_chapter_paywall_offer(
    request: Request,
    chapter_uuid: str,
    db_session: Session = Depends(get_db_session),
):
    chapter = db_session.exec(
        select(Chapter).where(Chapter.chapter_uuid == chapter_uuid)
    ).first()
    if not chapter:
        raise HTTPException(status_code=404, detail="Chapter not found")

    usergroup_ids = db_session.exec(
        select(UserGroupResource.usergroup_id).where(
            UserGroupResource.resource_uuid == chapter_uuid
        )
    ).all()
    if not usergroup_ids:
        raise HTTPException(status_code=404, detail="No paywall offer for this chapter")

    try:
        from ee.db.payments.payments_groups import PaymentsGroupSync
        from ee.db.payments.payments_offers import PaymentsOffer
        from ee.db.payments.payments import PaymentsConfig
    except Exception:
        raise HTTPException(status_code=404, detail="Payments module unavailable")

    sync_rows = db_session.exec(
        select(PaymentsGroupSync).where(PaymentsGroupSync.usergroup_id.in_(usergroup_ids))
    ).all()
    if not sync_rows:
        raise HTTPException(status_code=404, detail="No paywall offer for this chapter")

    payments_group_ids = [s.payments_group_id for s in sync_rows]
    offers = db_session.exec(
        select(PaymentsOffer).where(PaymentsOffer.payments_group_id.in_(payments_group_ids))
    ).all()
    if not offers:
        raise HTTPException(status_code=404, detail="No paywall offer for this chapter")

    # If multiple offers match, pick the cheapest one as the primary ("empezar desde…")
    offer = sorted(offers, key=lambda o: (o.amount or 0))[0]

    config_row = db_session.exec(
        select(PaymentsConfig).where(PaymentsConfig.id == offer.payments_config_id)
    ).first()

    return {
        "offer_uuid": offer.offer_uuid,
        "name": offer.name,
        "description": offer.description,
        "benefits": offer.benefits,
        "amount": offer.amount,
        "currency": offer.currency,
        "offer_type": offer.offer_type,
        "price_type": offer.price_type,
        "provider": getattr(config_row, "provider", None) if config_row else None,
        "org_id": offer.org_id,
        "chapter_uuid": chapter.chapter_uuid,
        "course_id": chapter.course_id,
    }
