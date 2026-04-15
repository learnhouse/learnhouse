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
    export_organization_users_csv,
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
    update_org_boards_config,
    update_org_playgrounds_config,
    update_org_color_config,
    update_org_font_config,
    update_org_footer_text_config,
    update_org_watermark_config,
    update_org_thumbnail,
    update_org_landing,
    upload_org_landing_content_service,
    update_org_auth_branding_config,
    upload_org_auth_background_service,
    update_org_seo_config,
    upload_org_og_image_service,
    update_org_favicon,
)
from src.db.organization_config import AuthBrandingConfig, SeoOrgConfig


router = APIRouter()

# Sub-router for feature config endpoints (admin-only)
feature_config_router = APIRouter(
    tags=["Feature Configuration"],
    dependencies=[Depends(require_org_admin)],
)


@router.post(
    "/",
    response_model=OrganizationRead,
    summary="Create an organization",
    description="Create a new organization owned by the authenticated user.",
    responses={
        200: {"description": "Organization created.", "model": OrganizationRead},
        401: {"description": "Not authenticated"},
    },
)
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
@router.post(
    "/withconfig/",
    response_model=OrganizationRead,
    summary="Create an organization with config",
    description="Create a new organization together with its base configuration in a single call (pre-alpha).",
    responses={
        200: {"description": "Organization and configuration created.", "model": OrganizationRead},
        401: {"description": "Not authenticated"},
    },
)
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


@router.get(
    "/uuid/{org_uuid}",
    response_model=OrganizationRead,
    summary="Get organization by UUID",
    description="Fetch a single organization by its UUID.",
    responses={
        200: {"description": "Organization matching the UUID.", "model": OrganizationRead},
        404: {"description": "Organization not found"},
    },
)
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


@router.get(
    "/{org_id}/users/export",
    summary="Export organization users as CSV",
    description=(
        "Export organization users as a CSV file. Supports the same filters "
        "as the users listing endpoint. Requires authentication; anonymous "
        "access is rejected."
    ),
    responses={
        200: {"description": "CSV file of organization users matching the filters."},
        401: {"description": "Not authenticated"},
        403: {"description": "Caller is not a member of the organization"},
        404: {"description": "Organization not found"},
    },
)
async def api_export_org_users(
    request: Request,
    org_id: str,
    search: str = "",
    usergroup_id: Optional[int] = Query(default=None),
    usergroup_filter: Optional[Literal["in_group", "not_in_group"]] = Query(default=None),
    sort_order: Optional[Literal["asc", "desc"]] = Query(default="desc"),
    role_id: Optional[int] = Query(default=None),
    status: Optional[Literal["verified", "unverified"]] = Query(default=None),
    current_user: PublicUser = Depends(get_authenticated_user),
    db_session: Session = Depends(get_db_session),
):
    """
    Export organization users as CSV file.
    """
    return await export_organization_users_csv(
        request, org_id, db_session, current_user, search,
        usergroup_id, usergroup_filter, sort_order or "desc", role_id, status,
    )


@router.get(
    "/{org_id}/users",
    summary="List organization users",
    description=(
        "List organization users with pagination, search and filters. "
        "Requires authentication; anonymous access is rejected. The limit "
        "is capped at 100 to prevent data dumping."
    ),
    responses={
        200: {"description": "Paginated list of organization users."},
        401: {"description": "Not authenticated"},
        403: {"description": "Caller is not a member of the organization"},
        404: {"description": "Organization not found"},
    },
)
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


@router.post(
    "/join",
    summary="Join an organization",
    description="Join an existing organization, optionally consuming an invite code.",
    responses={
        200: {"description": "Organization joined successfully."},
        401: {"description": "Not authenticated"},
        403: {"description": "Organization is invite-only or invite is invalid"},
        404: {"description": "Organization or invite not found"},
    },
)
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


@router.put(
    "/{org_id}/users/{user_id}/role/{role_uuid}",
    summary="Update user role in organization",
    description="Update the role of a user within an organization by role UUID.",
    responses={
        200: {"description": "User role updated."},
        401: {"description": "Not authenticated"},
        403: {"description": "Caller lacks permission to change roles"},
        404: {"description": "Organization, user, or role not found"},
    },
)
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


