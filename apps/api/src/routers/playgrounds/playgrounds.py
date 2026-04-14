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


@router.post(
    "/",
    response_model=PlaygroundRead,
    summary="Create a playground",
    description="Create a new playground within an organization. The authenticated user must have permission to create playgrounds in the target org.",
    responses={
        200: {"description": "Playground created successfully.", "model": PlaygroundRead},
        401: {"description": "Authentication required"},
        403: {"description": "Insufficient permissions to create playgrounds"},
        404: {"description": "Organization not found"},
    },
)
async def api_create_playground(
    request: Request,
    org_id: int,
    playground_object: PlaygroundCreate,
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
) -> PlaygroundRead:
    return await create_playground(request, org_id, playground_object, current_user, db_session)


@router.get(
    "/org/{org_id}",
    response_model=List[PlaygroundRead],
    summary="List playgrounds for an organization",
    description="List all playgrounds in the given organization that the current user is allowed to see.",
    responses={
        200: {"description": "List of playgrounds accessible to the current user.", "model": List[PlaygroundRead]},
        401: {"description": "Authentication required"},
        403: {"description": "Access denied to this organization"},
    },
)
async def api_list_org_playgrounds(
    request: Request,
    org_id: int,
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
) -> List[PlaygroundRead]:
    return await list_org_playgrounds(request, org_id, current_user, db_session)


@router.get(
    "/{playground_uuid}",
    response_model=PlaygroundRead,
    summary="Get a playground by UUID",
    description="Retrieve a single playground by its UUID. The current user must have access to the playground.",
    responses={
        200: {"description": "The requested playground.", "model": PlaygroundRead},
        401: {"description": "Authentication required"},
        403: {"description": "Access denied to this playground"},
        404: {"description": "Playground not found"},
    },
)
async def api_get_playground(
    request: Request,
    playground_uuid: str,
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
) -> PlaygroundRead:
    return await get_playground(request, playground_uuid, current_user, db_session)


@router.put(
    "/{playground_uuid}",
    response_model=PlaygroundRead,
    summary="Update a playground",
    description="Update a playground's fields. The current user must have update permission on the playground.",
    responses={
        200: {"description": "Playground updated successfully.", "model": PlaygroundRead},
        401: {"description": "Authentication required"},
        403: {"description": "Insufficient permissions to update playground"},
        404: {"description": "Playground not found"},
    },
)
async def api_update_playground(
    request: Request,
    playground_uuid: str,
    playground_object: PlaygroundUpdate,
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
) -> PlaygroundRead:
    return await update_playground(request, playground_uuid, playground_object, current_user, db_session)


@router.delete(
    "/{playground_uuid}",
    summary="Delete a playground",
    description="Delete a playground by UUID. The current user must have delete permission on the playground.",
    responses={
        200: {"description": "Playground deleted successfully."},
        401: {"description": "Authentication required"},
        403: {"description": "Insufficient permissions to delete playground"},
        404: {"description": "Playground not found"},
    },
)
async def api_delete_playground(
    request: Request,
    playground_uuid: str,
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
) -> dict:
    return await delete_playground(request, playground_uuid, current_user, db_session)


@router.post(
    "/{playground_uuid}/duplicate",
    response_model=PlaygroundRead,
    summary="Duplicate a playground",
    description="Create a copy of an existing playground. The current user must have permission to create playgrounds in the source org.",
    responses={
        200: {"description": "Playground duplicated successfully.", "model": PlaygroundRead},
        401: {"description": "Authentication required"},
        403: {"description": "Insufficient permissions to create playgrounds"},
        404: {"description": "Playground not found"},
    },
)
async def api_duplicate_playground(
    request: Request,
    playground_uuid: str,
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
) -> PlaygroundRead:
    return await duplicate_playground(request, playground_uuid, current_user, db_session)


@router.post(
    "/{playground_uuid}/thumbnail",
    response_model=PlaygroundRead,
    summary="Upload a playground thumbnail",
    description="Upload or replace the thumbnail image for a playground. The current user must have update permission on the playground.",
    responses={
        200: {"description": "Thumbnail uploaded and playground updated.", "model": PlaygroundRead},
        400: {"description": "No thumbnail file provided"},
        401: {"description": "Authentication required"},
        403: {"description": "Insufficient permissions to update playground"},
        404: {"description": "Playground or organization not found"},
    },
)
async def api_update_playground_thumbnail(
    request: Request,
    playground_uuid: str,
    thumbnail: UploadFile = File(...),
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
) -> PlaygroundRead:
    return await update_playground_thumbnail(request, playground_uuid, current_user, db_session, thumbnail)


@router.post(
    "/{playground_uuid}/usergroups/{usergroup_uuid}",
    summary="Grant a usergroup access to a playground",
    description="Associate a usergroup with a playground so its members can access it. The current user must have update permission on the playground.",
    responses={
        200: {"description": "Usergroup granted access to playground."},
        401: {"description": "Authentication required"},
        403: {"description": "Insufficient permissions"},
        404: {"description": "Playground or user group not found"},
    },
)
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


@router.delete(
    "/{playground_uuid}/usergroups/{usergroup_uuid}",
    summary="Revoke a usergroup from a playground",
    description="Remove a usergroup's access to a playground. The current user must have update permission on the playground.",
    responses={
        200: {"description": "Usergroup removed from playground."},
        401: {"description": "Authentication required"},
        403: {"description": "Insufficient permissions"},
        404: {"description": "Playground, user group, or association not found"},
    },
)
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


@router.get(
    "/{playground_uuid}/usergroups",
    response_model=List[dict],
    summary="List usergroups attached to a playground",
    description="Return the list of usergroups that have access to a given playground.",
    responses={
        200: {"description": "List of usergroups associated with the playground."},
        401: {"description": "Authentication required"},
        403: {"description": "Access denied to this playground"},
        404: {"description": "Playground not found"},
    },
)
async def api_get_playground_usergroups(
    request: Request,
    playground_uuid: str,
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
) -> List[dict]:
    return await get_playground_usergroups(request, playground_uuid, current_user, db_session)


@router.get(
    "/{playground_uuid}/reactions",
    response_model=List[PlaygroundReactionSummary],
    summary="List reactions on a playground",
    description="Return reaction counts and the current user's reactions for a playground. Supports anonymous viewers.",
    responses={
        200: {"description": "Aggregated reaction summary for the playground.", "model": List[PlaygroundReactionSummary]},
        404: {"description": "Playground not found"},
    },
)
async def api_get_playground_reactions(
    request: Request,
    playground_uuid: str,
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser | AnonymousUser = Depends(get_current_user),
) -> List[PlaygroundReactionSummary]:
    return await get_playground_reactions(request, playground_uuid, current_user, db_session)


@router.post(
    "/{playground_uuid}/reactions",
    summary="Toggle a reaction on a playground",
    description="Toggle the current user's reaction (emoji) on a playground. Adds the reaction if missing or removes it if already present.",
    responses={
        200: {"description": "Reaction toggled successfully."},
        401: {"description": "Authentication required"},
        404: {"description": "Playground not found"},
    },
)
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
