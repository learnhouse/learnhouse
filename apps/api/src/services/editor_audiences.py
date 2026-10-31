"""Saved audiences: named rule sets an organization's authors reuse across
conditional blocks. Same permissions as editor templates."""

import json
from datetime import datetime
from uuid import uuid4

from fastapi import HTTPException, Request
from sqlmodel import func, select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.editor_audiences import (
    EditorAudience,
    EditorAudienceCreate,
    EditorAudienceRead,
    EditorAudienceUpdate,
)
from src.services.editor_templates import _require_author, _require_manager, _require_user

MAX_AUDIENCE_BYTES = 50 * 1024
MAX_AUDIENCES_PER_ORG = 200


def _validate_rules(rules: dict) -> None:
    if not isinstance(rules.get("conditions"), list):
        raise HTTPException(status_code=400, detail="An audience needs a list of conditions")
    if len(json.dumps(rules)) > MAX_AUDIENCE_BYTES:
        raise HTTPException(status_code=413, detail="Audience rules are too large")


async def _get_audience(audience_uuid: str, db_session: AsyncSession) -> EditorAudience:
    audience = (await db_session.execute(
        select(EditorAudience).where(EditorAudience.audience_uuid == audience_uuid)
    )).scalars().first()
    if not audience:
        raise HTTPException(status_code=404, detail="Audience not found")
    return audience


async def list_editor_audiences(
    request: Request, org_id: int, current_user, db_session: AsyncSession
) -> list[EditorAudienceRead]:
    user = _require_user(current_user)
    await _require_author(user, org_id, db_session)
    audiences = (await db_session.execute(
        select(EditorAudience).where(EditorAudience.org_id == org_id).order_by(EditorAudience.name)
    )).scalars().all()
    return [EditorAudienceRead.model_validate(a) for a in audiences]


async def create_editor_audience(
    request: Request, audience_object: EditorAudienceCreate, current_user, db_session: AsyncSession
) -> EditorAudienceRead:
    user = _require_user(current_user)
    await _require_author(user, audience_object.org_id, db_session)
    _validate_rules(audience_object.rules)
    count = (await db_session.execute(
        select(func.count(EditorAudience.id)).where(  # type: ignore[arg-type]
            EditorAudience.org_id == audience_object.org_id
        )
    )).scalar_one()
    if count >= MAX_AUDIENCES_PER_ORG:
        raise HTTPException(status_code=400, detail="This organization has reached its audience limit")

    now = str(datetime.now())
    audience = EditorAudience(
        name=audience_object.name.strip(),
        description=audience_object.description.strip(),
        rules=audience_object.rules,
        org_id=audience_object.org_id,
        creator_id=user.id,
        audience_uuid=f"audience_{uuid4()}",
        creation_date=now,
        update_date=now,
    )
    db_session.add(audience)
    await db_session.commit()
    await db_session.refresh(audience)
    return EditorAudienceRead.model_validate(audience)


async def update_editor_audience(
    request: Request,
    audience_uuid: str,
    audience_object: EditorAudienceUpdate,
    current_user,
    db_session: AsyncSession,
) -> EditorAudienceRead:
    user = _require_user(current_user)
    audience = await _get_audience(audience_uuid, db_session)
    await _require_manager(user, audience, db_session)
    if audience_object.name is not None:
        audience.name = audience_object.name.strip()
    if audience_object.description is not None:
        audience.description = audience_object.description.strip()
    if audience_object.rules is not None:
        _validate_rules(audience_object.rules)
        audience.rules = audience_object.rules
    audience.update_date = str(datetime.now())
    db_session.add(audience)
    await db_session.commit()
    await db_session.refresh(audience)
    return EditorAudienceRead.model_validate(audience)


async def delete_editor_audience(
    request: Request, audience_uuid: str, current_user, db_session: AsyncSession
) -> dict:
    """Blocks still pointing at a deleted audience hide from everyone, like
    any rule the server can't resolve."""
    user = _require_user(current_user)
    audience = await _get_audience(audience_uuid, db_session)
    await _require_manager(user, audience, db_session)
    await db_session.delete(audience)
    await db_session.commit()
    return {"detail": "Audience deleted"}