@router.delete(
    "/{org_id}/users/batch/remove",
    summary="Remove multiple users from organization",
    description="Remove a batch of users from the organization in a single call.",
    responses={
        200: {"description": "Users removed from the organization."},
        401: {"description": "Not authenticated"},
        403: {"description": "Caller lacks permission to remove users"},
        404: {"description": "Organization not found"},
    },
)
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


@router.delete(
    "/{org_id}/users/{user_id}",
    summary="Remove a user from organization",
    description="Remove a single user from the organization.",
    responses={
        200: {"description": "User removed from the organization."},
        401: {"description": "Not authenticated"},
        403: {"description": "Caller lacks permission to remove users"},
        404: {"description": "Organization or user not found"},
    },
)
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
@router.put(
    "/{org_id}/signup_mechanism",
    summary="Update organization signup mechanism",
    description="Change whether the organization allows open signup or requires an invite code.",
    responses={
        200: {"description": "Signup mechanism updated."},
        401: {"description": "Not authenticated"},
        403: {"description": "Caller is not an organization administrator"},
        404: {"description": "Organization not found"},
    },
)
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


@feature_config_router.put(
    "/{org_id}/config/ai",
    summary="Update organization AI config",
    description="Update the organization's AI feature configuration, including the Copilot toggle. Admin only.",
    responses={
        200: {"description": "AI configuration updated."},
        401: {"description": "Not authenticated"},
        403: {"description": "Caller is not an organization administrator"},
        404: {"description": "Organization not found"},
    },
)
async def api_update_org_ai_config(
    request: Request,
    org_id: int,
    ai_enabled: Optional[bool] = None,
    copilot_enabled: Optional[bool] = None,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
):
    """
    Update organization AI configuration (admin-only)
    """
    return await update_org_ai_config(
        request, ai_enabled, org_id, current_user, db_session, copilot_enabled=copilot_enabled
    )


@feature_config_router.put(
    "/{org_id}/config/communities",
    summary="Update organization communities config",
    description="Enable or disable the communities feature for the organization. Admin only.",
    responses={
        200: {"description": "Communities configuration updated."},
        401: {"description": "Not authenticated"},
        403: {"description": "Caller is not an organization administrator"},
        404: {"description": "Organization not found"},
    },
)
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


@feature_config_router.put(
    "/{org_id}/config/payments",
    summary="Update organization payments config",
    description="Enable or disable the payments feature for the organization. Admin only.",
    responses={
        200: {"description": "Payments configuration updated."},
        401: {"description": "Not authenticated"},
        403: {"description": "Caller is not an organization administrator"},
        404: {"description": "Organization not found"},
    },
)
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


@feature_config_router.put(
    "/{org_id}/config/courses",
    summary="Update organization courses config",
    description="Enable or disable the courses feature for the organization. Admin only.",
    responses={
        200: {"description": "Courses configuration updated."},
        401: {"description": "Not authenticated"},
        403: {"description": "Caller is not an organization administrator"},
        404: {"description": "Organization not found"},
    },
)
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


@feature_config_router.put(
    "/{org_id}/config/collections",
    summary="Update organization collections config",
    description="Enable or disable the collections feature for the organization. Admin only.",
    responses={
        200: {"description": "Collections configuration updated."},
        401: {"description": "Not authenticated"},
        403: {"description": "Caller is not an organization administrator"},
        404: {"description": "Organization not found"},
    },
)
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


@feature_config_router.put(
    "/{org_id}/config/podcasts",
    summary="Update organization podcasts config",
    description="Enable or disable the podcasts feature for the organization. Admin only.",
    responses={
        200: {"description": "Podcasts configuration updated."},
        401: {"description": "Not authenticated"},
        403: {"description": "Caller is not an organization administrator"},
        404: {"description": "Organization not found"},
    },
)
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


@feature_config_router.put(
    "/{org_id}/config/boards",
    summary="Update organization boards config",
    description="Enable or disable the boards feature for the organization. Admin only.",
    responses={
        200: {"description": "Boards configuration updated."},
        401: {"description": "Not authenticated"},
        403: {"description": "Caller is not an organization administrator"},
        404: {"description": "Organization not found"},
    },
)
async def api_update_org_boards_config(
    request: Request,
    org_id: int,
    boards_enabled: bool,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
):
    """
    Update organization boards configuration (admin-only)
    """
    return await update_org_boards_config(
        request, boards_enabled, org_id, current_user, db_session
    )


