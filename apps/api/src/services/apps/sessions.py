"""
App sessions: short-lived credentials for a running third-party app.

Two artifacts are minted together when a user opens an app:

- an **app-session token** (`lh_app_<jwt>`, 15 min): held by the dashboard
  host page only — it is never given to app code. Its rights are the
  intersection of the app's admin-approved scopes and the acting user's own
  rights, computed here at mint time. It authenticates as `AppSessionUser`
  (an `APITokenUser` subclass) so all existing org-boundary and token-rights
  enforcement applies.

- a **signed asset prefix** (HMAC, longer-lived): sandboxed iframes send no
  cookies, so bundle assets are authorized by a signature embedded in the
  URL path. Relative asset paths resolve under the same signed prefix, so
  every sub-resource inherits it.
"""

import base64
import hashlib
import hmac
import os
import time
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, Request, status
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.org_apps import OrgApp, OrgAppRead, OrgAppSessionResponse
from src.db.users import AppSessionUser, PublicUser
from src.security.rbac.constants import is_admin_or_maintainer
from src.services.apps.apps import get_org_app_or_404
from src.services.courses.transfer.storage_utils import read_file_content

APP_SESSION_TOKEN_PREFIX = "lh_app_"
APP_SESSION_TTL = timedelta(minutes=15)
# Longer than the API token on purpose: rotating the sig forces an iframe
# reload, while the host can re-mint API tokens invisibly.
ASSET_SIGNATURE_TTL = timedelta(hours=8)

_ASSET_SIG_CONTEXT = b"learnhouse-app-asset-v1"

# Explicit MIME map — app assets are only ever the allowlisted static types.
APP_ASSET_MIME_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".htm": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".json": "application/json",
    ".map": "application/json",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
    ".otf": "font/otf",
    ".txt": "text/plain; charset=utf-8",
    ".md": "text/plain; charset=utf-8",
}


def _asset_sig_key() -> bytes:
    from src.security.security import SECRET_KEY

    secret = SECRET_KEY.encode() if isinstance(SECRET_KEY, str) else bytes(SECRET_KEY)
    return hashlib.sha256(_ASSET_SIG_CONTEXT + secret).digest()


def make_asset_signature(app_uuid: str, version: str, expires_at_ts: int) -> str:
    digest = hmac.new(
        _asset_sig_key(),
        f"{app_uuid}:{version}:{expires_at_ts}".encode(),
        hashlib.sha256,
    ).digest()
    mac = base64.urlsafe_b64encode(digest).decode().rstrip("=")
    return f"{expires_at_ts}.{mac}"


def verify_asset_signature(app_uuid: str, version: str, sig: str) -> bool:
    try:
        exp_raw, _ = sig.split(".", 1)
        expires_at_ts = int(exp_raw)
    except (ValueError, TypeError):
        return False
    if expires_at_ts < int(time.time()):
        return False
    expected = make_asset_signature(app_uuid, version, expires_at_ts)
    return hmac.compare_digest(expected, sig)


def intersect_rights(app_rights: dict, user_role) -> dict:
    """Per-bucket, per-action AND of approved app scopes and the user's rights.

    Admin/maintainer roles may carry no explicit rights dict (they pass RBAC
    via role-id fallback, see require_org_role_permission) — treat them as
    unrestricted so the approved scopes apply as-is. Any other role without a
    rights dict grants nothing.
    """
    user_rights = getattr(user_role, "rights", None)
    if user_rights is None:
        if user_role is not None and user_role.id is not None and is_admin_or_maintainer(user_role.id):
            return app_rights
        user_rights = {}
    if hasattr(user_rights, "model_dump"):
        user_rights = user_rights.model_dump()

    effective: dict = {}
    for bucket, actions in app_rights.items():
        user_bucket = user_rights.get(bucket) if isinstance(user_rights, dict) else None
        effective[bucket] = {
            action: bool(granted)
            and isinstance(user_bucket, dict)
            and bool(user_bucket.get(action))
            for action, granted in actions.items()
        }
    return effective


async def mint_app_session(
    org_id: int,
    app_uuid: str,
    current_user: PublicUser,
    db_session: AsyncSession,
) -> OrgAppSessionResponse:
    """Mint the token + signed iframe URL for the current user to run an app.

    Caller (router) has already verified org membership and plan gating.
    """
    from src.security.auth import create_access_token
    from src.security.org_auth import get_user_org_role

    app = await get_org_app_or_404(org_id, app_uuid, db_session)
    if app.status != "installed" or not app.enabled or not app.approved_scopes:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="App is not enabled for this organization",
        )

    user_role = await get_user_org_role(current_user.id, org_id, db_session)
    effective_rights = intersect_rights(app.approved_scopes, user_role)

    expires_at = datetime.now(timezone.utc) + APP_SESSION_TTL
    jwt_token = create_access_token(
        data={
            "sub": str(current_user.id),
            "purpose": "app_session",
            "app_uuid": app.app_uuid,
            "org_id": app.org_id,
            "acting_user_id": current_user.id,
            "rights": effective_rights,
        },
        expires_delta=APP_SESSION_TTL,
    )

    sig_exp = int(time.time() + ASSET_SIGNATURE_TTL.total_seconds())
    sig = make_asset_signature(app.app_uuid, app.version, sig_exp)
    iframe_url = f"/api/apps/{app.app_uuid}/{sig}/assets/{app.entry_point}"

    return OrgAppSessionResponse(
        token=f"{APP_SESSION_TOKEN_PREFIX}{jwt_token}",
        expires_at=expires_at.isoformat(),
        iframe_url=iframe_url,
        app=OrgAppRead(**app.model_dump()),
    )


