"""Editor templates: blocks or pages an organization's authors save and reuse.

Anyone who can author courses in the org can list, use and create templates.
Changing or deleting one is for its creator, or anyone who may update every
course in the org (admins, maintainers).
"""

import json
from datetime import datetime
from typing import Optional
from uuid import uuid4

from fastapi import HTTPException, Request
from sqlmodel import func, select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.editor_templates import (
    EditorTemplate,
    EditorTemplateCreate,
    EditorTemplateKind,
    EditorTemplateRead,
    EditorTemplateUpdate,
)
from src.db.users import PublicUser
from src.security.org_auth import require_org_role_permission

MAX_TEMPLATE_BYTES = 1024 * 1024
MAX_TEMPLATES_PER_ORG = 500

# Any one of these course rights makes someone an author.
_AUTHOR_ACTIONS = ("action_create", "action_update", "action_update_own")


def _require_user(current_user) -> PublicUser:
    if not isinstance(current_user, PublicUser) or not current_user.id:
        raise HTTPException(status_code=401, detail="Authentication required")
    return current_user


async def _require_author(user: PublicUser, org_id: int, db_session: AsyncSession) -> None:
    denied: Optional[HTTPException] = None
    for action in _AUTHOR_ACTIONS:
        try:
            await require_org_role_permission(user.id, org_id, db_session, "courses", action)
            return
        except HTTPException as exc:
            denied = exc
    raise denied or HTTPException(status_code=403, detail="Not allowed")


async def _require_manager(
    user: PublicUser, template: EditorTemplate, db_session: AsyncSession
) -> None:
    await _require_author(user, template.org_id, db_session)
    if template.creator_id == user.id:
        return
    await require_org_role_permission(user.id, template.org_id, db_session, "courses", "action_update")


def _validate_content(content: dict) -> None:
    if content.get("type") != "doc" or not isinstance(content.get("content"), list) or not content["content"]:
        raise HTTPException(status_code=400, detail="Template content must be a non-empty editor document")
    if len(json.dumps(content)) > MAX_TEMPLATE_BYTES:
        raise HTTPException(status_code=413, detail="Template is too large")


async def _get_template(template_uuid: str, db_session: AsyncSession) -> EditorTemplate:
    template = (await db_session.execute(
        select(EditorTemplate).where(EditorTemplate.template_uuid == template_uuid)
    )).scalars().first()
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")
    return template


async def list_editor_templates(
    request: Request,
    org_id: int,
    kind: Optional[EditorTemplateKind],
    current_user,
    db_session: AsyncSession,
) -> list[EditorTemplateRead]:
    user = _require_user(current_user)
    await _require_author(user, org_id, db_session)
    statement = select(EditorTemplate).where(EditorTemplate.org_id == org_id)
    if kind is not None:
        statement = statement.where(EditorTemplate.kind == kind)
    statement = statement.order_by(EditorTemplate.update_date.desc())  # type: ignore[union-attr]
    templates = (await db_session.execute(statement)).scalars().all()
    return [EditorTemplateRead.model_validate(t) for t in templates]


async def create_editor_template(
    request: Request,
    template_object: EditorTemplateCreate,
    current_user,
    db_session: AsyncSession,
) -> EditorTemplateRead:
    user = _require_user(current_user)
    await _require_author(user, template_object.org_id, db_session)
    _validate_content(template_object.content)

    count = (await db_session.execute(
        select(func.count(EditorTemplate.id)).where(  # type: ignore[arg-type]
            EditorTemplate.org_id == template_object.org_id
        )
    )).scalar_one()
    if count >= MAX_TEMPLATES_PER_ORG:
        raise HTTPException(status_code=400, detail="This organization has reached its template limit")

    now = str(datetime.now())
    template = EditorTemplate(
        name=template_object.name.strip(),
        description=template_object.description.strip(),
        kind=template_object.kind,
        content=template_object.content,
        org_id=template_object.org_id,
        creator_id=user.id,
        template_uuid=f"template_{uuid4()}",
        creation_date=now,
        update_date=now,
    )
    db_session.add(template)
    await db_session.commit()
    await db_session.refresh(template)
    return EditorTemplateRead.model_validate(template)


async def update_editor_template(
    request: Request,
    template_uuid: str,
    template_object: EditorTemplateUpdate,
    current_user,
    db_session: AsyncSession,
) -> EditorTemplateRead:
    user = _require_user(current_user)
    template = await _get_template(template_uuid, db_session)
    await _require_manager(user, template, db_session)

    if template_object.name is not None:
        template.name = template_object.name.strip()
    if template_object.description is not None:
        template.description = template_object.description.strip()
    if template_object.content is not None:
        _validate_content(template_object.content)
        template.content = template_object.content
    template.update_date = str(datetime.now())

    db_session.add(template)
    await db_session.commit()
    await db_session.refresh(template)
    return EditorTemplateRead.model_validate(template)


async def delete_editor_template(
    request: Request,
    template_uuid: str,
    current_user,
    db_session: AsyncSession,
) -> dict:
    user = _require_user(current_user)
    template = await _get_template(template_uuid, db_session)
    await _require_manager(user, template, db_session)
    await db_session.delete(template)
    await db_session.commit()
    return {"detail": "Template deleted"}