@feature_config_router.put(
    "/{org_id}/config/playgrounds",
    summary="Update organization playgrounds config",
    description="Enable or disable the playgrounds feature for the organization. Admin only.",
    responses={
        200: {"description": "Playgrounds configuration updated."},
        401: {"description": "Not authenticated"},
        403: {"description": "Caller is not an organization administrator"},
        404: {"description": "Organization not found"},
    },
)
async def api_update_org_playgrounds_config(
    request: Request,
    org_id: int,
    playgrounds_enabled: bool,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
):
    """
    Update organization playgrounds configuration (admin-only)
    """
    return await update_org_playgrounds_config(
        request, playgrounds_enabled, org_id, current_user, db_session
    )


@router.put(
    "/{org_id}/config/color",
    summary="Update organization color",
    description="Update the organization's primary color used for branding.",
    responses={
        200: {"description": "Color configuration updated."},
        401: {"description": "Not authenticated"},
        403: {"description": "Caller is not an organization administrator"},
        404: {"description": "Organization not found"},
    },
)
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


@router.put(
    "/{org_id}/config/font",
    summary="Update organization font",
    description="Update the organization's branding font family.",
    responses={
        200: {"description": "Font configuration updated."},
        401: {"description": "Not authenticated"},
        403: {"description": "Caller is not an organization administrator"},
        404: {"description": "Organization not found"},
    },
)
async def api_update_org_font_config(
    request: Request,
    org_id: int,
    font: str = "",
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
):
    """
    Update organization font configuration
    """
    return await update_org_font_config(
        request, font, org_id, current_user, db_session
    )


@router.put(
    "/{org_id}/config/footer_text",
    summary="Update organization footer text",
    description="Update the organization's footer text used across learner-facing pages.",
    responses={
        200: {"description": "Footer text configuration updated."},
        401: {"description": "Not authenticated"},
        403: {"description": "Caller is not an organization administrator"},
        404: {"description": "Organization not found"},
    },
)
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


@router.put(
    "/{org_id}/config/watermark",
    summary="Update organization watermark",
    description="Enable or disable the watermark. Free plan organizations are not allowed to disable it.",
    responses={
        200: {"description": "Watermark configuration updated."},
        401: {"description": "Not authenticated"},
        403: {"description": "Caller is not an admin or free plan cannot disable the watermark"},
        404: {"description": "Organization not found"},
    },
)
async def api_update_org_watermark_config(
    request: Request,
    org_id: int,
    watermark_enabled: bool = True,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
):
    """
    Update organization watermark configuration.
    Free plan orgs cannot disable the watermark.
    """
    return await update_org_watermark_config(
        request, watermark_enabled, org_id, current_user, db_session
    )


@router.put(
    "/{org_id}/config/auth_branding",
    summary="Update auth page branding",
    description="Update branding configuration for the organization's authentication pages.",
    responses={
        200: {"description": "Auth branding configuration updated."},
        401: {"description": "Not authenticated"},
        403: {"description": "Caller is not an organization administrator"},
        404: {"description": "Organization not found"},
    },
)
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


@router.put(
    "/{org_id}/auth_background",
    summary="Upload auth page background",
    description="Upload the background image shown on the organization's authentication pages.",
    responses={
        200: {"description": "Auth background image uploaded."},
        401: {"description": "Not authenticated"},
        403: {"description": "Caller is not an organization administrator"},
        404: {"description": "Organization not found"},
    },
)
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


@router.put(
    "/{org_id}/config/seo",
    summary="Update organization SEO config",
    description="Update SEO-related configuration such as titles, descriptions and keywords.",
    responses={
        200: {"description": "SEO configuration updated."},
        401: {"description": "Not authenticated"},
        403: {"description": "Caller is not an organization administrator"},
        404: {"description": "Organization not found"},
    },
)
async def api_update_org_seo_config(
    request: Request,
    org_id: int,
    seo_config: SeoOrgConfig,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
):
    """
    Update organization SEO configuration
    """
    return await update_org_seo_config(
        request, seo_config, org_id, current_user, db_session
    )


