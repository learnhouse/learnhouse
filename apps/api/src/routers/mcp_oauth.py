"""HTTP surface of the MCP OAuth server (see src/services/mcp/oauth.py).

Two routers:

* ``public_router`` sits on the root app: discovery documents under
  /.well-known and the OAuth endpoints MCP clients call directly. These take
  no cookies and answer any origin (see PublicCORSMiddleware).
* ``router`` is mounted under /api/v1/mcp: the signed-in consent screen, the
  connected-apps list, and the org switch.
"""

from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse
from pydantic import BaseModel, Field
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.core.events.database import get_db_session
from src.db.organizations import Organization
from src.db.users import AnonymousUser, PublicUser
from src.security.auth import get_current_user
from src.security.org_auth import is_org_admin, is_org_member
from src.services.mcp import oauth
from src.services.mcp.access import mcp_enabled_for_org, set_mcp_enabled_for_org
from src.services.security.rate_limiting import check_rate_limit, get_client_ip

logger = logging.getLogger(__name__)

public_router = APIRouter(include_in_schema=False)
router = APIRouter()

_NO_STORE = {"Cache-Control": "no-store", "Pragma": "no-cache"}


def _rate_limited(request: Request, bucket: str, limit: int, window: int) -> bool:
    """True when over the limit. Fails open: Redis trouble must not lock
    every MCP client out."""
    try:
        allowed, _count, _reset = check_rate_limit(
            f"mcp_oauth:{bucket}:{get_client_ip(request)}", limit, window
        )
        return not allowed
    except Exception:
        return False


def _over_global_limit(bucket: str, limit: int, window: int) -> bool:
    try:
        allowed, _count, _reset = check_rate_limit(f"mcp_oauth:{bucket}:all", limit, window)
        return not allowed
    except Exception:
        return False


def _oauth_error_response(err: oauth.OAuthError) -> JSONResponse:
    headers = dict(_NO_STORE)
    if err.status_code == 401:
        headers["WWW-Authenticate"] = 'Basic realm="learnhouse"'
    return JSONResponse(err.as_dict(), status_code=err.status_code, headers=headers)


async def _form(request: Request) -> dict[str, str]:
    content_type = request.headers.get("content-type", "")
    if "application/json" in content_type:
        try:
            body = await request.json()
        except Exception:
            return {}
        return {k: str(v) for k, v in body.items()} if isinstance(body, dict) else {}
    form = await request.form()
    return {k: str(v) for k, v in form.items()}


# ─── Discovery ────────────────────────────────────────────────────────────────


@public_router.get("/.well-known/oauth-protected-resource")
@public_router.get("/.well-known/oauth-protected-resource/mcp")
async def protected_resource_metadata(request: Request):
    # Built from the request's host when no public URL is configured, so no
    # shared cache may keep one answer for every host.
    return JSONResponse(oauth.protected_resource_metadata(request), headers=_NO_STORE)


@public_router.get("/.well-known/oauth-authorization-server")
@public_router.get("/.well-known/oauth-authorization-server/mcp")
@public_router.get("/.well-known/openid-configuration")
async def authorization_server_metadata(request: Request):
    return JSONResponse(oauth.authorization_server_metadata(request), headers=_NO_STORE)


# ─── OAuth endpoints ──────────────────────────────────────────────────────────


@public_router.post("/oauth/register")
async def register(request: Request, db_session: AsyncSession = Depends(get_db_session)):
    # Per address, and for the whole server: rotating addresses must not make
    # filling the clients table cheap.
    if _rate_limited(request, "register", 30, 60 * 60) or _over_global_limit("register", 2000, 60 * 60):
        return JSONResponse(
            {"error": "slow_down", "error_description": "Too many registrations"}, 429
        )
    try:
        payload = await request.json()
    except Exception:
        payload = None
    try:
        body = await oauth.register_client(payload, db_session)
    except oauth.OAuthError as e:
        return _oauth_error_response(e)
    return JSONResponse(body, status_code=201, headers=_NO_STORE)


def _error_page(message: str) -> HTMLResponse:
    from html import escape

    return HTMLResponse(
        "<!doctype html><meta charset=utf-8><title>LearnHouse</title>"
        "<body style=\"font-family:system-ui;max-width:32rem;margin:4rem auto;padding:0 1rem\">"
        f"<h1 style=\"font-size:1.25rem\">This sign-in link can't be used</h1><p>{escape(message)}</p>"
        "<p>Go back to the app you were connecting and start again.</p></body>",
        status_code=400,
    )


