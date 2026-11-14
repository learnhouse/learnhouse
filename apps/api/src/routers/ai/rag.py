"""
RAG (Retrieval-Augmented Generation) API router.

Course content search, indexing status and manual re-index trigger.
"""

import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlmodel import select

from sqlmodel.ext.asyncio.session import AsyncSession
from src.core.events.database import get_db_session
from src.db.course_embeddings import CourseEmbedding
from src.db.courses.activities import Activity
from src.db.courses.blocks import Block
from src.db.courses.courses import Course
from src.db.organization_config import OrganizationConfig
from src.db.organizations import Organization
from src.db.users import PublicUser, AnonymousUser, APITokenUser
from src.security.auth import get_current_user, get_authenticated_user, resolve_acting_user_id
from src.services.ai import metering
from src.security.org_auth import is_org_member, require_org_admin, enforce_org_mfa
from src.services.ai.rag import pipeline
from src.services.ai.rag import queue as rag_queue
from src.services.ai.rag.access import RagAccessScope, build_rag_access_scope
from src.services.ai.rag.gating import ai_block_reason
from src.services.ai.rag.media import reset_unfinished_transcripts, status_of
from src.services.ai.rag.query_service import (
    search_course_content,
    source_from_row,
)

logger = logging.getLogger(__name__)

router = APIRouter()


# ============================================================================
# Request/Response schemas
# ============================================================================


RAG_INDEX_MAX_PER_HOUR = 10


class RAGIndexRequest(BaseModel):
    course_uuid: str


class RAGIndexResponse(BaseModel):
    status: str
    chunks_indexed: int


class RAGSearchRequest(BaseModel):
    query: str = Field(min_length=1, max_length=2000)
    course_uuid: Optional[str] = None
    org_slug: Optional[str] = None
    limit: int = Field(default=8, ge=1, le=20)


class RAGSearchResponse(BaseModel):
    sources: list[dict]


class RAGActivityStatus(BaseModel):
    activity_uuid: str
    name: str
    activity_type: str
    chunks: int
    indexed_at: Optional[str] = None
    transcripts: list[dict] = []


class RAGStatusResponse(BaseModel):
    course_uuid: str
    course_chunks: int
    activities: list[RAGActivityStatus]


# ============================================================================
# Shared gate
# ============================================================================


async def _open_rag(
    request: Request,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    course_uuid: Optional[str],
    org_slug: Optional[str],
    db_session: AsyncSession,
) -> tuple[int, RagAccessScope]:
    """Resolve the org and the courses the caller may retrieve from.

    Applies every gate a retrieval needs, in order: membership, MFA, the AI
    feature and copilot toggle, the rate limit, then course access. A named
    course the caller cannot read is a 403. Nothing is charged here.
    """
    course = None
    org_id = None

    if course_uuid:
        course = (await db_session.execute(
            select(Course).where(Course.course_uuid == course_uuid)
        )).scalars().first()
        if not course:
            raise HTTPException(status_code=404, detail="Course not found")
        org_id = course.org_id
    else:
        if org_slug:
            org = (await db_session.execute(
                select(Organization).where(Organization.slug == org_slug)
            )).scalars().first()
            if not org:
                raise HTTPException(status_code=404, detail="Organization not found")
            org_id = org.id
        else:
            from src.db.user_organizations import UserOrganization
            user_org = (await db_session.execute(
                select(UserOrganization).where(
                    UserOrganization.user_id == resolve_acting_user_id(current_user)
                )
            )).scalars().first()
            if not user_org:
                raise HTTPException(status_code=403, detail="User has no organization")
            org_id = user_org.org_id

    # SECURITY (F-5): before touching any org-scoped resource (including the
    # credit bucket), verify the authenticated user is actually a member of
    # the resolved org. Without this check, an attacker in org A can drain
    # org B's AI credits or run RAG against org B's indexed content by
    # supplying a course_uuid or org_slug from org B.
    if not await is_org_member(resolve_acting_user_id(current_user), org_id, db_session):
        raise HTTPException(
            status_code=403,
            detail="You are not a member of this organization",
        )
    # Org-wide two-factor policy, applied after the membership gate.
    await enforce_org_mfa(resolve_acting_user_id(current_user), org_id, db_session)

    # Check if AI and the copilot are enabled for this org
    org_config = (await db_session.execute(
        select(OrganizationConfig).where(OrganizationConfig.org_id == org_id)
    )).scalars().first()
    blocked = ai_block_reason(org_config.config if org_config else None, org_id)
    if blocked:
        raise HTTPException(status_code=403, detail=blocked)

    # F-9: per-user + per-org rate limit before any compute / credit spend.
    # Resolve API tokens to creator so rate-limit buckets per creator, not 0.
    from src.services.security.rate_limiting import enforce_ai_rate_limit
    enforce_ai_rate_limit(resolve_acting_user_id(current_user), org_id)

    # Only content the caller could open through the course/activity endpoints
    # may reach the model or the returned sources. A named course the caller
    # cannot read is a 403, before any credit is spent.
    access_scope = await build_rag_access_scope(
        request, current_user, org_id, db_session, course=course
    )
    return org_id, access_scope


# ============================================================================
# Endpoints
# ============================================================================