@router.put(
    "/{org_id}/og_image",
    summary="Upload OG image",
    description="Upload the OpenGraph image used for social media sharing previews.",
    responses={
        200: {"description": "OG image uploaded."},
        401: {"description": "Not authenticated"},
        403: {"description": "Caller is not an organization administrator"},
        404: {"description": "Organization not found"},
    },
)
async def api_upload_org_og_image(
    request: Request,
    org_id: int,
    og_image_file: UploadFile,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
):
    """
    Upload OG image for social media sharing
    """
    return await upload_org_og_image_service(
        request=request,
        og_image_file=og_image_file,
        org_id=org_id,
        current_user=current_user,
        db_session=db_session,
    )


# Invites related routes
@router.post(
    "/{org_id}/invites",
    summary="Create an invite code",
    description="Create a new invite code for the organization, optionally linked to a usergroup.",
    responses={
        200: {"description": "Invite code created."},
        401: {"description": "Not authenticated"},
        403: {"description": "Caller is not an organization administrator"},
        404: {"description": "Organization or usergroup not found"},
    },
)
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


@router.get(
    "/{org_id}/invites",
    summary="List invite codes",
    description="List all invite codes for the organization.",
    responses={
        200: {"description": "List of invite codes for the organization."},
        401: {"description": "Not authenticated"},
        403: {"description": "Caller is not an organization administrator"},
        404: {"description": "Organization not found"},
    },
)
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


@router.get(
    "/{org_id}/invites/code/{invite_code}",
    summary="Get an invite code",
    description="Fetch details for a single invite code.",
    responses={
        200: {"description": "Invite code details."},
        401: {"description": "Not authenticated"},
        403: {"description": "Caller is not an organization administrator"},
        404: {"description": "Invite code not found"},
    },
)
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
    return await get_invite_code(request, org_id, invite_code, current_user, db_session)


@router.delete(
    "/{org_id}/invites/{org_invite_code_uuid}",
    summary="Delete an invite code",
    description="Delete an invite code by its UUID.",
    responses={
        200: {"description": "Invite code deleted."},
        401: {"description": "Not authenticated"},
        403: {"description": "Caller is not an organization administrator"},
        404: {"description": "Invite code not found"},
    },
)
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


@router.post(
    "/{org_id}/invites/users/batch",
    summary="Invite a batch of users",
    description="Invite multiple users by email in a single request, optionally using a specific invite code.",
    responses={
        200: {"description": "Invitations queued for the supplied emails."},
        401: {"description": "Not authenticated"},
        403: {"description": "Caller is not an organization administrator"},
        404: {"description": "Organization or invite code not found"},
    },
)
async def api_invite_batch_users(
    request: Request,
    org_id: int,
    emails: str,
    invite_code_uuid: Optional[str] = None,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
):
    """
    Invite batch users by emails
    """
    return await invite_batch_users(
        request, org_id, emails, invite_code_uuid, db_session, current_user
    )


@router.get(
    "/{org_id}/invites/users",
    summary="List invited users",
    description="List users who have been invited to the organization but have not joined yet.",
    responses={
        200: {"description": "List of invited users."},
        401: {"description": "Not authenticated"},
        403: {"description": "Caller is not an organization administrator"},
        404: {"description": "Organization not found"},
    },
)
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


@router.delete(
    "/{org_id}/invites/users/{email}",
    summary="Revoke an invited user",
    description="Revoke a pending invitation for the user identified by email.",
    responses={
        200: {"description": "Invitation revoked."},
        401: {"description": "Not authenticated"},
        403: {"description": "Caller is not an organization administrator"},
        404: {"description": "Invitation not found"},
    },
)
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


@router.get(
    "/slug/{org_slug}",
    response_model=OrganizationRead,
    summary="Get organization by slug",
    description="Fetch a single organization by its URL slug.",
    responses={
        200: {"description": "Organization matching the slug.", "model": OrganizationRead},
        404: {"description": "Organization not found"},
    },
)
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


