"""AI assignment generation endpoints.

Generates a preview assignment plan (assignment + graded tasks) grounded on a
course's content. Does NOT persist — the frontend previews/edits then saves via
the existing /assignments endpoints. Same guard/credit ordering as the other AI
routers.
"""

import logging

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.core.events.database import get_db_session
from src.db.ai.generations import AIGenerationKind
from src.db.courses.courses import Course
from src.db.organizations import Organization
from src.db.users import PublicUser
from src.security.auth import get_authenticated_user
from src.security.features_utils.usage import refund_ai_credit, reserve_ai_credit
from src.security.org_auth import is_org_member, enforce_org_mfa
from src.security.rbac import check_resource_access, AccessAction
from src.services.ai.assignment_gen import generate_assignment_plan
from src.services.ai.generations import (
    delete_generation,
    list_generations,
    record_generation,
)
from src.services.ai.llm import AINotConfiguredError, resolve_model_for_org
from src.services.ai.schemas.assignment import (
    AIAssignmentHistoryItem,
    GenerateAssignmentRequest,
    GenerateAssignmentResponse,
)
from src.services.security.rate_limiting import enforce_ai_rate_limit

logger = logging.getLogger(__name__)

router = APIRouter()

ASSIGNMENT_CREDIT_COST = 3


async def _authorize_org(org_id: int, user: PublicUser, db_session: AsyncSession) -> Organization:
    org = (
        await db_session.execute(select(Organization).where(Organization.id == org_id))
    ).scalars().first()
    if not org or org.id is None:
        raise HTTPException(status_code=404, detail="Organization not found")
    if not await is_org_member(user.id, org.id, db_session):
        raise HTTPException(status_code=403, detail="User is not a member of this organization")
    # Org-wide two-factor policy, applied after the membership gate.
    await enforce_org_mfa(user.id, org.id, db_session)
    return org


@router.post(
    "/assignments/generate",
    response_model=GenerateAssignmentResponse,
    summary="Generate an assignment plan from course content",
    responses={
        200: {"description": "Assignment plan generated.", "model": GenerateAssignmentResponse},
        403: {"description": "Not an org member, AI disabled, or insufficient credits"},
        404: {"description": "Organization or course not found"},
    },
)
async def api_generate_assignment(
    body: GenerateAssignmentRequest,
    request: Request,
    current_user: PublicUser = Depends(get_authenticated_user),
    db_session: AsyncSession = Depends(get_db_session),
) -> GenerateAssignmentResponse:
    if not (body.prompt or "").strip():
        raise HTTPException(status_code=400, detail="A prompt is required")

    org = await _authorize_org(body.org_id, current_user, db_session)
    assert org.id is not None

    course = (
        await db_session.execute(
            select(Course).where(Course.course_uuid == body.course_uuid)
        )
    ).scalars().first()
    if not course or course.id is None or course.org_id != org.id:
        raise HTTPException(status_code=404, detail="Course not found")

    # Authoring, not enrollment: generating an assignment grounds the model on
    # (possibly restricted/draft) course content and spends org AI credits, so it
    # requires content-author rights on THIS course — not bare org membership,
    # which would let any enrolled learner mine the material and burn credits.
    await check_resource_access(
        request, db_session, current_user, course.course_uuid, AccessAction.UPDATE
    )

    enforce_ai_rate_limit(current_user.id, org.id)
    await reserve_ai_credit(org.id, db_session, amount=ASSIGNMENT_CREDIT_COST)

    model_name = await resolve_model_for_org(org.id, db_session, purpose="planning")

    try:
        plan, session_uuid = await generate_assignment_plan(
            org_id=org.id,
            course_id=course.id,
            prompt=body.prompt,
            model_name=model_name,
            db_session=db_session,
            num_tasks=body.num_tasks,
            allowed_task_types=body.allowed_task_types,
            session_uuid=body.session_uuid,
        )
    except AINotConfiguredError as e:
        refund_ai_credit(org.id, ASSIGNMENT_CREDIT_COST)
        raise HTTPException(status_code=403, detail=str(e))
    except Exception:
        refund_ai_credit(org.id, ASSIGNMENT_CREDIT_COST)
        logger.exception("Assignment generation failed")
        raise HTTPException(status_code=502, detail="Assignment generation failed. Please try again.")

    if not plan.tasks:
        refund_ai_credit(org.id, ASSIGNMENT_CREDIT_COST)
        raise HTTPException(status_code=502, detail="The model returned no tasks. Try rephrasing.")

    try:
        record = await record_generation(
            db_session,
            kind=AIGenerationKind.ASSIGNMENT,
            org_id=org.id,
            user_id=current_user.id,
            prompt=body.prompt.strip(),
            result=plan.model_dump(),
            session_uuid=session_uuid,
            course_id=course.id,
        )
    except Exception:
        # Persisting the history record failed after the credits were reserved —
        # refund so a DB hiccup doesn't silently charge the org for nothing.
        refund_ai_credit(org.id, ASSIGNMENT_CREDIT_COST)
        logger.exception("Failed to record assignment generation")
        raise HTTPException(status_code=502, detail="Assignment generation failed. Please try again.")

    return GenerateAssignmentResponse(
        ai_generation_uuid=record.ai_generation_uuid,
        session_uuid=session_uuid,
        plan=plan,
    )


@router.get(
    "/assignments/history",
    response_model=list[AIAssignmentHistoryItem],
    summary="List AI assignment generation history",
)
async def api_list_assignment_history(
    org_id: int,
    limit: int = 30,
    offset: int = 0,
    current_user: PublicUser = Depends(get_authenticated_user),
    db_session: AsyncSession = Depends(get_db_session),
) -> list[AIAssignmentHistoryItem]:
    await _authorize_org(org_id, current_user, db_session)
    rows = await list_generations(
        db_session,
        org_id=org_id,
        user_id=current_user.id,
        kind=AIGenerationKind.ASSIGNMENT,
        limit=limit,
        offset=offset,
    )
    return [
        AIAssignmentHistoryItem(
            ai_generation_uuid=r.ai_generation_uuid,
            session_uuid=r.session_uuid,
            prompt=r.prompt,
            plan=r.result or {},
            creation_date=r.creation_date,
        )
        for r in rows
    ]


@router.delete(
    "/assignments/history/{ai_generation_uuid}",
    summary="Delete an AI assignment generation from history",
)
async def api_delete_assignment_history(
    ai_generation_uuid: str,
    current_user: PublicUser = Depends(get_authenticated_user),
    db_session: AsyncSession = Depends(get_db_session),
) -> dict:
    deleted = await delete_generation(
        db_session, ai_generation_uuid=ai_generation_uuid, user_id=current_user.id
    )
    if not deleted:
        raise HTTPException(status_code=404, detail="Generation not found")
    return {"detail": "deleted"}
