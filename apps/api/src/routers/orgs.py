from typing import List, Literal
from fastapi import APIRouter, Depends, Request, UploadFile
from sqlmodel import Session
from src.services.orgs.invites import (
    create_invite_code,
    create_invite_code_with_usergroup,
    delete_invite_code,
    get_invite_code,
    get_invite_codes,
)
from src.services.orgs.join import JoinOrg, join_org
from src.services.orgs.users import (
    get_list_of_invited_users,
    get_organization_users,
    invite_batch_users,
    remove_invited_user,
    remove_user_from_org,
    update_user_role,
)
from src.db.organization_config import OrganizationConfigBase
from src.db.users import PublicUser
from src.db.organizations import (
    OrganizationCreate,
    OrganizationRead,
    OrganizationUpdate,
    OrganizationUser,
)
from src.core.events.database import get_db_session
from src.security.auth import get_current_user
from src.services.orgs.orgs import (
    create_org,
    create_org_with_config,
    delete_org,
    get_organization,
    get_organization_by_slug,
    get_orgs_by_user,
    get_orgs_by_user_admin,
    update_org,
    update_org_logo,
    update_org_signup_mechanism,
)


router = APIRouter()


@router.post("/")
async def api_create_org(
    request: Request,
    org_object: OrganizationCreate,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
) -> OrganizationRead:
    """
    Create new organization
    """
    return await create_org(request, org_object, current_user, db_session)


# Temporary pre-alpha code
@router.post("/withconfig/")
async def api_create_org_withconfig(
    request: Request,
    org_object: OrganizationCreate,
    config_object: OrganizationConfigBase,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
) -> OrganizationRead:
    """
    Create new organization
    """
    return await create_org_with_config(
        request, org_object, current_user, db_session, config_object
    )


@router.get("/{org_id}")
async def api_get_org(
    request: Request,
    org_id: str,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
) -> OrganizationRead:
    """
    Get single Org by ID
    """
    return await get_organization(request, org_id, db_session, current_user)


@router.get("/{org_id}/users")
async def api_get_org_users(
    request: Request,
    org_id: str,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
) -> list[OrganizationUser]:
    """
    Get single Org by ID
    """
    return await get_organization_users(request, org_id, db_session, current_user)


@router.post("/join")
async def api_join_an_org(
    request: Request,
    args: JoinOrg,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
):
    """
    Get single Org by ID
    """
    return await join_org(request, args, current_user, db_session)


@router.put("/{org_id}/users/{user_id}/role/{role_uuid}")
async def api_update_user_role(
    request: Request,
    org_id: str,
    user_id: str,
    role_uuid: str,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
):
    """
    Update user role
    """
    return await update_user_role(
        request, org_id, user_id, role_uuid, db_session, current_user
    )


@router.delete("/{org_id}/users/{user_id}")
async def api_remove_user_from_org(
    request: Request,
    org_id: int,
    user_id: int,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
):
    """
    Remove user from org
    """
    return await remove_user_from_org(
        request, org_id, user_id, db_session, current_user
    )


# Config related routes
@router.put("/{org_id}/signup_mechanism")
async def api_get_org_signup_mechanism(
    request: Request,
    org_id: int,
    signup_mechanism: Literal["open", "inviteOnly"],
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
):
    """
    Get org signup mechanism
    """
    return await update_org_signup_mechanism(
        request, signup_mechanism, org_id, current_user, db_session
    )


# Invites related routes
@router.post("/{org_id}/invites")
async def api_create_invite_code(
    request: Request,
    org_id: int,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
):
    """
    Create invite code
    """
    return await create_invite_code(request, org_id, current_user, db_session)


@router.post("/{org_id}/invites_with_usergroups")
async def api_create_invite_code_with_ug(
    request: Request,
    org_id: int,
    usergroup_id: int,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
):
    """
    Create invite code
    """
    return await create_invite_code_with_usergroup(
        request, org_id, usergroup_id, current_user, db_session
    )


@router.get("/{org_id}/invites")
async def api_get_invite_codes(
    request: Request,
    org_id: int,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
):
    """
    Get invite codes
    """
    return await get_invite_codes(request, org_id, current_user, db_session)


@router.get("/{org_id}/invites/code/{invite_code}")
async def api_get_invite_code(
    request: Request,
    org_id: int,
    invite_code: str,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
):
    """
    Get invite code
    """
    print(f"org_id: {org_id}, invite_code: {invite_code}")
    return await get_invite_code(request, org_id, invite_code, current_user, db_session)


@router.delete("/{org_id}/invites/{org_invite_code_uuid}")
async def api_delete_invite_code(
    request: Request,
    org_id: int,
    org_invite_code_uuid: str,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
):
    """
    Delete invite code
    """
    return await delete_invite_code(
        request, org_id, org_invite_code_uuid, current_user, db_session
    )


@router.post("/{org_id}/invites/users/batch")
async def api_invite_batch_users(
    request: Request,
    org_id: int,
    emails: str,
    invite_code_uuid: str,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
):
    """
    Invite batch users by emails
    """
    return await invite_batch_users(
        request, org_id, emails, invite_code_uuid, db_session, current_user
    )


@router.get("/{org_id}/invites/users")
async def api_get_org_users_invites(
    request: Request,
    org_id: int,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
):
    """
    Get org users invites
    """
    return await get_list_of_invited_users(request, org_id, db_session, current_user)


@router.delete("/{org_id}/invites/users/{email}")
async def api_delete_org_users_invites(
    request: Request,
    org_id: int,
    email: str,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
):
    """
    Delete org users invites
    """
    return await remove_invited_user(request, org_id, email, db_session, current_user)


@router.get("/slug/{org_slug}")
async def api_get_org_by_slug(
    request: Request,
    org_slug: str,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
) -> OrganizationRead:
    """
    Get single Org by Slug
    """
    return await get_organization_by_slug(request, org_slug, db_session, current_user)


@router.put("/{org_id}/logo")
async def api_update_org_logo(
    request: Request,
    org_id: str,
    logo_file: UploadFile,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
):
    """
    Get single Org by Slug
    """
    return await update_org_logo(
        request=request,
        logo_file=logo_file,
        org_id=org_id,
        current_user=current_user,
        db_session=db_session,
    )


@router.get("/user/page/{page}/limit/{limit}")
async def api_user_orgs(
    request: Request,
    page: int,
    limit: int,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
) -> List[OrganizationRead]:
    """
    Get orgs by page and limit by current user
    """
    return await get_orgs_by_user(
        request, db_session, str(current_user.id), page, limit
    )


@router.get("/user_admin/page/{page}/limit/{limit}")
async def api_user_orgs_admin(
    request: Request,
    page: int,
    limit: int,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
) -> List[OrganizationRead]:
    """
    Get orgs by page and limit by current user
    """
    return await get_orgs_by_user_admin(
        request, db_session, str(current_user.id), page, limit
    )


@router.put("/{org_id}")
async def api_update_org(
    request: Request,
    org_object: OrganizationUpdate,
    org_id: int,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
) -> OrganizationRead:
    """
    Update Org by ID
    """
    return await update_org(request, org_object, org_id, current_user, db_session)


@router.delete("/{org_id}")
async def api_delete_org(
    request: Request,
    org_id: int,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
):
    """
    Delete Org by ID
    """

    return await delete_org(request, org_id, current_user, db_session)