async def validate_app_session_token(
    token: str,
    db_session: AsyncSession,
) -> AppSessionUser | None:
    """Validate a `lh_app_<jwt>` bearer credential into an AppSessionUser.

    Returns None on any failure (caller raises 401). The OrgApp row is
    consulted on every request so disabling or uninstalling an app revokes
    outstanding sessions immediately, and the claim rights are re-clamped by
    the currently approved scopes in case they were narrowed after mint.
    """
    from sqlmodel import select

    from src.security.auth import decode_jwt

    if not token.startswith(APP_SESSION_TOKEN_PREFIX):
        return None
    payload = decode_jwt(token[len(APP_SESSION_TOKEN_PREFIX):])
    if not payload or payload.get("purpose") != "app_session":
        return None

    app_uuid = payload.get("app_uuid")
    org_id = payload.get("org_id")
    acting_user_id = payload.get("acting_user_id")
    rights = payload.get("rights")
    if not app_uuid or not isinstance(org_id, int) or not isinstance(acting_user_id, int):
        return None

    app = (
        await db_session.execute(
            select(OrgApp).where(OrgApp.app_uuid == app_uuid, OrgApp.org_id == org_id)
        )
    ).scalars().first()
    if not app or app.status != "installed" or not app.enabled or not app.approved_scopes:
        return None

    # Defense in depth: never let claim rights exceed the currently approved
    # scopes, even if they were valid at mint time.
    approved = app.approved_scopes
    clamped: dict = {}
    if isinstance(rights, dict):
        for bucket, actions in rights.items():
            approved_bucket = approved.get(bucket) if isinstance(approved, dict) else None
            if not isinstance(actions, dict):
                continue
            clamped[bucket] = {
                action: bool(granted)
                and isinstance(approved_bucket, dict)
                and bool(approved_bucket.get(action))
                for action, granted in actions.items()
            }

    return AppSessionUser(
        id=app.id or 0,
        user_uuid=app.app_uuid,
        username=f"app_session_{app.slug}",
        org_id=app.org_id,
        rights=clamped,
        token_name=app.name,
        created_by_user_id=acting_user_id,
        app_uuid=app.app_uuid,
        app_slug=app.slug,
    )


def build_app_csp(app_uuid: str) -> str:
    """CSP for served app documents. `connect-src 'self'` lets the bundle
    fetch its own signed assets; the Next.js proxy narrows it further to the
    app's own /api/apps/{uuid}/ prefix where the public origin is known.
    All other egress vectors are closed."""
    return (
        "default-src 'none'; "
        "script-src 'self'; "
        "style-src 'self' 'unsafe-inline'; "
        "img-src 'self' data: blob:; "
        "font-src 'self' data:; "
        "media-src 'self' blob:; "
        "connect-src 'self'; "
        "frame-ancestors 'self'; "
        "form-action 'none'; "
        "base-uri 'none'"
    )


async def serve_app_asset(
    request: Request,
    app_uuid: str,
    sig: str,
    asset_path: str,
    db_session: AsyncSession,
):
    """Serve one file of an app bundle, authorized purely by the signed prefix."""
    from fastapi import Response
    from sqlmodel import select

    app = (
        await db_session.execute(select(OrgApp).where(OrgApp.app_uuid == app_uuid))
    ).scalars().first()
    if not app or app.status != "installed" or not app.enabled:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="App not found")

    if not verify_asset_signature(app.app_uuid, app.version, sig):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invalid or expired signature")

    # Path jail: reuse the import sanitizer, then containment-check the join.
    from src.services.courses.transfer.import_service import sanitize_path

    safe_path = sanitize_path(asset_path)
    if not safe_path:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Asset not found")

    ext = os.path.splitext(safe_path)[1].lower()
    mime = APP_ASSET_MIME_TYPES.get(ext)
    if mime is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Asset not found")

    file_key = f"{app.storage_prefix}/{safe_path}"
    content = read_file_content(file_key)
    if content is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Asset not found")

    headers = {
        "Content-Security-Policy": build_app_csp(app.app_uuid),
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, max-age=300",
        "Referrer-Policy": "no-referrer",
        "X-Frame-Options": "SAMEORIGIN",
    }
    if request.method == "HEAD":
        return Response(status_code=200, headers={**headers, "Content-Type": mime})
    return Response(content=content, media_type=mime, headers=headers)