@public_router.get("/oauth/authorize")
async def authorize(request: Request, db_session: AsyncSession = Depends(get_db_session)):
    params = {k: v for k, v in request.query_params.items()}
    try:
        target = await oauth.start_authorization(params, request, db_session)
    except oauth.OAuthError as e:
        if e.redirect_uri:
            return RedirectResponse(oauth.error_redirect(e, oauth.issuer_url(request)), 302)
        # The redirect_uri is not trusted yet: never bounce the browser to it.
        return _error_page(e.description)
    return RedirectResponse(target, 302)


@public_router.post("/oauth/token")
async def token(request: Request, db_session: AsyncSession = Depends(get_db_session)):
    if _rate_limited(request, "token", 120, 60):
        return JSONResponse(
            {"error": "slow_down", "error_description": "Too many token requests"}, 429
        )
    form = await _form(request)
    try:
        body = await oauth.exchange_token(
            form, request.headers.get("authorization"), request, db_session
        )
    except oauth.OAuthError as e:
        return _oauth_error_response(e)
    return JSONResponse(body, headers=_NO_STORE)


@public_router.post("/oauth/revoke")
async def revoke(request: Request, db_session: AsyncSession = Depends(get_db_session)):
    form = await _form(request)
    try:
        await oauth.revoke_token(form, request.headers.get("authorization"), db_session)
    except oauth.OAuthError as e:
        return _oauth_error_response(e)
    return JSONResponse({}, headers=_NO_STORE)


# ─── Consent (signed in, called by the web app) ───────────────────────────────


def _member(current_user) -> PublicUser:
    if isinstance(current_user, AnonymousUser) or not isinstance(current_user, PublicUser):
        # API tokens cannot consent on a member's behalf.
        raise HTTPException(status_code=401, detail="Sign in to continue")
    return current_user


@router.get(
    "/oauth/authorize",
    summary="Describe a pending MCP app authorization",
    description="Used by the consent screen: the app asking for access, the scopes it wants, and the organizations the signed-in member can grant.",
)
async def get_authorization_request(
    request: str,
    current_user=Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
):
    user = _member(current_user)
    try:
        return await oauth.describe_authorization(request, user, db_session)
    except oauth.OAuthError as e:
        raise HTTPException(status_code=400, detail=e.description)


class AuthorizationDecision(BaseModel):
    request: str = Field(max_length=8000)
    approve: bool
    org_id: Optional[int] = None
    # "mcp:read" to connect read-only, otherwise what the app asked for.
    scope: Optional[str] = Field(default=None, max_length=200)


@router.post(
    "/oauth/authorize",
    summary="Approve or deny an MCP app authorization",
    description="Records the member's decision and returns the URL the browser must open next (the app's redirect URI with a code, or an access_denied error).",
)
async def post_authorization_decision(
    decision: AuthorizationDecision,
    current_user=Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
):
    user = _member(current_user)
    try:
        redirect_to = await oauth.decide_authorization(
            decision.request,
            user,
            decision.org_id,
            decision.approve,
            decision.scope,
            db_session,
        )
    except oauth.OAuthError as e:
        raise HTTPException(status_code=e.status_code, detail=e.description)
    return {"redirect_to": redirect_to}


# ─── Connected apps + org switch ──────────────────────────────────────────────


async def _org_or_404(org_id: int, db_session: AsyncSession) -> Organization:
    org = (
        await db_session.execute(select(Organization).where(Organization.id == org_id))
    ).scalars().first()
    if org is None:
        raise HTTPException(status_code=404, detail="Organization not found")
    return org


@router.get(
    "/orgs/{org_id}/connections",
    summary="List connected AI apps",
    description="Active MCP app connections in the organization. Members see their own; admins can pass scope=org to see everyone's.",
)
async def list_connections(
    org_id: int,
    scope: str = "mine",
    current_user=Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
):
    user = _member(current_user)
    await _org_or_404(org_id, db_session)
    if not await is_org_member(user.id, org_id, db_session):
        raise HTTPException(status_code=403, detail="Not a member of this organization")
    if scope == "org":
        if not await is_org_admin(user.id, org_id, db_session):
            raise HTTPException(status_code=403, detail="Admins only")
        return await oauth.list_grants(org_id, db_session)
    return await oauth.list_grants(org_id, db_session, user_id=user.id)


@router.delete(
    "/orgs/{org_id}/connections/{grant_uuid}",
    summary="Disconnect an AI app",
    description="Revokes an MCP app connection and every token issued under it. Members can disconnect their own apps; admins can disconnect anyone's.",
)
async def delete_connection(
    org_id: int,
    grant_uuid: str,
    current_user=Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
):
    user = _member(current_user)
    await _org_or_404(org_id, db_session)
    admin = await is_org_admin(user.id, org_id, db_session)
    if not admin and not await is_org_member(user.id, org_id, db_session):
        raise HTTPException(status_code=403, detail="Not a member of this organization")
    revoked = await oauth.revoke_grant_by_uuid(
        grant_uuid, org_id, db_session, user_id=None if admin else user.id, actor=user
    )
    if not revoked:
        raise HTTPException(status_code=404, detail="Connection not found")
    return {"detail": "Disconnected"}


