from typing import List, Union

from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile
from sqlmodel.ext.asyncio.session import AsyncSession

from src.core.events.database import get_db_session
from src.db.org_apps import (
    OrgAppAdminRead,
    OrgAppApprove,
    OrgAppRead,
    OrgAppSessionResponse,
    OrgAppUpdate,
)
from src.db.users import PublicUser
from src.security.auth import get_current_user
from src.security.org_auth import is_org_admin, require_org_admin, require_org_membership
from src.services.apps.apps import (
    approve_app,
    install_app_from_upload,
    list_org_apps,
    set_app_enabled,
    uninstall_app,
)
from src.services.apps.sessions import mint_app_session, serve_app_asset

# Management router — mounted under /orgs with require_authenticated_user +
# require_plan("pro", "Apps") (see src/router.py). require_authenticated_user
# rejects API tokens AND app sessions, so apps can never manage apps.
router = APIRouter()

# Asset router — mounted under /apps with NO auth dependencies: sandboxed
# iframes send no credentials; authorization is the HMAC-signed URL prefix.
assets_router = APIRouter()


@router.post(
    "/{org_id}/apps",
    response_model=OrgAppAdminRead,
    summary="Upload an app package",
    description=(
        "Upload a third-party app bundle (zip with a learnhouse.json manifest). "
        "The app is staged as 'pending' with no capabilities until an admin "
        "approves its requested scopes. Uploading an existing app's slug stages "
        "an update and disables the app until re-approval. Admin only."
    ),
)
async def api_install_app(
    request: Request,
    org_id: int,
    app_package: UploadFile,
    current_user: PublicUser = Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
) -> OrgAppAdminRead:
    await require_org_admin(current_user.id, org_id, db_session)
    return await install_app_from_upload(app_package, org_id, current_user, db_session)


@router.post(
    "/{org_id}/apps/{app_uuid}/approve",
    response_model=OrgAppAdminRead,
    summary="Approve an app's scopes and activate it",
    description=(
        "Grant a pending app its scopes and enable it. Granted scopes must be a "
        "subset of the manifest's requested scopes. Admin only."
    ),
)
async def api_approve_app(
    request: Request,
    org_id: int,
    app_uuid: str,
    approval: OrgAppApprove,
    current_user: PublicUser = Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
) -> OrgAppAdminRead:
    await require_org_admin(current_user.id, org_id, db_session)
    return await approve_app(org_id, app_uuid, approval.scopes, db_session)


@router.get(
    "/{org_id}/apps",
    response_model=List[Union[OrgAppAdminRead, OrgAppRead]],
    summary="List installed apps",
    description=(
        "List the organization's apps. Admins see all apps with manifests and "
        "scopes; members only see installed, enabled apps."
    ),
)
async def api_list_apps(
    request: Request,
    org_id: int,
    current_user: PublicUser = Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
):
    await require_org_membership(current_user.id, org_id, db_session)
    admin = await is_org_admin(current_user.id, org_id, db_session)
    return await list_org_apps(org_id, db_session, include_pending=admin)


@router.patch(
    "/{org_id}/apps/{app_uuid}",
    response_model=OrgAppAdminRead,
    summary="Enable or disable an app",
)
async def api_update_app(
    request: Request,
    org_id: int,
    app_uuid: str,
    update: OrgAppUpdate,
    current_user: PublicUser = Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
) -> OrgAppAdminRead:
    await require_org_admin(current_user.id, org_id, db_session)
    if update.enabled is None:
        raise HTTPException(status_code=400, detail="Nothing to update")
    return await set_app_enabled(org_id, app_uuid, update.enabled, db_session)


@router.delete(
    "/{org_id}/apps/{app_uuid}",
    summary="Uninstall an app",
    description="Remove the app and delete its stored bundle. Admin only.",
)
async def api_uninstall_app(
    request: Request,
    org_id: int,
    app_uuid: str,
    current_user: PublicUser = Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
) -> dict:
    await require_org_admin(current_user.id, org_id, db_session)
    await uninstall_app(org_id, app_uuid, db_session)
    return {"detail": "App uninstalled"}


@router.post(
    "/{org_id}/apps/{app_uuid}/session",
    response_model=OrgAppSessionResponse,
    summary="Mint an app session",
    description=(
        "Mint the short-lived app-session token and signed iframe URL used by "
        "the dashboard to run an app. The token's rights are the intersection "
        "of the app's approved scopes and the calling user's own rights, and "
        "it is held by the dashboard host page — never by app code."
    ),
)
async def api_create_app_session(
    request: Request,
    org_id: int,
    app_uuid: str,
    current_user: PublicUser = Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
) -> OrgAppSessionResponse:
    await require_org_membership(current_user.id, org_id, db_session)
    return await mint_app_session(org_id, app_uuid, current_user, db_session)


@assets_router.get(
    "/{app_uuid}/{sig}/assets/{asset_path:path}",
    summary="Serve an app bundle asset",
    description=(
        "Serve a static file from an installed app's bundle. Authorized by the "
        "HMAC-signed URL prefix (sandboxed iframes send no cookies). Responses "
        "carry a strict Content-Security-Policy that blocks all network egress."
    ),
)
@assets_router.head("/{app_uuid}/{sig}/assets/{asset_path:path}", include_in_schema=False)
async def api_serve_app_asset(
    request: Request,
    app_uuid: str,
    sig: str,
    asset_path: str,
    db_session: AsyncSession = Depends(get_db_session),
):
    return await serve_app_asset(request, app_uuid, sig, asset_path, db_session)
