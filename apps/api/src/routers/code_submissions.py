from typing import Union
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func
from sqlmodel import Session, select, col
from uuid import uuid4

from src.core.events.database import get_db_session
from src.db.code_submissions import CodeSubmission, CodeSubmissionRead
from src.db.users import AnonymousUser, PublicUser
from src.security.auth import get_current_user

router = APIRouter()


class SaveSubmissionRequest(BaseModel):
    activity_uuid: str
    block_id: str
    language_id: int
    source_code: str
    results: dict
    passed: bool
    total_tests: int
    passed_tests: int
    execution_time_ms: int | None = None


@router.get(
    "/history",
    summary="List a user's code submission history",
    description="Return the authenticated user's previous code submissions for a given activity block, paginated by page and limit.",
    responses={
        200: {"description": "Paginated list of code submissions for the current user on the given block."},
        401: {"description": "Authentication required"},
    },
)
async def get_submission_history(
    activity_uuid: str,
    block_id: str,
    page: int = 1,
    limit: int = 20,
    current_user: Union[PublicUser, AnonymousUser] = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
) -> dict:
    if isinstance(current_user, AnonymousUser):
        raise HTTPException(status_code=401, detail="Authentication required")

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
    submissions = db_session.exec(statement).all()

    count_statement = (
        select(func.count(CodeSubmission.id))
        .where(
            CodeSubmission.user_id == current_user.id,
            CodeSubmission.activity_uuid == activity_uuid,
            CodeSubmission.block_id == block_id,
        )
    )
    total = db_session.exec(count_statement).one()

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
    },
)
async def save_submission(
    body: SaveSubmissionRequest,
    current_user: Union[PublicUser, AnonymousUser] = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
) -> CodeSubmissionRead:
    if isinstance(current_user, AnonymousUser):
        raise HTTPException(status_code=401, detail="Authentication required")

    submission = CodeSubmission(
        submission_uuid=f"sub_{uuid4()}",
        user_id=current_user.id,
        activity_uuid=body.activity_uuid,
        block_id=body.block_id,
        language_id=body.language_id,
        source_code=body.source_code,
        results=body.results,
        passed=body.passed,
        total_tests=body.total_tests,
        passed_tests=body.passed_tests,
        execution_time_ms=body.execution_time_ms,
    )
    db_session.add(submission)
    db_session.commit()
    db_session.refresh(submission)
    return CodeSubmissionRead.model_validate(submission)