@router.put(
    "/{org_id}/logo",
    summary="Update organization logo",
    description="Upload a new logo image for the organization.",
    responses={
        200: {"description": "Logo updated."},
        401: {"description": "Not authenticated"},
        403: {"description": "Caller is not an organization administrator"},
        404: {"description": "Organization not found"},
    },
)
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


@router.put(
    "/{org_id}/favicon",
    summary="Update organization favicon",
    description="Upload a new favicon image for the organization.",
    responses={
        200: {"description": "Favicon updated."},
        401: {"description": "Not authenticated"},
        403: {"description": "Caller is not an organization administrator"},
        404: {"description": "Organization not found"},
    },
)
async def api_update_org_favicon(
    request: Request,
    org_id: int,
    favicon_file: UploadFile,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
):
    """
    Update org favicon
    """
    return await update_org_favicon(
        request=request,
        favicon_file=favicon_file,
        org_id=org_id,
        current_user=current_user,
        db_session=db_session,
    )


@router.put(
    "/{org_id}/thumbnail",
    summary="Update organization thumbnail",
    description="Upload a new thumbnail image for the organization.",
    responses={
        200: {"description": "Thumbnail updated."},
        401: {"description": "Not authenticated"},
        403: {"description": "Caller is not an organization administrator"},
        404: {"description": "Organization not found"},
    },
)
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

@router.put(
    "/{org_id}/preview",
    summary="Update organization preview image",
    description="Upload a new preview image used on the organization's landing page.",
    responses={
        200: {"description": "Preview image updated."},
        401: {"description": "Not authenticated"},
        403: {"description": "Caller is not an organization administrator"},
        404: {"description": "Organization not found"},
    },
)
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


@router.get(
    "/user/page/{page}/limit/{limit}",
    response_model=List[OrganizationRead],
    summary="List organizations for current user",
    description="Return a paginated list of organizations the current user belongs to.",
    responses={
        200: {"description": "Paginated organizations for the current user.", "model": List[OrganizationRead]},
    },
)
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


@router.get(
    "/user_admin/page/{page}/limit/{limit}",
    response_model=List[OrganizationRead],
    summary="List organizations the user administers",
    description="Return a paginated list of organizations where the current user has admin rights.",
    responses={
        200: {"description": "Paginated organizations the current user administers.", "model": List[OrganizationRead]},
    },
)
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


@router.put(
    "/{org_id}",
    response_model=OrganizationRead,
    summary="Update an organization",
    description="Update an organization's core fields by ID.",
    responses={
        200: {"description": "Organization updated.", "model": OrganizationRead},
        401: {"description": "Not authenticated"},
        403: {"description": "Caller is not an organization administrator"},
        404: {"description": "Organization not found"},
    },
)
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


@router.delete(
    "/{org_id}",
    summary="Delete an organization",
    description="Delete an organization by its ID. This action cannot be undone.",
    responses={
        200: {"description": "Organization deleted."},
        401: {"description": "Not authenticated"},
        403: {"description": "Caller is not an organization administrator"},
        404: {"description": "Organization not found"},
    },
)
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


@router.put(
    "/{org_id}/landing",
    summary="Update organization landing page",
    description="Update the organization's landing page content object.",
    responses={
        200: {"description": "Landing page updated."},
        401: {"description": "Not authenticated"},
        403: {"description": "Caller is not an organization administrator"},
        404: {"description": "Organization not found"},
    },
)
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


@router.post(
    "/{org_id}/landing/content",
    summary="Upload landing page content",
    description="Upload a content asset (image or file) to attach to the organization's landing page.",
    responses={
        200: {"description": "Landing page content uploaded."},
        401: {"description": "Not authenticated"},
        403: {"description": "Caller is not an organization administrator"},
        404: {"description": "Organization not found"},
    },
)
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


@router.get(
    "/{org_id}/usage",
    summary="Get organization usage and limits",
    description=(
        "Return current usage, plan limits, and remaining quota for the "
        "organization's plan-based features."
    ),
    responses={
        200: {"description": "Usage, limits, and remaining quota for the organization."},
        401: {"description": "Not authenticated"},
        403: {"description": "Caller is not a member of the organization"},
        404: {"description": "Organization not found"},
    },
)
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
