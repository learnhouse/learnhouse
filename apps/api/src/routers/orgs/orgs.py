from typing import List, Literal, Optional, Union
from fastapi import APIRouter, Depends, Request, UploadFile, Query
from sqlmodel import Session
from src.services.orgs.invites import (
    create_invite_code,
    delete_invite_code,
    get_invite_code,
    get_invite_codes,
)
from src.services.orgs.join import JoinOrg, join_org
from src.services.orgs.users import (
    get_list_of_invited_users,
    get_organization_users,
    invite_batch_users,
    remove_batch_users_from_org,
    remove_invited_user,
    remove_user_from_org,
    update_user_role,
)
from src.db.organization_config import OrganizationConfigBase
from src.db.users import AnonymousUser, PublicUser
from src.db.organizations import (
    OrganizationCreate,
    OrganizationRead,
    OrganizationUpdate,
)
from src.core.events.database import get_db_session
from src.security.auth import get_current_user, get_authenticated_user
from src.security.features_utils.dependencies import require_org_admin
from src.services.orgs.orgs import (
    create_org,
    create_org_with_config,
    delete_org,
    get_organization_by_uuid,
    get_organization_by_slug,
    get_orgs_by_user,
    get_orgs_by_user_admin,
    update_org,
    update_org_logo,
    update_org_preview,
    update_org_signup_mechanism,
    update_org_ai_config,
    update_org_communities_config,
    update_org_payments_config,
    update_org_collections_config,
    update_org_courses_config,
    update_org_podcasts_config,
    update_org_docs_config,
    update_org_color_config,
    update_org_footer_text_config,
    update_org_thumbnail,
    update_org_landing,
    upload_org_landing_content_service,
    update_org_auth_branding_config,
    upload_org_auth_background_service,
)
from src.db.organization_config import AuthBrandingConfig


router = APIRouter()

# Sub-router for feature config endpoints (admin-only)
feature_config_router = APIRouter(
    tags=["Feature Configuration"],
    dependencies=[Depends(require_org_admin)],
)


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


@router.get("/uuid/{org_uuid}")
async def api_get_org_by_uuid(
    request: Request,
    org_uuid: str,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
) -> OrganizationRead:
    """
    Get single Org by UUID
    """
    return await get_organization_by_uuid(request, org_uuid, db_session, current_user)


@router.get("/{org_id}/users")
async def api_get_org_users(
    request: Request,
    org_id: str,
    page: int = Query(default=1, ge=1, description="Page number"),
    limit: int = Query(default=20, ge=1, le=100, description="Items per page (max 100)"),
    search: str = "",
    usergroup_id: Optional[int] = Query(default=None, description="Filter by usergroup membership"),
    usergroup_filter: Optional[Literal["in_group", "not_in_group"]] = Query(default=None, description="Membership filter: 'in_group' or 'not_in_group'"),
    sort_order: Optional[Literal["asc", "desc"]] = Query(default="desc", description="Sort order for join date"),
    role_id: Optional[int] = Query(default=None, description="Filter by role ID"),
    status: Optional[Literal["verified", "unverified"]] = Query(default=None, description="Filter by verification status"),
    current_user: PublicUser = Depends(get_authenticated_user),
    db_session: Session = Depends(get_db_session),
):
    """
    Get organization users with pagination and search.

    SECURITY:
    - Requires authentication (no anonymous access)
    - Maximum limit is 100 to prevent data dumping attacks
    - Only org members can list other org members
    """
    return await get_organization_users(
        request, org_id, db_session, current_user, page, limit, search,
        usergroup_id, usergroup_filter, sort_order or "desc", role_id, status,
    )


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