@router.post(
    "/rag/index",
    response_model=RAGIndexResponse,
    summary="Reindex course content for RAG",
    description="Manually trigger re-indexing (embedding) of a course's content for the RAG chatbot. Requires admin/maintainer role on the course's organization.",
    responses={
        200: {"description": "Course re-indexed successfully.", "model": RAGIndexResponse},
        401: {"description": "Authentication required"},
        403: {"description": "User lacks admin/maintainer role on the organization"},
        404: {"description": "Course not found"},
    },
)
async def api_rag_index(
    request: Request,
    index_request: RAGIndexRequest,
    current_user: PublicUser | AnonymousUser | APITokenUser = Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
):
    """
    Manually trigger re-indexing of a course's content for RAG.
    Requires admin/maintainer role on the course's organization.
    """
    # Resolve course
    course = (await db_session.execute(
        select(Course).where(Course.course_uuid == index_request.course_uuid)
    )).scalars().first()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")

    # Require admin/maintainer access
    await require_org_admin(resolve_acting_user_id(current_user), course.org_id, db_session)

    # A full reindex re-embeds every chunk (paid), so cap manual runs per org
    from src.services.security.rate_limiting import check_rate_limit
    is_allowed, _count, retry_after = check_rate_limit(
        key=f"rag_index:{course.org_id}",
        max_attempts=RAG_INDEX_MAX_PER_HOUR,
        window_seconds=60 * 60,
    )
    if not is_allowed:
        raise HTTPException(
            status_code=429,
            detail={
                "code": "RATE_LIMITED",
                "message": "Too many reindex requests. Please try again later.",
                "retry_after": retry_after,
            },
            headers={"Retry-After": str(retry_after)},
        )

    # Index the text now; transcription takes minutes, so media is retried
    # (including transcripts that failed or ran out of credits) in the
    # background, which indexes the course again when it finishes.
    chunks_indexed = await pipeline.run_course(course.id, transcribe=False)
    await reset_unfinished_transcripts(course.id, db_session)
    await rag_queue.enqueue_course(course.id, db_session, delay=0, transcribe=True)

    return RAGIndexResponse(
        status="success",
        chunks_indexed=chunks_indexed,
    )


@router.post(
    "/rag/search",
    response_model=RAGSearchResponse,
    summary="Search course content",
    description="Semantic search over the course content the caller can read: pages, documents, video and audio transcripts, assignments and course descriptions. Returns ranked sources with a snippet and, where available, the page or timestamp. Searches one course when `course_uuid` is given, otherwise every readable course in the organization.",
    responses={
        200: {"description": "Ranked sources.", "model": RAGSearchResponse},
        401: {"description": "Authentication required"},
        403: {"description": "AI features disabled, copilot disabled, or no access to the course"},
        404: {"description": "Course or organization not found"},
        429: {"description": "AI rate limit exceeded"},
    },
)
async def api_rag_search(
    request: Request,
    search_request: RAGSearchRequest,
    current_user: PublicUser | AnonymousUser | APITokenUser = Depends(get_authenticated_user),
    db_session: AsyncSession = Depends(get_db_session),
):
    org_id, access_scope = await _open_rag(
        request, current_user, search_request.course_uuid, search_request.org_slug, db_session
    )
    if not access_scope.course_ids:
        return RAGSearchResponse(sources=[])

    # One embedding call for the query; refunded if the search fails.
    async with metering.charge("ask_ai", org_id=org_id, db=db_session):
        rows = await search_course_content(
            search_request.query, org_id, db_session, access_scope, top_k=search_request.limit
        )
    return RAGSearchResponse(sources=[source_from_row(row).to_dict() for row in rows])


@router.get(
    "/rag/status",
    response_model=RAGStatusResponse,
    summary="Course indexing status",
    description="How much of each activity is indexed for AI search, and the transcription status of its media. Requires admin/maintainer role on the course's organization.",
    responses={
        200: {"description": "Per-activity index status.", "model": RAGStatusResponse},
        401: {"description": "Authentication required"},
        403: {"description": "User lacks admin/maintainer role on the organization"},
        404: {"description": "Course not found"},
    },
)
async def api_rag_status(
    course_uuid: str,
    current_user: PublicUser | AnonymousUser | APITokenUser = Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
):
    course = (await db_session.execute(
        select(Course).where(Course.course_uuid == course_uuid)
    )).scalars().first()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")
    await require_org_admin(resolve_acting_user_id(current_user), course.org_id, db_session)

    counts = {
        activity_id: (chunks, indexed_at)
        for activity_id, chunks, indexed_at in (await db_session.execute(
            select(CourseEmbedding.activity_id, func.count(), func.max(CourseEmbedding.update_date))
            .where(CourseEmbedding.course_id == course.id)
            .group_by(CourseEmbedding.activity_id)
        )).all()
    }
    activities = (await db_session.execute(
        select(Activity).where(Activity.course_id == course.id).order_by(Activity.id)
    )).scalars().all()
    blocks = (await db_session.execute(
        select(Block).where(Block.course_id == course.id)
    )).scalars().all()
    block_transcripts: dict[int, list[dict]] = {}
    for block in blocks:
        transcript = status_of(block.content)
        if transcript:
            block_transcripts.setdefault(block.activity_id, []).append(
                {**transcript, "block_uuid": block.block_uuid}
            )

    return RAGStatusResponse(
        course_uuid=course.course_uuid,
        course_chunks=counts.get(None, (0, None))[0],
        activities=[
            RAGActivityStatus(
                activity_uuid=activity.activity_uuid,
                name=activity.name,
                activity_type=activity.activity_type,
                chunks=counts.get(activity.id, (0, None))[0],
                indexed_at=counts.get(activity.id, (0, None))[1],
                transcripts=[
                    t for t in [status_of(activity.extra_metadata)] if t
                ] + block_transcripts.get(activity.id, []),
            )
            for activity in activities
        ],
    )
