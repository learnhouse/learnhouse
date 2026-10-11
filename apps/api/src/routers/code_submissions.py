import json
from typing import Union
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlmodel import select, col
from uuid import uuid4

from sqlmodel.ext.asyncio.session import AsyncSession
from src.core.events.database import get_db_session
from src.db.code_submissions import CodeSubmission, CodeSubmissionRead
from src.db.users import AnonymousUser, PublicUser
from src.security.auth import get_current_user
from src.services.courses.activities.access import verify_activity_reader_access_by_uuid

router = APIRouter()

# Size caps on what a learner can store per submission.
MAX_SOURCE_CODE_CHARS = 200_000
MAX_RESULTS_BYTES = 1_000_000


class SaveSubmissionRequest(BaseModel):
    activity_uuid: str
    block_id: str = Field(max_length=255)
    language_id: int
    source_code: str
    results: dict
    # Accepted for backward compatibility but ignored: the tests run in the
    # browser, so the server can't verify a pass. ``passed`` is derived from
    # the reported counts instead of being taken verbatim.
    passed: bool | None = None
    total_tests: int = Field(ge=0)
    passed_tests: int = Field(ge=0)
    execution_time_ms: int | None = None


@router.get(
    "/history",
    summary="List a user's code submission history",
    description="Return the authenticated user's previous code submissions for a given activity block, paginated by page and limit.",
    responses={
        200: {"description": "Paginated list of code submissions for the current user on the given block."},
        401: {"description": "Authentication required"},
        403: {"description": "User cannot access this activity"},
        404: {"description": "Activity not found"},
    },
)
async def get_submission_history(
    request: Request,
    activity_uuid: str,
    block_id: str,
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    current_user: Union[PublicUser, AnonymousUser] = Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
) -> dict:
    if isinstance(current_user, AnonymousUser):
        raise HTTPException(status_code=401, detail="Authentication required")

    # History is scoped to activities the caller can still read.
    await verify_activity_reader_access_by_uuid(
        request, activity_uuid, current_user, db_session
    )

    offset = (page - 1) * limit
    statement = (
        select(CodeSubmission)
        .where(
            CodeSubmission.user_id == current_user.id,
            CodeSubmission.activity_uuid == activity_uuid,
            CodeSubmission.block_id == block_id,
        )
        .order_by(col(CodeSubmission.id).desc())
        .offset(offset)
        .limit(limit)
    )
    submissions = (await db_session.execute(statement)).scalars().all()

    count_statement = (
        select(func.count(CodeSubmission.id))
        .where(
            CodeSubmission.user_id == current_user.id,
            CodeSubmission.activity_uuid == activity_uuid,
            CodeSubmission.block_id == block_id,
        )
    )
    total = (await db_session.execute(count_statement)).scalar_one()

    return {
        "submissions": [
            CodeSubmissionRead.model_validate(s) for s in submissions
        ],
        "total": total,
        "page": page,
        "limit": limit,
    }


@router.post(
    "/save",
    response_model=CodeSubmissionRead,
    summary="Save a code submission",
    description="Persist a code submission (source, results, pass/fail counts) for the authenticated user on an activity block.",
    responses={
        200: {"description": "Code submission saved successfully.", "model": CodeSubmissionRead},
        401: {"description": "Authentication required"},
        402: {"description": "The activity requires a purchase"},
        403: {"description": "User cannot access this activity"},
        404: {"description": "Activity not found"},
        413: {"description": "Source code or results exceed the size limit"},
    },
)
async def save_submission(
    request: Request,
    body: SaveSubmissionRequest,
    current_user: Union[PublicUser, AnonymousUser] = Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
) -> CodeSubmissionRead:
    if isinstance(current_user, AnonymousUser):
        raise HTTPException(status_code=401, detail="Authentication required")

    if len(body.source_code) > MAX_SOURCE_CODE_CHARS:
        raise HTTPException(status_code=413, detail="Source code is too large")
    if len(json.dumps(body.results, default=str).encode("utf-8")) > MAX_RESULTS_BYTES:
        raise HTTPException(status_code=413, detail="Results payload is too large")
    if body.passed_tests > body.total_tests:
        raise HTTPException(status_code=422, detail="passed_tests cannot exceed total_tests")

    # Only save against an activity the caller may actually consume.
    await verify_activity_reader_access_by_uuid(
        request, body.activity_uuid, current_user, db_session
    )

    submission = CodeSubmission(
        submission_uuid=f"sub_{uuid4()}",
        user_id=current_user.id,
        activity_uuid=body.activity_uuid,
        block_id=body.block_id,
        language_id=body.language_id,
        source_code=body.source_code,
        results=body.results,
        passed=body.total_tests > 0 and body.passed_tests == body.total_tests,
        total_tests=body.total_tests,
        passed_tests=body.passed_tests,
        execution_time_ms=body.execution_time_ms,
    )
    db_session.add(submission)
    await db_session.commit()
    await db_session.refresh(submission)
    return CodeSubmissionRead.model_validate(submission)