class MCPSettingsUpdate(BaseModel):
    enabled: bool


@router.get(
    "/orgs/{org_id}/settings",
    summary="Get the organization's AI app connection settings",
    description="Whether members may connect AI apps over MCP, and the endpoint URL to give those apps.",
)
async def get_settings(
    org_id: int,
    request: Request,
    current_user=Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
):
    user = _member(current_user)
    await _org_or_404(org_id, db_session)
    if not await is_org_member(user.id, org_id, db_session):
        raise HTTPException(status_code=403, detail="Not a member of this organization")
    from config.config import get_learnhouse_config

    return {
        "enabled": await mcp_enabled_for_org(org_id, db_session),
        "server_enabled": get_learnhouse_config().mcp_config.enabled,
        "mcp_url": oauth.mcp_resource_url(request),
    }


@router.put(
    "/orgs/{org_id}/settings",
    summary="Turn AI app connections on or off",
    description="Org admins only. Turning it off rejects every MCP call into the organization, including API tokens, without deleting the connections.",
)
async def put_settings(
    org_id: int,
    body: MCPSettingsUpdate,
    current_user=Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
):
    user = _member(current_user)
    await _org_or_404(org_id, db_session)
    if not await is_org_admin(user.id, org_id, db_session):
        raise HTTPException(status_code=403, detail="Admins only")
    from src.security.org_auth import enforce_org_mfa

    await enforce_org_mfa(user.id, org_id, db_session)
    was_enabled = await mcp_enabled_for_org(org_id, db_session)
    await set_mcp_enabled_for_org(org_id, body.enabled, db_session)
    from src.core.ee_hooks import audit_event

    audit_event(
        None, action="integrations.mcp.settings_updated", org_id=org_id, actor=user,
        target_type="organization", target_id=org_id,
        before={"enabled": was_enabled}, after={"enabled": body.enabled}, via="ui",
    )
    return {"enabled": body.enabled}


# ─── Approvals ────────────────────────────────────────────────────────────────


class ApprovalDecision(BaseModel):
    approve: bool


async def _own_approval(approval_id: str, user: PublicUser, db_session: AsyncSession):
    from src.services.mcp import approvals

    try:
        approval = approvals.get(approval_id)
    except approvals.ApprovalUnavailable:
        raise HTTPException(status_code=503, detail="Approvals are unavailable right now")
    # Someone else's request looks exactly like a missing one.
    if approval is None or approval.user_id != user.id:
        raise HTTPException(status_code=404, detail="This request does not exist or has expired")
    if not await is_org_member(user.id, approval.org_id, db_session):
        raise HTTPException(status_code=404, detail="This request does not exist or has expired")
    return approval


@router.get(
    "/approvals/{approval_id}",
    summary="Get an AI app approval request",
    description="What an app connected over MCP asks the signed-in member to approve. Only the member it acts as can see it.",
)
async def get_approval(
    approval_id: str,
    current_user=Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
):
    user = _member(current_user)
    approval = await _own_approval(approval_id, user, db_session)
    org = await _org_or_404(approval.org_id, db_session)
    return {**approval.public(), "org": {"id": org.id, "name": org.name, "slug": org.slug}}


@router.post(
    "/approvals/{approval_id}",
    summary="Approve or decline an AI app request",
    description="Records the member's answer. An approval lets the app run that exact call once, within ten minutes.",
)
async def decide_approval(
    approval_id: str,
    body: ApprovalDecision,
    current_user=Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
):
    from src.security.org_auth import enforce_org_mfa
    from src.services.mcp import approvals

    user = _member(current_user)
    approval = await _own_approval(approval_id, user, db_session)
    # The org's 2FA and sign-in rules apply to the session saying yes.
    await enforce_org_mfa(user.id, approval.org_id, db_session)
    try:
        decided = approvals.decide(approval_id, user.id, body.approve)
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except approvals.ApprovalUnavailable:
        raise HTTPException(status_code=503, detail="Approvals are unavailable right now")
    logging.getLogger("learnhouse.mcp.audit").info(
        "mcp approval=%s tool=%s decision=%s org=%s actor=%s",
        decided.id, decided.tool, decided.status, decided.org_id, getattr(user, "user_uuid", "?"),
    )
    return {"status": decided.status}
