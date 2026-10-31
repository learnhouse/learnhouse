from typing import List, Optional

from fastapi import APIRouter, Depends, Query, Request
from sqlmodel.ext.asyncio.session import AsyncSession

from src.core.events.database import get_db_session
from src.db.editor_templates import (
    EditorTemplateCreate,
    EditorTemplateKind,
    EditorTemplateRead,
    EditorTemplateUpdate,
)
from src.db.users import PublicUser
from src.security.auth import get_current_user
from src.services.editor_templates import (
    create_editor_template,
    delete_editor_template,
    list_editor_templates,
    update_editor_template,
)

router = APIRouter()


@router.get(
    "/",
    response_model=List[EditorTemplateRead],
    summary="List editor templates",
    description="Templates saved by the organization's authors. Requires course authoring rights in the org.",
)
async def api_list_editor_templates(
    request: Request,
    org_id: int = Query(...),
    kind: Optional[EditorTemplateKind] = Query(default=None),
    current_user: PublicUser = Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
) -> List[EditorTemplateRead]:
    return await list_editor_templates(request, org_id, kind, current_user, db_session)


@router.post(
    "/",
    response_model=EditorTemplateRead,
    summary="Save an editor template",
    description="Save blocks or a whole page as a template the organization's authors can reuse.",
)
async def api_create_editor_template(
    request: Request,
    template_object: EditorTemplateCreate,
    current_user: PublicUser = Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
) -> EditorTemplateRead:
    return await create_editor_template(request, template_object, current_user, db_session)


@router.put(
    "/{template_uuid}",
    response_model=EditorTemplateRead,
    summary="Update an editor template",
    description="Rename or replace a template. Its creator, admins and maintainers can update it.",
)
async def api_update_editor_template(
    request: Request,
    template_uuid: str,
    template_object: EditorTemplateUpdate,
    current_user: PublicUser = Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
) -> EditorTemplateRead:
    return await update_editor_template(request, template_uuid, template_object, current_user, db_session)


@router.delete(
    "/{template_uuid}",
    summary="Delete an editor template",
    description="Delete a template. Its creator, admins and maintainers can delete it.",
)
async def api_delete_editor_template(
    request: Request,
    template_uuid: str,
    current_user: PublicUser = Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
) -> dict:
    return await delete_editor_template(request, template_uuid, current_user, db_session)
