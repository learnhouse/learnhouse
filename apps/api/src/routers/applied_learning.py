from datetime import datetime, timezone
from typing import Union
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field as PydanticField
from sqlalchemy import func
from sqlmodel import select, col
from sqlmodel.ext.asyncio.session import AsyncSession

from src.core.events.database import get_db_session
from src.db.applied_learning import (
    AppliedLearningCapstone,
    AppliedLearningCapstoneRead,
    AppliedLearningEntry,
    AppliedLearningEntryRead,
)
from src.db.users import AnonymousUser, PublicUser
from src.security.auth import get_current_user

router = APIRouter()


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(tzinfo=None).isoformat()


def require_user(current_user: Union[PublicUser, AnonymousUser]) -> PublicUser:
    if isinstance(current_user, AnonymousUser):
        raise HTTPException(status_code=401, detail="Authentication required")
    return current_user


class SaveReflectionRequest(BaseModel):
    org_id: int
    course_uuid: str
    activity_uuid: str
    activity_name: str = ""
    module_name: str = ""
    planned_application: str = PydanticField(min_length=3, max_length=6000)
    previous_application: str = PydanticField(default="", max_length=6000)
    measurable_change: str = PydanticField(default="", max_length=6000)
    evidence_notes: str = PydanticField(default="", max_length=6000)
    application_status: str = "planned"


class SaveCapstoneRequest(BaseModel):
    org_id: int
    title: str = PydanticField(min_length=2, max_length=300)
    challenge: str = PydanticField(default="", max_length=12000)
    what_i_applied: str = PydanticField(default="", max_length=12000)
    measurable_impact: str = PydanticField(default="", max_length=12000)
    lessons_learned: str = PydanticField(default="", max_length=12000)
    next_steps: str = PydanticField(default="", max_length=12000)
    selected_entry_uuids: list[str] = []
    status: str = "draft"
    capstone_uuid: str | None = None


@router.get("/reflection/{activity_uuid}", response_model=AppliedLearningEntryRead | None)
async def get_reflection(
    activity_uuid: str,
    current_user: Union[PublicUser, AnonymousUser] = Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
):
    user = require_user(current_user)
    statement = select(AppliedLearningEntry).where(
        AppliedLearningEntry.user_id == user.id,
        AppliedLearningEntry.activity_uuid == activity_uuid,
    )
    entry = (await db_session.execute(statement)).scalars().first()
    return AppliedLearningEntryRead.model_validate(entry) if entry else None


@router.post("/reflection", response_model=AppliedLearningEntryRead)
async def save_reflection(
    body: SaveReflectionRequest,
    current_user: Union[PublicUser, AnonymousUser] = Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
):
    """Create or update the learner's application record for a lesson."""
    user = require_user(current_user)
    statement = select(AppliedLearningEntry).where(
        AppliedLearningEntry.user_id == user.id,
        AppliedLearningEntry.activity_uuid == body.activity_uuid,
    )
    entry = (await db_session.execute(statement)).scalars().first()

    status = body.application_status if body.application_status in {"planned", "applied", "measured"} else "planned"

    if entry is None:
        entry = AppliedLearningEntry(
            entry_uuid=f"apply_{uuid4()}",
            user_id=user.id,
            org_id=body.org_id,
            course_uuid=body.course_uuid,
            activity_uuid=body.activity_uuid,
        )
        db_session.add(entry)

    entry.org_id = body.org_id
    entry.course_uuid = body.course_uuid
    entry.activity_name = body.activity_name.strip()
    entry.module_name = body.module_name.strip()
    entry.planned_application = body.planned_application.strip()
    entry.previous_application = body.previous_application.strip()
    entry.measurable_change = body.measurable_change.strip()
    entry.evidence_notes = body.evidence_notes.strip()
    entry.application_status = status
    entry.updated_at = now_iso()

    await db_session.commit()
    await db_session.refresh(entry)
    return AppliedLearningEntryRead.model_validate(entry)


