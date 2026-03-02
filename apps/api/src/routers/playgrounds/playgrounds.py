from typing import List
from fastapi import APIRouter, Depends, File, Request, UploadFile
from sqlmodel import Session

from src.core.events.database import get_db_session
from src.db.playgrounds import PlaygroundCreate, PlaygroundRead, PlaygroundUpdate
from src.db.playground_reactions import PlaygroundReactionSummary
from src.db.users import PublicUser, AnonymousUser
from src.security.auth import get_current_user
from src.security.features_utils.dependencies import require_playgrounds_feature
from src.services.playgrounds.playgrounds import (
    create_playground,
    get_playground,
    list_org_playgrounds,
    update_playground,
    update_playground_thumbnail,
    delete_playground,
    duplicate_playground,
    add_usergroup_to_playground,
    remove_usergroup_from_playground,
    get_playground_usergroups,
)
from src.services.playgrounds.playground_reactions import (
    get_playground_reactions,
    toggle_playground_reaction,
)

router = APIRouter(dependencies=[Depends(require_playgrounds_feature)])


@router.post("/")
async def api_create_playground(
    request: Request,
    org_id: int,
    playground_object: PlaygroundCreate,
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
) -> PlaygroundRead:
    return await create_playground(request, org_id, playground_object, current_user, db_session)


@router.get("/org/{org_id}")
async def api_list_org_playgrounds(
    request: Request,
    org_id: int,
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
) -> List[PlaygroundRead]:
    return await list_org_playgrounds(request, org_id, current_user, db_session)


@router.get("/{playground_uuid}")
async def api_get_playground(
    request: Request,
    playground_uuid: str,
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
) -> PlaygroundRead:
    return await get_playground(request, playground_uuid, current_user, db_session)


@router.put("/{playground_uuid}")
async def api_update_playground(
    request: Request,
    playground_uuid: str,
    playground_object: PlaygroundUpdate,
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
) -> PlaygroundRead:
    return await update_playground(request, playground_uuid, playground_object, current_user, db_session)


@router.delete("/{playground_uuid}")
async def api_delete_playground(
    request: Request,
    playground_uuid: str,
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
) -> dict:
    return await delete_playground(request, playground_uuid, current_user, db_session)


@router.post("/{playground_uuid}/duplicate")
async def api_duplicate_playground(
    request: Request,
    playground_uuid: str,
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
) -> PlaygroundRead:
    return await duplicate_playground(request, playground_uuid, current_user, db_session)


@router.post("/{playground_uuid}/thumbnail")
async def api_update_playground_thumbnail(
    request: Request,
    playground_uuid: str,
    thumbnail: UploadFile = File(...),
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
) -> PlaygroundRead:
    return await update_playground_thumbnail(request, playground_uuid, current_user, db_session, thumbnail)


@router.post("/{playground_uuid}/usergroups/{usergroup_uuid}")
async def api_add_usergroup_to_playground(
    request: Request,
    playground_uuid: str,
    usergroup_uuid: str,
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
) -> dict:
    return await add_usergroup_to_playground(
        request, playground_uuid, usergroup_uuid, current_user, db_session
    )


@router.delete("/{playground_uuid}/usergroups/{usergroup_uuid}")
async def api_remove_usergroup_from_playground(
    request: Request,
    playground_uuid: str,
    usergroup_uuid: str,
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
) -> dict:
    return await remove_usergroup_from_playground(
        request, playground_uuid, usergroup_uuid, current_user, db_session
    )


@router.get("/{playground_uuid}/usergroups")
async def api_get_playground_usergroups(
    request: Request,
    playground_uuid: str,
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
) -> List[dict]:
    return await get_playground_usergroups(request, playground_uuid, current_user, db_session)


@router.get("/{playground_uuid}/reactions")
async def api_get_playground_reactions(
    request: Request,
    playground_uuid: str,
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser | AnonymousUser = Depends(get_current_user),
) -> List[PlaygroundReactionSummary]:
    return await get_playground_reactions(request, playground_uuid, current_user, db_session)


@router.post("/{playground_uuid}/reactions")
async def api_toggle_playground_reaction(
    request: Request,
    playground_uuid: str,
    reaction: dict,
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
) -> dict:
    return await toggle_playground_reaction(
        request, playground_uuid, reaction.get("emoji", ""), current_user, db_session
    )
