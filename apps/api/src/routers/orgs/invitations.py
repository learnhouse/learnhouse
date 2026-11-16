"""Invitations and invite codes, the dashboard side.

Mounted under ``/orgs`` for signed-in sessions only (API tokens are refused
like on the rest of the org routes). Every handler checks the org write right
(Admin or Maintainer) in the service, scoped to ``org_id``.
"""

from typing import Optional

from fastapi import APIRouter, Depends, Query, Request
from sqlmodel.ext.asyncio.session import AsyncSession

from src.core.events.database import get_db_session
from src.db.users import PublicUser
from src.security.auth import get_current_user
from src.services.orgs.invitations import codes, service

router = APIRouter()

_AUTH = {401: {"description": "Not authenticated"}, 403: {"description": "Not an administrator or maintainer of this organization"}}


@router.get(
    "/{org_id}/invitations",
    summary="List invitations",
    description="Email invitations of the organization with their status, role, groups, courses, sender and expiry.",
    responses={200: {"description": "A page of invitations, the counts per status and older invitations still pending."}, **_AUTH},
)
async def api_list_invitations(
    request: Request,
    org_id: int,
    status: Optional[str] = Query(None, description="pending, accepted, declined, revoked or expired"),
    q: Optional[str] = Query(None, max_length=200, description="Filter by email"),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=service.PAGE_LIMIT),
    current_user: PublicUser = Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
) -> dict:
    return await service.list_invitations(request, db_session, org_id, current_user, status, q, page, limit)


@router.get(
    "/{org_id}/invitations/options",
    summary="Invitation options",
    description="The roles the caller may grant (and which take an admin seat or may go on an invite code), plan capacity and expiry bounds.",
    responses={200: {"description": "Options."}, **_AUTH},
)
async def api_invitation_options(
    request: Request,
    org_id: int,
    current_user: PublicUser = Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
) -> dict:
    return await service.invitation_options(request, db_session, org_id, current_user)


@router.post(
    "/{org_id}/invitations/preview",
    summary="Preview invitations",
    description="Which addresses are new, already invited, already members or invalid, and whether the plan has room. Sends nothing.",
    responses={200: {"description": "Preview."}, **_AUTH},
)
async def api_preview_invitations(
    request: Request,
    org_id: int,
    body: service.InvitationPreview,
    current_user: PublicUser = Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
) -> dict:
    return await service.preview_invitations(request, db_session, org_id, body, current_user)


@router.post(
    "/{org_id}/invitations",
    summary="Invite people",
    description=(
        "Email personal invitations with a role, user groups, courses, a note and an expiry. Existing members are "
        "skipped unless update_existing_members is set."
    ),
    responses={
        200: {"description": "One result per address and a summary."},
        400: {"description": "No valid address, too many at once, or an invalid message or expiry"},
        403: {"description": "Not allowed to grant that role, or a plan limit"},
        404: {"description": "Role, user group or course not found"},
        429: {"description": "Daily invitation limit reached"},
    },
)
async def api_create_invitations(
    request: Request,
    org_id: int,
    body: service.InvitationCreate,
    current_user: PublicUser = Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
) -> dict:
    return await service.create_invitations(request, db_session, org_id, body, current_user)


@router.post(
    "/{org_id}/invitations/bulk",
    summary="Resend or revoke several invitations",
    responses={200: {"description": "One result per invitation."}, **_AUTH},
)
async def api_bulk_invitations(
    request: Request,
    org_id: int,
    body: service.InvitationBulk,
    current_user: PublicUser = Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
) -> dict:
    return await service.bulk_invitations(request, db_session, org_id, body, current_user)


@router.patch(
    "/{org_id}/invitations/{invitation_uuid}",
    summary="Change a pending invitation",
    description="Change the role, user groups, courses, note or expiry of a pending invitation.",
    responses={200: {"description": "The invitation."}, 404: {"description": "Not found"}, 409: {"description": "Not pending"}, **_AUTH},
)
async def api_update_invitation(
    request: Request,
    org_id: int,
    invitation_uuid: str,
    body: service.InvitationUpdate,
    current_user: PublicUser = Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
) -> dict:
    return await service.update_invitation(request, db_session, org_id, invitation_uuid, body, current_user)


