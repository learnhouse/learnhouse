from typing import List

from fastapi import APIRouter, Depends, Query, Request
from sqlmodel.ext.asyncio.session import AsyncSession

from src.core.events.database import get_db_session
from src.db.editor_variables import EditorVariableCreate, EditorVariableRead, EditorVariableUpdate
from src.db.users import PublicUser
from src.security.auth import get_current_user
from src.services.editor_variables import (
    create_editor_variable,
    delete_editor_variable,
    list_editor_variables,
    update_editor_variable,
)

router = APIRouter()


@router.get(
    "/",
    response_model=List[EditorVariableRead],
    summary="List custom variables",
    description="Values the organization defines once and uses anywhere as {{ custom.key }}.",
)
async def api_list_editor_variables(
    request: Request,
    org_id: int = Query(...),
    current_user: PublicUser = Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
) -> List[EditorVariableRead]:
    return await list_editor_variables(request, org_id, current_user, db_session)


@router.post("/", response_model=EditorVariableRead, summary="Create a custom variable")
async def api_create_editor_variable(
    request: Request,
    variable_object: EditorVariableCreate,
    current_user: PublicUser = Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
) -> EditorVariableRead:
    return await create_editor_variable(request, variable_object, current_user, db_session)


@router.put("/{variable_uuid}", response_model=EditorVariableRead, summary="Update a custom variable")
async def api_update_editor_variable(
    request: Request,
    variable_uuid: str,
    variable_object: EditorVariableUpdate,
    current_user: PublicUser = Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
) -> EditorVariableRead:
    return await update_editor_variable(request, variable_uuid, variable_object, current_user, db_session)


@router.delete("/{variable_uuid}", summary="Delete a custom variable")
async def api_delete_editor_variable(
    request: Request,
    variable_uuid: str,
    current_user: PublicUser = Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
) -> dict:
    return await delete_editor_variable(request, variable_uuid, current_user, db_session)
