"""Custom variables: values an organization's authors define once and use in
any activity as {{ custom.key }}, optionally varying by audience.

Same rights as saved audiences: any author may create one; changing or
deleting one changes text in every course, so that takes the right to update
every course in the org.
"""

import json
from datetime import datetime
from uuid import uuid4

from fastapi import HTTPException, Request
from sqlmodel import func, select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.editor_variables import (
    EditorVariable,
    EditorVariableCreate,
    EditorVariableRead,
    EditorVariableUpdate,
    EditorVariableVariant,
)
from src.security.org_auth import require_org_role_permission
from src.services.editor_templates import _require_author, _require_user

MAX_VARIABLES_PER_ORG = 200
MAX_VARIANT_RULES_BYTES = 50 * 1024


def _variants(variants: list[EditorVariableVariant]) -> list[dict]:
    for variant in variants:
        if not isinstance(variant.rules.get("conditions"), list):
            raise HTTPException(status_code=400, detail="Each variant needs a list of conditions")
    data = [variant.model_dump() for variant in variants]
    if len(json.dumps(data)) > MAX_VARIANT_RULES_BYTES:
        raise HTTPException(status_code=413, detail="Variant rules are too large")
    return data


async def _get_variable(variable_uuid: str, db_session: AsyncSession) -> EditorVariable:
    variable = (await db_session.execute(
        select(EditorVariable).where(EditorVariable.variable_uuid == variable_uuid)
    )).scalars().first()
    if not variable:
        raise HTTPException(status_code=404, detail="Variable not found")
    return variable


async def _require_course_wide_editor(user, variable: EditorVariable, db_session: AsyncSession) -> None:
    await _require_author(user, variable.org_id, db_session)
    await require_org_role_permission(user.id, variable.org_id, db_session, "courses", "action_update")


async def list_editor_variables(
    request: Request, org_id: int, current_user, db_session: AsyncSession
) -> list[EditorVariableRead]:
    user = _require_user(current_user)
    await _require_author(user, org_id, db_session)
    variables = (await db_session.execute(
        select(EditorVariable).where(EditorVariable.org_id == org_id).order_by(EditorVariable.key)
    )).scalars().all()
    return [EditorVariableRead.model_validate(v) for v in variables]


async def create_editor_variable(
    request: Request, variable_object: EditorVariableCreate, current_user, db_session: AsyncSession
) -> EditorVariableRead:
    user = _require_user(current_user)
    await _require_author(user, variable_object.org_id, db_session)
    variants = _variants(variable_object.variants)
    taken = (await db_session.execute(
        select(EditorVariable.id).where(
            EditorVariable.org_id == variable_object.org_id, EditorVariable.key == variable_object.key
        )
    )).first()
    if taken:
        raise HTTPException(status_code=409, detail="A variable with this key already exists")
    count = (await db_session.execute(
        select(func.count(EditorVariable.id)).where(  # type: ignore[arg-type]
            EditorVariable.org_id == variable_object.org_id
        )
    )).scalar_one()
    if count >= MAX_VARIABLES_PER_ORG:
        raise HTTPException(status_code=400, detail="This organization has reached its variable limit")

    now = str(datetime.now())
    variable = EditorVariable(
        key=variable_object.key,
        label=variable_object.label.strip(),
        description=variable_object.description.strip(),
        default_value=variable_object.default_value,
        variants=variants,
        org_id=variable_object.org_id,
        creator_id=user.id,
        variable_uuid=f"variable_{uuid4()}",
        creation_date=now,
        update_date=now,
    )
    db_session.add(variable)
    await db_session.commit()
    await db_session.refresh(variable)
    return EditorVariableRead.model_validate(variable)


async def update_editor_variable(
    request: Request,
    variable_uuid: str,
    variable_object: EditorVariableUpdate,
    current_user,
    db_session: AsyncSession,
) -> EditorVariableRead:
    """The key can't change: activities refer to it by name."""
    user = _require_user(current_user)
    variable = await _get_variable(variable_uuid, db_session)
    await _require_course_wide_editor(user, variable, db_session)
    if variable_object.label is not None:
        variable.label = variable_object.label.strip()
    if variable_object.description is not None:
        variable.description = variable_object.description.strip()
    if variable_object.default_value is not None:
        variable.default_value = variable_object.default_value
    if variable_object.variants is not None:
        variable.variants = _variants(variable_object.variants)
    variable.update_date = str(datetime.now())
    db_session.add(variable)
    await db_session.commit()
    await db_session.refresh(variable)
    return EditorVariableRead.model_validate(variable)


async def delete_editor_variable(
    request: Request, variable_uuid: str, current_user, db_session: AsyncSession
) -> dict:
    """Text still using a deleted variable shows its fallback, or nothing."""
    user = _require_user(current_user)
    variable = await _get_variable(variable_uuid, db_session)
    await _require_course_wide_editor(user, variable, db_session)
    await db_session.delete(variable)
    await db_session.commit()
    return {"detail": "Variable deleted"}