@router.post(
    "/{org_id}/invitations/{invitation_uuid}/resend",
    summary="Resend an invitation",
    description="Emails a new personal link (the previous one stops working) and restarts the expiry.",
    responses={200: {"description": "The invitation."}, 404: {"description": "Not found"}, 409: {"description": "Accepted, declined or revoked"}, **_AUTH},
)
async def api_resend_invitation(
    request: Request,
    org_id: int,
    invitation_uuid: str,
    body: Optional[service.InvitationResend] = None,
    current_user: PublicUser = Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
) -> dict:
    return await service.resend_invitation(request, db_session, org_id, invitation_uuid, body or service.InvitationResend(), current_user)


@router.post(
    "/{org_id}/invitations/{invitation_uuid}/link",
    summary="Get a shareable link for an invitation",
    description="Mints a new personal link to share by hand; the link in the earlier email stops working.",
    responses={200: {"description": "The link."}, 404: {"description": "Not found"}, 409: {"description": "Not pending"}, **_AUTH},
)
async def api_invitation_link(
    request: Request,
    org_id: int,
    invitation_uuid: str,
    current_user: PublicUser = Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
) -> dict:
    return await service.invitation_link(request, db_session, org_id, invitation_uuid, current_user)


@router.post(
    "/{org_id}/invitations/{invitation_uuid}/revoke",
    summary="Revoke an invitation",
    responses={200: {"description": "The invitation."}, 404: {"description": "Not found"}, 409: {"description": "Already accepted, declined or revoked"}, **_AUTH},
)
async def api_revoke_invitation(
    request: Request,
    org_id: int,
    invitation_uuid: str,
    current_user: PublicUser = Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
) -> dict:
    return await service.revoke_invitation(request, db_session, org_id, invitation_uuid, current_user)


@router.get(
    "/{org_id}/invite-codes",
    summary="List invite codes",
    description="Shareable invite codes with their role, groups, courses, uses and expiry.",
    responses={200: {"description": "Invite codes."}, **_AUTH},
)
async def api_list_invite_codes(
    request: Request,
    org_id: int,
    current_user: PublicUser = Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
) -> list:
    return await codes.list_codes(request, db_session, org_id, current_user)


@router.post(
    "/{org_id}/invite-codes",
    summary="Create an invite code",
    description="A shareable code with a non-management role, optional groups, courses, use cap and expiry.",
    responses={
        200: {"description": "The code."},
        400: {"description": "Role not allowed on a code, or too many live codes"},
        404: {"description": "Role, user group or course not found"},
        **_AUTH,
    },
)
async def api_create_invite_code(
    request: Request,
    org_id: int,
    body: codes.InviteCodeCreate,
    current_user: PublicUser = Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
) -> dict:
    return await codes.create_code(request, db_session, org_id, body, current_user)


@router.patch(
    "/{org_id}/invite-codes/{code_uuid}",
    summary="Change an invite code",
    responses={200: {"description": "The code."}, 404: {"description": "Not found"}, **_AUTH},
)
async def api_update_invite_code(
    request: Request,
    org_id: int,
    code_uuid: str,
    body: codes.InviteCodeUpdate,
    current_user: PublicUser = Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
) -> dict:
    return await codes.update_code(request, db_session, org_id, code_uuid, body, current_user)


@router.delete(
    "/{org_id}/invite-codes/{code_uuid}",
    summary="Delete an invite code",
    responses={200: {"description": "Deleted."}, 404: {"description": "Not found"}, **_AUTH},
)
async def api_delete_invite_code(
    request: Request,
    org_id: int,
    code_uuid: str,
    current_user: PublicUser = Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
) -> dict:
    from src.services.orgs.invites import delete_invite_code

    result = await delete_invite_code(request, org_id, code_uuid, current_user, db_session)
    # A legacy Redis code answers with the deleted keys.
    return result if isinstance(result, dict) else {"invite_code_uuid": code_uuid, "revoked": True}
