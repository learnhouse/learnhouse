"""AI quiz generation endpoints (in-editor `blockQuiz`).

Non-streaming, structured-output generation so the returned quiz is always
schema-valid and safe to insert into the editor. Same guard/credit ordering as
the other AI routers.
"""

import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.core.events.database import get_db_session
from src.db.ai.generations import AIGenerationKind
from src.db.courses.activities import Activity
from src.db.courses.courses import Course
from src.db.organizations import Organization
from src.db.users import PublicUser
from src.security.auth import get_authenticated_user
from src.security.features_utils.usage import refund_ai_credit, reserve_ai_credit
from src.security.org_auth import is_org_member
from src.services.ai.generations import (
    delete_generation,
    list_generations,
    record_generation,
)
from src.services.ai.llm import AINotConfiguredError, resolve_model_for_org
from src.services.ai.quiz import generate_quiz
from src.services.ai.schemas.quiz import (
    AIQuizHistoryItem,
    GenerateQuizRequest,
    GenerateQuizResponse,
)
from src.services.security.rate_limiting import enforce_ai_rate_limit

logger = logging.getLogger(__name__)

router = APIRouter()

QUIZ_CREDIT_COST = 2


async def _authorize_org(org_id: int, user: PublicUser, db_session: AsyncSession) -> Organization:
    org = (
        await db_session.execute(select(Organization).where(Organization.id == org_id))
    ).scalars().first()
    if not org or org.id is None:
        raise HTTPException(status_code=404, detail="Organization not found")
    if not await is_org_member(user.id, org.id, db_session):
        raise HTTPException(status_code=403, detail="User is not a member of this organization")
    return org


async def _load_activity_content(
    activity_uuid: str, org_id: int, db_session: AsyncSession
) -> tuple[dict | None, int | None]:
    """Return (content, activity_id) for an activity, verifying it is in the org."""
    activity = (
        await db_session.execute(
            select(Activity).where(Activity.activity_uuid == activity_uuid)
        )
    ).scalars().first()
    if not activity:
        return None, None
    course = (
        await db_session.execute(
            select(Course).where(Course.id == activity.course_id)
        )
    ).scalars().first()
    if not course or course.org_id != org_id:
        # Don't leak cross-org content into the prompt.
        return None, None
    return (activity.content or None), activity.id


@router.post(
    "/quiz/generate",
    response_model=GenerateQuizResponse,
    summary="Generate a quiz for the editor",
    responses={
        200: {"description": "Quiz generated.", "model": GenerateQuizResponse},
        403: {"description": "Not an org member, AI disabled, or insufficient credits"},
        404: {"description": "Organization not found"},
    },
)
async def api_generate_quiz(
    body: GenerateQuizRequest,
    current_user: PublicUser = Depends(get_authenticated_user),
    db_session: AsyncSession = Depends(get_db_session),
) -> GenerateQuizResponse:
    if not (body.prompt or "").strip():
        raise HTTPException(status_code=400, detail="A prompt is required")

    org = await _authorize_org(body.org_id, current_user, db_session)
    assert org.id is not None

    activity_content: dict | None = None
    activity_id: int | None = None
    if body.activity_uuid:
        activity_content, activity_id = await _load_activity_content(
            body.activity_uuid, org.id, db_session
        )

    enforce_ai_rate_limit(current_user.id, org.id)
    await reserve_ai_credit(org.id, db_session, amount=QUIZ_CREDIT_COST)

    model_name = await resolve_model_for_org(org.id, db_session, purpose="planning")

    try:
        block_quiz, session_uuid = await generate_quiz(
            org_id=org.id,
            prompt=body.prompt,
            model_name=model_name,
            activity_content=activity_content,
            num_questions=body.num_questions,
            difficulty=body.difficulty,
            session_uuid=body.session_uuid,
        )
    except AINotConfiguredError as e:
        refund_ai_credit(org.id, QUIZ_CREDIT_COST)
        raise HTTPException(status_code=403, detail=str(e))
    except Exception:
        refund_ai_credit(org.id, QUIZ_CREDIT_COST)
        logger.exception("Quiz generation failed")
        raise HTTPException(status_code=502, detail="Quiz generation failed. Please try again.")

    if not block_quiz.get("questions"):
        refund_ai_credit(org.id, QUIZ_CREDIT_COST)
        raise HTTPException(status_code=502, detail="The model returned no questions. Try rephrasing.")

    record = await record_generation(
        db_session,
        kind=AIGenerationKind.QUIZ,
        org_id=org.id,
        user_id=current_user.id,
        prompt=body.prompt.strip(),
        result=block_quiz,
        session_uuid=session_uuid,
        activity_id=activity_id,
    )

    return GenerateQuizResponse(
        ai_generation_uuid=record.ai_generation_uuid,
        session_uuid=session_uuid,
        quiz=block_quiz,
    )


@router.get(
    "/quiz/history",
    response_model=list[AIQuizHistoryItem],
    summary="List AI quiz generation history",
)
async def api_list_quiz_history(
    org_id: int,
    limit: int = 30,
    offset: int = 0,
    current_user: PublicUser = Depends(get_authenticated_user),
    db_session: AsyncSession = Depends(get_db_session),
) -> list[AIQuizHistoryItem]:
    await _authorize_org(org_id, current_user, db_session)
    rows = await list_generations(
        db_session,
        org_id=org_id,
        user_id=current_user.id,
        kind=AIGenerationKind.QUIZ,
        limit=limit,
        offset=offset,
    )
    return [
        AIQuizHistoryItem(
            ai_generation_uuid=r.ai_generation_uuid,
            session_uuid=r.session_uuid,
            prompt=r.prompt,
            quiz=r.result or {},
            creation_date=r.creation_date,
        )
        for r in rows
    ]


@router.delete(
    "/quiz/history/{ai_generation_uuid}",
    summary="Delete an AI quiz generation from history",
)
async def api_delete_quiz_history(
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