@router.delete("/{org_id}/users/batch/remove")
async def api_remove_batch_users_from_org(
    request: Request,
    org_id: int,
    user_ids: List[int] = Query(..., description="List of user IDs to remove"),
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
):
    """
    Remove multiple users from org in batch
    """
    return await remove_batch_users_from_org(
        request, org_id, user_ids, db_session, current_user
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


# ============================================================================
# Feature config routes (admin-only via router-level dependency)
# ============================================================================


@feature_config_router.put("/{org_id}/config/ai")
async def api_update_org_ai_config(
    request: Request,
    org_id: int,
    ai_enabled: bool,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
):
    """
    Update organization AI configuration (admin-only)
    """
    return await update_org_ai_config(
        request, ai_enabled, org_id, current_user, db_session
    )


@feature_config_router.put("/{org_id}/config/communities")
async def api_update_org_communities_config(
    request: Request,
    org_id: int,
    communities_enabled: bool,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
):
    """
    Update organization communities configuration (admin-only)
    """
    return await update_org_communities_config(
        request, communities_enabled, org_id, current_user, db_session
    )


@feature_config_router.put("/{org_id}/config/payments")
async def api_update_org_payments_config(
    request: Request,
    org_id: int,
    payments_enabled: bool,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
):
    """
    Update organization payments configuration (admin-only)
    """
    return await update_org_payments_config(
        request, payments_enabled, org_id, current_user, db_session
    )


@feature_config_router.put("/{org_id}/config/courses")
async def api_update_org_courses_config(
    request: Request,
    org_id: int,
    courses_enabled: bool,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
):
    """
    Update organization courses configuration (admin-only)
    """
    return await update_org_courses_config(
        request, courses_enabled, org_id, current_user, db_session
    )


@feature_config_router.put("/{org_id}/config/collections")
async def api_update_org_collections_config(
    request: Request,
    org_id: int,
    collections_enabled: bool,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
):
    """
    Update organization collections configuration (admin-only)
    """
    return await update_org_collections_config(
        request, collections_enabled, org_id, current_user, db_session
    )


@feature_config_router.put("/{org_id}/config/podcasts")
async def api_update_org_podcasts_config(
    request: Request,
    org_id: int,
    podcasts_enabled: bool,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
):
    """
    Update organization podcasts configuration (admin-only)
    """
    return await update_org_podcasts_config(
        request, podcasts_enabled, org_id, current_user, db_session
    )


@feature_config_router.put("/{org_id}/config/docs")
async def api_update_org_docs_config(
    request: Request,
    org_id: int,
    docs_enabled: bool,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
):
    """
    Update organization docs configuration (admin-only)
    """
    return await update_org_docs_config(
        request, docs_enabled, org_id, current_user, db_session
    )


@router.put("/{org_id}/config/color")
async def api_update_org_color_config(
    request: Request,
    org_id: int,
    color: str = "",
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
):
    """
    Update organization color configuration
    """
    return await update_org_color_config(
        request, color, org_id, current_user, db_session
    )


@router.put("/{org_id}/config/footer_text")
async def api_update_org_footer_text_config(
    request: Request,
    org_id: int,
    footer_text: str = "",
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
):
    """
    Update organization footer text configuration
    """
    return await update_org_footer_text_config(
        request, footer_text, org_id, current_user, db_session
    )


@router.put("/{org_id}/config/auth_branding")
async def api_update_org_auth_branding_config(
    request: Request,
    org_id: int,
    auth_branding: AuthBrandingConfig,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
):
    """
    Update organization auth branding configuration
    """
    return await update_org_auth_branding_config(
        request, auth_branding, org_id, current_user, db_session
    )


@router.put("/{org_id}/auth_background")
async def api_upload_org_auth_background(
    request: Request,
    org_id: int,
    background_file: UploadFile,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
):
    """
    Upload auth page background image
    """
    return await upload_org_auth_background_service(
        request=request,
        background_file=background_file,
        org_id=org_id,
        current_user=current_user,
        db_session=db_session,
    )


# Invites related routes
@router.post("/{org_id}/invites")
async def api_create_invite_code(
    request: Request,
    org_id: int,
    usergroup_id: Optional[int] = None,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
):
    """
    Create invite code, optionally linked to a usergroup
    """
    return await create_invite_code(request, org_id, current_user, db_session, usergroup_id)


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
    org_id: int,
    logo_file: UploadFile,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
):
    """
    Update org logo
    """
    return await update_org_logo(
        request=request,
        logo_file=logo_file,
        org_id=org_id,
        current_user=current_user,
        db_session=db_session,
    )


@router.put("/{org_id}/thumbnail")
async def api_update_org_thumbnail(
    request: Request,
    org_id: int,
    thumbnail_file: UploadFile,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
):
    """
    Update org thumbnail
    """
    return await update_org_thumbnail(
        request=request,
        thumbnail_file=thumbnail_file,
        org_id=org_id,
        current_user=current_user,
        db_session=db_session,
    )

@router.put("/{org_id}/preview")
async def api_update_org_preview(
    request: Request,
    org_id: int,
    preview_file: UploadFile,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
):
    """
    Update org preview
    """
    return await update_org_preview(
        request=request,
        preview_file=preview_file,
        org_id=org_id,
        current_user=current_user,
        db_session=db_session,
    )


@router.get("/user/page/{page}/limit/{limit}")
async def api_user_orgs(
    request: Request,
    page: int,
    limit: int,
    current_user: Union[PublicUser, AnonymousUser] = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
) -> List[OrganizationRead]:
    """
    Get orgs by page and limit by current user
    """
    # API tokens cannot access organization endpoints
    return await get_orgs_by_user(
        request, db_session, str(current_user.id), page, limit
    )


@router.get("/user_admin/page/{page}/limit/{limit}")
async def api_user_orgs_admin(
    request: Request,
    page: int,
    limit: int,
    current_user: Union[PublicUser, AnonymousUser] = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
) -> List[OrganizationRead]:
    """
    Get orgs by page and limit by current user
    """
    # API tokens cannot access organization endpoints
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


@router.put("/{org_id}/landing")
async def api_update_org_landing(
    request: Request,
    org_id: int,
    landing_object: dict,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
):
    """
    Update organization landing object
    """
    return await update_org_landing(request, landing_object, org_id, current_user, db_session)


@router.post("/{org_id}/landing/content")
async def api_upload_org_landing_content(
    request: Request,
    org_id: int,
    content_file: UploadFile,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
):
    """
    Upload content for organization landing page
    """
    return await upload_org_landing_content_service(
        request=request,
        content_file=content_file,
        org_id=org_id,
        current_user=current_user,
        db_session=db_session,
    )


@router.get("/{org_id}/usage")
async def api_get_org_usage(
    request: Request,
    org_id: int,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
):
    """
    Get organization usage and limits for plan-based features.
    Returns current usage, limits, and remaining quota.
    """
    from src.services.orgs.usage import get_org_usage_and_limits
    return await get_org_usage_and_limits(request, org_id, current_user, db_session)


# Include the feature config sub-router (admin-only endpoints)
router.include_router(feature_config_router)