@router.get("/me", response_model=list[AppliedLearningEntryRead])
async def list_my_portfolio(
    org_id: int | None = Query(default=None),
    course_uuid: str | None = Query(default=None),
    limit: int = Query(default=250, ge=1, le=1000),
    current_user: Union[PublicUser, AnonymousUser] = Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
):
    user = require_user(current_user)
    statement = select(AppliedLearningEntry).where(AppliedLearningEntry.user_id == user.id)
    if org_id is not None:
        statement = statement.where(AppliedLearningEntry.org_id == org_id)
    if course_uuid:
        statement = statement.where(AppliedLearningEntry.course_uuid == course_uuid)
    statement = statement.order_by(col(AppliedLearningEntry.updated_at).desc()).limit(limit)
    entries = (await db_session.execute(statement)).scalars().all()
    return [AppliedLearningEntryRead.model_validate(entry) for entry in entries]


@router.get("/me/summary")
async def my_portfolio_summary(
    org_id: int | None = Query(default=None),
    current_user: Union[PublicUser, AnonymousUser] = Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
):
    user = require_user(current_user)
    filters = [AppliedLearningEntry.user_id == user.id]
    if org_id is not None:
        filters.append(AppliedLearningEntry.org_id == org_id)

    total_stmt = select(func.count(AppliedLearningEntry.id)).where(*filters)
    applied_stmt = select(func.count(AppliedLearningEntry.id)).where(
        *filters, AppliedLearningEntry.application_status.in_(["applied", "measured"])
    )
    measured_stmt = select(func.count(AppliedLearningEntry.id)).where(
        *filters, AppliedLearningEntry.measurable_change != ""
    )
    course_stmt = select(func.count(func.distinct(AppliedLearningEntry.course_uuid))).where(*filters)

    return {
        "entries": (await db_session.execute(total_stmt)).scalar_one(),
        "applied": (await db_session.execute(applied_stmt)).scalar_one(),
        "measured": (await db_session.execute(measured_stmt)).scalar_one(),
        "courses": (await db_session.execute(course_stmt)).scalar_one(),
    }


@router.get("/capstones/me", response_model=list[AppliedLearningCapstoneRead])
async def list_my_capstones(
    org_id: int | None = Query(default=None),
    current_user: Union[PublicUser, AnonymousUser] = Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
):
    user = require_user(current_user)
    statement = select(AppliedLearningCapstone).where(AppliedLearningCapstone.user_id == user.id)
    if org_id is not None:
        statement = statement.where(AppliedLearningCapstone.org_id == org_id)
    statement = statement.order_by(col(AppliedLearningCapstone.updated_at).desc())
    capstones = (await db_session.execute(statement)).scalars().all()
    return [AppliedLearningCapstoneRead.model_validate(item) for item in capstones]


@router.post("/capstones", response_model=AppliedLearningCapstoneRead)
async def save_capstone(
    body: SaveCapstoneRequest,
    current_user: Union[PublicUser, AnonymousUser] = Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
):
    """Create a new capstone or update a learner-owned draft."""
    user = require_user(current_user)
    capstone = None
    if body.capstone_uuid:
        statement = select(AppliedLearningCapstone).where(
            AppliedLearningCapstone.capstone_uuid == body.capstone_uuid,
            AppliedLearningCapstone.user_id == user.id,
        )
        capstone = (await db_session.execute(statement)).scalars().first()
        if capstone is None:
            raise HTTPException(status_code=404, detail="Capstone not found")

    if capstone is None:
        capstone = AppliedLearningCapstone(
            capstone_uuid=f"capstone_{uuid4()}",
            user_id=user.id,
            org_id=body.org_id,
            title=body.title.strip(),
        )
        db_session.add(capstone)

    capstone.org_id = body.org_id
    capstone.title = body.title.strip()
    capstone.challenge = body.challenge.strip()
    capstone.what_i_applied = body.what_i_applied.strip()
    capstone.measurable_impact = body.measurable_impact.strip()
    capstone.lessons_learned = body.lessons_learned.strip()
    capstone.next_steps = body.next_steps.strip()
    capstone.selected_entry_uuids = list(dict.fromkeys(body.selected_entry_uuids))
    capstone.status = body.status if body.status in {"draft", "ready", "submitted"} else "draft"
    capstone.updated_at = now_iso()

    await db_session.commit()
    await db_session.refresh(capstone)
    return AppliedLearningCapstoneRead.model_validate(capstone)
