"""OAuth 2.1 authorization server for the MCP endpoint.

MCP clients find this server from the endpoint itself: an unauthenticated
call to /mcp answers 401 with a pointer to the protected resource metadata
(RFC 9728), which names this server; its metadata (RFC 8414) lists the
endpoints below. Clients register themselves (RFC 7591), send the member to
the consent screen with PKCE, and trade the code for tokens.

    /oauth/register   dynamic client registration
    /oauth/authorize  validates the request, hands off to the web consent page
    /oauth/token      authorization_code and refresh_token grants
    /oauth/revoke     token revocation (RFC 7009)

The consent page (web app at /oauth/consent, signed in) reads the request back and records the
member's decision through the v1 endpoints in src/routers/mcp_oauth.py.

Every token acts as the member who consented, inside the one organization they
picked, so it can never do more than the member can in the dashboard. Tokens
are opaque, stored as SHA-256 hashes, and bound to the MCP resource URL.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import logging
import secrets
import time
from dataclasses import dataclass
from datetime import timezone
from typing import Any, Optional
from urllib.parse import urlencode, urlparse
from uuid import uuid4

import jwt
from jwt.exceptions import PyJWTError
from sqlalchemy import delete, exists, update
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession
from starlette.requests import Request

from config.config import get_learnhouse_config
from src.db.mcp_oauth import MCPOAuthClient, MCPOAuthCode, MCPOAuthGrant, MCPOAuthToken
from src.db.organizations import Organization
from src.db.user_organizations import UserOrganization
from src.db.users import PublicUser, User
from src.security.security import ALGORITHM, SECRET_KEY

logger = logging.getLogger(__name__)

SCOPE_READ = "mcp:read"
SCOPE_WRITE = "mcp:write"
# Members, groups, roles and organization settings. Only granted when the
# member picks it on the consent screen and is an admin or maintainer.
SCOPE_ADMIN = "mcp:admin"
SUPPORTED_SCOPES = (SCOPE_READ, SCOPE_WRITE, SCOPE_ADMIN)
DEFAULT_SCOPES = (SCOPE_READ, SCOPE_WRITE)

ACCESS_TOKEN_PREFIX = "lho_at_"
REFRESH_TOKEN_PREFIX = "lho_rt_"
ACCESS_TOKEN_TTL = 60 * 60
REFRESH_TOKEN_TTL = 30 * 24 * 60 * 60
# However often it refreshes, a connection ends this long after consent and
# the member signs in again.
MAX_GRANT_AGE = 180 * 24 * 60 * 60
CODE_TTL = 5 * 60
AUTH_REQUEST_TTL = 10 * 60

ABANDONED_CLIENT_TTL = 7 * 24 * 60 * 60
PRUNE_ONE_IN = 200

_AUTH_REQUEST_TYPE = "mcp_authorize_request"
_MAX_REDIRECT_URIS = 10
_MAX_URI_LENGTH = 2000
_FORBIDDEN_SCHEMES = {"javascript", "data", "file", "vbscript", "about", "blob"}
_LOOPBACK_HOSTS = {"localhost", "127.0.0.1", "[::1]", "::1"}


class OAuthError(Exception):
    """An RFC 6749 error. `redirect_uri` set means it can go back to the client."""

    def __init__(
        self,
        error: str,
        description: str,
        status_code: int = 400,
        redirect_uri: Optional[str] = None,
        state: Optional[str] = None,
    ) -> None:
        super().__init__(description)
        self.error = error
        self.description = description
        self.status_code = status_code
        self.redirect_uri = redirect_uri
        self.state = state

    def as_dict(self) -> dict[str, str]:
        return {"error": self.error, "error_description": self.description}


def _now() -> int:
    return int(time.time())


def hash_secret(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


# ─── URLs ─────────────────────────────────────────────────────────────────────


def _request_origin(request: Request) -> str:
    """scheme://host of the request as the client saw it.

    Forwarded headers count only from a proxy on a private address, the same
    rule as the client IP: anyone else could name any host. Deployments
    should set LEARNHOUSE_MCP_PUBLIC_URL, which skips this entirely."""
    from src.services.security.rate_limiting import _is_trusted_proxy, _trust_proxy_headers

    config = get_learnhouse_config()
    direct = request.client.host if request.client else ""
    proxied = bool(direct) and _trust_proxy_headers() and _is_trusted_proxy(direct)
    proto = request.headers.get("x-forwarded-proto", "").split(",")[0].strip() if proxied else ""
    if proto not in ("http", "https"):
        proto = "https" if config.hosting_config.ssl else request.url.scheme
    forwarded_host = request.headers.get("x-forwarded-host", "").split(",")[0].strip() if proxied else ""
    host = forwarded_host or request.headers.get("host", request.url.netloc)
    return f"{proto}://{host}"


def mcp_resource_url(request: Request) -> str:
    """Canonical URL of the MCP endpoint; tokens are bound to it."""
    configured = get_learnhouse_config().mcp_config.public_url
    if configured:
        return configured.rstrip("/")
    return f"{_request_origin(request)}/mcp"


def issuer_url(request: Request) -> str:
    """The authorization server lives on the same origin as the endpoint."""
    parsed = urlparse(mcp_resource_url(request))
    return f"{parsed.scheme}://{parsed.netloc}"


def resource_metadata_url(request: Request) -> str:
    parsed = urlparse(mcp_resource_url(request))
    return f"{parsed.scheme}://{parsed.netloc}/.well-known/oauth-protected-resource{parsed.path}"


def frontend_base() -> str:
    """The web app's address, where members consent and approve."""
    from src.services.email.utils import _configured_frontend_base_url

    base = _configured_frontend_base_url()
    if not base:
        config = get_learnhouse_config()
        scheme = "https" if config.hosting_config.ssl else "http"
        frontend = (config.hosting_config.frontend_domain or "").strip().rstrip("/")
        base = frontend if "://" in frontend else f"{scheme}://{frontend}"
    return base.rstrip("/")


def consent_page_url(request: Request) -> str:
    """The web app's consent screen."""
    return f"{frontend_base()}/oauth/consent"


def protected_resource_metadata(request: Request) -> dict[str, Any]:
    return {
        "resource": mcp_resource_url(request),
        "authorization_servers": [issuer_url(request)],
        "scopes_supported": list(SUPPORTED_SCOPES),
        "bearer_methods_supported": ["header"],
        "resource_name": "LearnHouse",
        "resource_documentation": "https://docs.learnhouse.app",
    }


def authorization_server_metadata(request: Request) -> dict[str, Any]:
    issuer = issuer_url(request)
    return {
        "issuer": issuer,
        "authorization_endpoint": f"{issuer}/oauth/authorize",
        "token_endpoint": f"{issuer}/oauth/token",
        "registration_endpoint": f"{issuer}/oauth/register",
        "revocation_endpoint": f"{issuer}/oauth/revoke",
        "scopes_supported": list(SUPPORTED_SCOPES),
        "response_types_supported": ["code"],
        "response_modes_supported": ["query"],
        "grant_types_supported": ["authorization_code", "refresh_token"],
        "token_endpoint_auth_methods_supported": [
            "none",
            "client_secret_post",
            "client_secret_basic",
        ],
        "revocation_endpoint_auth_methods_supported": [
            "none",
            "client_secret_post",
            "client_secret_basic",
        ],
        "code_challenge_methods_supported": ["S256"],
        "authorization_response_iss_parameter_supported": True,
        "service_documentation": "https://docs.learnhouse.app",
    }


# ─── Scopes ───────────────────────────────────────────────────────────────────


def parse_scope(raw: Optional[str]) -> list[str]:
    """Known scopes from a space separated string; none asked means every
    scope (the consent screen then decides what is actually granted)."""
    if not raw:
        return list(SUPPORTED_SCOPES)
    asked = [s for s in raw.split() if s in SUPPORTED_SCOPES]
    if not asked:
        raise OAuthError("invalid_scope", "No supported scope was requested")
    # Admin implies writing, writing implies reading.
    if SCOPE_ADMIN in asked and SCOPE_WRITE not in asked:
        asked.append(SCOPE_WRITE)
    if SCOPE_WRITE in asked and SCOPE_READ not in asked:
        asked.append(SCOPE_READ)
    return [s for s in SUPPORTED_SCOPES if s in asked]


def format_scope(scopes: list[str]) -> str:
    return " ".join(s for s in SUPPORTED_SCOPES if s in scopes)


# ─── Clients ──────────────────────────────────────────────────────────────────


def validate_redirect_uri(uri: Any) -> str:
    """Reject anything a browser could be tricked into running or leaking.

    https anywhere, http only on loopback (native apps, RFC 8252), and private
    app schemes such as `cursor://` for desktop clients.
    """
    if not isinstance(uri, str) or not uri or len(uri) > _MAX_URI_LENGTH:
        raise OAuthError("invalid_redirect_uri", "redirect_uri is missing or too long")
    # Browsers read a backslash as "/" and drop whitespace, but urlparse does
    # not, so "https://evil.test\\@trusted.example/cb" would pass as trusted.example
    # here and land on evil.test. Refuse anything the two could read apart.
    if "\\" in uri or any(ch.isspace() or ord(ch) < 0x20 or ord(ch) == 0x7F for ch in uri):
        raise OAuthError("invalid_redirect_uri", "redirect_uri contains characters that are not allowed")
    parsed = urlparse(uri)
    if "@" in parsed.netloc or parsed.username is not None or parsed.password is not None:
        raise OAuthError("invalid_redirect_uri", "redirect_uri must not contain a user name or password")
    scheme = (parsed.scheme or "").lower()
    if not scheme or scheme in _FORBIDDEN_SCHEMES:
        raise OAuthError("invalid_redirect_uri", f"redirect_uri scheme is not allowed: {uri}")
    if parsed.fragment:
        raise OAuthError("invalid_redirect_uri", "redirect_uri must not contain a fragment")
    if scheme == "http":
        if (parsed.hostname or "").lower() not in _LOOPBACK_HOSTS:
            raise OAuthError(
                "invalid_redirect_uri", "http redirect_uri is only allowed on localhost"
            )
    elif scheme == "https":
        if not parsed.hostname:
            raise OAuthError("invalid_redirect_uri", "redirect_uri has no host")
    return uri


def _redirect_matches(registered: list[str], uri: str) -> bool:
    """Exact match, except loopback redirects may use any port (RFC 8252 7.3)."""
    if uri in registered:
        return True
    asked = urlparse(uri)
    if asked.scheme != "http" or (asked.hostname or "").lower() not in _LOOPBACK_HOSTS:
        return False
    for candidate in registered:
        reg = urlparse(candidate)
        if (
            reg.scheme == "http"
            and (reg.hostname or "").lower() == (asked.hostname or "").lower()
            and reg.path == asked.path
            and reg.query == asked.query
        ):
            return True
    return False


def _clean_text(value: Any, limit: int) -> Optional[str]:
    if not isinstance(value, str):
        return None
    value = value.strip()
    return value[:limit] if value else None


def _clean_https_uri(value: Any) -> Optional[str]:
    text = _clean_text(value, 500)
    if not text:
        return None
    parsed = urlparse(text)
    if parsed.scheme != "https" or not parsed.hostname:
        return None
    return text


async def register_client(payload: Any, db_session: AsyncSession) -> dict[str, Any]:
    """Dynamic client registration (RFC 7591). Open by design: a client gets
    nothing until a member consents to it."""
    if not isinstance(payload, dict):
        raise OAuthError("invalid_client_metadata", "Expected a JSON object")

    redirect_uris = payload.get("redirect_uris")
    if not isinstance(redirect_uris, list) or not redirect_uris:
        raise OAuthError("invalid_redirect_uri", "redirect_uris is required")
    if len(redirect_uris) > _MAX_REDIRECT_URIS:
        raise OAuthError("invalid_redirect_uri", "Too many redirect_uris")
    redirect_uris = [validate_redirect_uri(u) for u in redirect_uris]

    grant_types = payload.get("grant_types") or ["authorization_code", "refresh_token"]
    if not isinstance(grant_types, list) or "authorization_code" not in grant_types:
        raise OAuthError(
            "invalid_client_metadata", "grant_types must include authorization_code"
        )
    unsupported = set(grant_types) - {"authorization_code", "refresh_token"}
    if unsupported:
        raise OAuthError(
            "invalid_client_metadata", f"Unsupported grant_types: {sorted(unsupported)}"
        )
    response_types = payload.get("response_types") or ["code"]
    if response_types != ["code"]:
        raise OAuthError("invalid_client_metadata", "Only the code response type is supported")

    auth_method = payload.get("token_endpoint_auth_method") or "none"
    if auth_method not in ("none", "client_secret_post", "client_secret_basic"):
        raise OAuthError(
            "invalid_client_metadata", f"Unsupported token_endpoint_auth_method: {auth_method}"
        )

    client_id = f"mcpc_{secrets.token_urlsafe(18)}"
    client_secret = secrets.token_urlsafe(32) if auth_method != "none" else None
    now = _now()
    client = MCPOAuthClient(
        client_id=client_id,
        client_secret_hash=hash_secret(client_secret) if client_secret else None,
        client_name=_clean_text(payload.get("client_name"), 200) or "MCP client",
        client_uri=_clean_https_uri(payload.get("client_uri")),
        logo_uri=_clean_https_uri(payload.get("logo_uri")),
        redirect_uris=redirect_uris,
        token_endpoint_auth_method=auth_method,
        created_at=now,
    )
    db_session.add(client)
    await db_session.commit()

    response: dict[str, Any] = {
        "client_id": client_id,
        "client_id_issued_at": now,
        "client_name": client.client_name,
        "redirect_uris": redirect_uris,
        "grant_types": grant_types,
        "response_types": ["code"],
        "token_endpoint_auth_method": auth_method,
        "scope": format_scope(list(SUPPORTED_SCOPES)),
    }
    if client.client_uri:
        response["client_uri"] = client.client_uri
    if client.logo_uri:
        response["logo_uri"] = client.logo_uri
    if client_secret:
        response["client_secret"] = client_secret
        response["client_secret_expires_at"] = 0
    return response


async def get_client(client_id: Optional[str], db_session: AsyncSession) -> Optional[MCPOAuthClient]:
    if not client_id or not isinstance(client_id, str) or len(client_id) > 255:
        return None
    return (
        await db_session.execute(
            select(MCPOAuthClient).where(MCPOAuthClient.client_id == client_id)
        )
    ).scalars().first()


def _authenticate_client(
    client: MCPOAuthClient, form: dict[str, str], authorization: Optional[str]
) -> None:
    """Confidential clients prove their secret; public clients rely on PKCE."""
    if client.token_endpoint_auth_method == "none":
        return
    presented: Optional[str] = None
    if authorization and authorization.lower().startswith("basic "):
        try:
            decoded = base64.b64decode(authorization[6:].strip()).decode()
            basic_id, _, basic_secret = decoded.partition(":")
        except Exception:
            raise OAuthError("invalid_client", "Malformed basic credentials", 401)
        if basic_id != client.client_id:
            raise OAuthError("invalid_client", "Client id mismatch", 401)
        presented = basic_secret
    else:
        presented = form.get("client_secret")
    if not presented or not client.client_secret_hash or not hmac.compare_digest(
        hash_secret(presented), client.client_secret_hash
    ):
        raise OAuthError("invalid_client", "Client authentication failed", 401)


def _client_id_from_basic(authorization: Optional[str]) -> Optional[str]:
    if not authorization or not authorization.lower().startswith("basic "):
        return None
    try:
        return base64.b64decode(authorization[6:].strip()).decode().partition(":")[0] or None
    except Exception:
        return None


# ─── Authorization request ────────────────────────────────────────────────────


def _request_signing_key() -> str:
    # Derived so a consent-request token can never verify as a session JWT.
    return hmac.new(SECRET_KEY.encode(), b"mcp-oauth-authorize-request", "sha256").hexdigest()


def sign_authorization_request(data: dict[str, Any]) -> str:
    now = _now()
    payload = {**data, "typ": _AUTH_REQUEST_TYPE, "iat": now, "exp": now + AUTH_REQUEST_TTL}
    return jwt.encode(payload, _request_signing_key(), algorithm=ALGORITHM)


def read_authorization_request(token: Optional[str]) -> dict[str, Any]:
    if not token:
        raise OAuthError("invalid_request", "Missing authorization request")
    try:
        payload = jwt.decode(
            token,
            _request_signing_key(),
            algorithms=[ALGORITHM],
            options={"require": ["exp", "iat"]},
        )
    except PyJWTError:
        raise OAuthError(
            "invalid_request", "This sign-in request expired. Start again from your app."
        )
    if payload.get("typ") != _AUTH_REQUEST_TYPE:
        raise OAuthError("invalid_request", "Not an authorization request")
    return payload


async def start_authorization(
    params: dict[str, str], request: Request, db_session: AsyncSession
) -> str:
    """Validate an /oauth/authorize request and return the consent page URL.

    Errors before the redirect_uri is trusted are raised without one (shown,
    never redirected); later errors carry it so the client hears about them.
    """
    client = await get_client(params.get("client_id"), db_session)
    if client is None:
        raise OAuthError("invalid_client", "Unknown client_id. Register the client first.")

    redirect_uri = params.get("redirect_uri")
    if not redirect_uri:
        if len(client.redirect_uris) != 1:
            raise OAuthError("invalid_request", "redirect_uri is required")
        redirect_uri = client.redirect_uris[0]
    if not _redirect_matches(client.redirect_uris, redirect_uri):
        raise OAuthError("invalid_request", "redirect_uri is not registered for this client")

    state = params.get("state")

    def fail(error: str, description: str) -> OAuthError:
        # Shown on our own error page, never redirected: registration is open,
        # so a registered redirect_uri proves nothing until the member has
        # seen the consent screen (an unconsented redirect is an open redirect).
        return OAuthError(error, description)

    if params.get("response_type") != "code":
        raise fail("unsupported_response_type", "Only response_type=code is supported")
    challenge = params.get("code_challenge")
    if not challenge or not (43 <= len(challenge) <= 128):
        raise fail("invalid_request", "A PKCE code_challenge is required")
    if params.get("code_challenge_method", "plain") != "S256":
        raise fail("invalid_request", "code_challenge_method must be S256")
    try:
        scopes = parse_scope(params.get("scope"))
    except OAuthError as e:
        raise fail(e.error, e.description)

    resource = params.get("resource") or mcp_resource_url(request)
    if resource.rstrip("/") != mcp_resource_url(request):
        raise fail("invalid_target", "Tokens can only be issued for this server's MCP endpoint")

    signed = sign_authorization_request(
        {
            "client_id": client.client_id,
            "redirect_uri": redirect_uri,
            "state": state,
            "code_challenge": challenge,
            "scope": format_scope(scopes),
            "resource": resource.rstrip("/"),
            "iss": issuer_url(request),
        }
    )
    return f"{consent_page_url(request)}?{urlencode({'request': signed})}"


def redirect_with(redirect_uri: str, params: dict[str, Optional[str]]) -> str:
    clean = {k: v for k, v in params.items() if v is not None}
    separator = "&" if urlparse(redirect_uri).query else "?"
    return f"{redirect_uri}{separator}{urlencode(clean)}"


def error_redirect(err: OAuthError, issuer: Optional[str] = None) -> str:
    assert err.redirect_uri
    return redirect_with(
        err.redirect_uri,
        {
            "error": err.error,
            "error_description": err.description,
            "state": err.state,
            "iss": issuer,
        },
    )


async def _member_orgs(user_id: int, db_session: AsyncSession) -> list[Organization]:
    rows = await db_session.execute(
        select(Organization)
        .join(UserOrganization, UserOrganization.org_id == Organization.id)
        .where(UserOrganization.user_id == user_id)
        .order_by(Organization.name)
    )
    return list(rows.scalars().all())


async def describe_authorization(
    token: str, user: PublicUser, db_session: AsyncSession
) -> dict[str, Any]:
    """What the consent page shows: who is asking, for what, and where to."""
    from src.security.org_auth import is_org_admin
    from src.services.mcp.access import mcp_enabled_for_org

    req = read_authorization_request(token)
    client = await get_client(req.get("client_id"), db_session)
    if client is None:
        raise OAuthError("invalid_client", "This app is no longer registered")

    orgs = []
    for org in await _member_orgs(user.id, db_session):
        orgs.append(
            {
                "id": org.id,
                "org_uuid": org.org_uuid,
                "slug": org.slug,
                "name": org.name,
                "logo_image": org.logo_image,
                "mcp_enabled": await mcp_enabled_for_org(org.id, db_session),
                "can_admin": await is_org_admin(user.id, org.id, db_session),
            }
        )

    parsed = urlparse(req["redirect_uri"])
    # Host and port only: "trusted.example@evil.test" must show as evil.test.
    redirect_host = parsed.hostname or ""
    if parsed.hostname and parsed.port:
        redirect_host = f"{parsed.hostname}:{parsed.port}"
    if parsed.scheme not in ("http", "https"):
        # An app scheme opens whatever program claims it, whatever the host
        # says, so the scheme is what the member must see.
        redirect_host = f"{parsed.scheme}://{redirect_host}"
    return {
        "client": {
            "name": client.client_name,
            "uri": client.client_uri,
            "logo_uri": client.logo_uri,
            "redirect_host": redirect_host,
        },
        "scopes": req["scope"].split(),
        "orgs": orgs,
        "user": {"username": user.username, "email": user.email},
    }


async def decide_authorization(
    token: str,
    user: PublicUser,
    org_id: Optional[int],
    approve: bool,
    scope: Optional[str],
    db_session: AsyncSession,
) -> str:
    """Record the member's answer; return where the browser goes next."""
    from src.security.org_auth import enforce_org_mfa, is_org_admin
    from src.security.session_context import get_session_provenance
    from src.services.mcp.access import mcp_enabled_for_org

    req = read_authorization_request(token)
    issuer = req.get("iss")
    redirect_uri = req["redirect_uri"]
    state = req.get("state")
    client = await get_client(req.get("client_id"), db_session)
    if client is None:
        raise OAuthError("invalid_client", "This app is no longer registered")

    if not approve:
        return redirect_with(
            redirect_uri,
            {
                "error": "access_denied",
                "error_description": "The member declined access",
                "state": state,
                "iss": issuer,
            },
        )

    # A real membership row: platform superadmins pass every org check, but an
    # app must only ever act where the member actually belongs.
    if org_id is None or not await _has_membership(user.id, org_id, db_session):
        raise OAuthError("access_denied", "Pick an organization you are a member of", 403)
    if not await mcp_enabled_for_org(org_id, db_session):
        raise OAuthError(
            "access_denied", "An admin turned off AI app connections for this organization", 403
        )
    # The org's 2FA and sign-in method rules apply to the session consenting.
    await enforce_org_mfa(user.id, org_id, db_session)

    # The app's request caps what can be granted; the member's choice on the
    # consent screen decides. Admin access needs both the choice and an
    # admin or maintainer role in that organization.
    allowed = parse_scope(req["scope"])
    chosen = parse_scope(scope) if scope else list(DEFAULT_SCOPES)
    granted = [s for s in chosen if s in allowed] or [SCOPE_READ]
    if SCOPE_ADMIN in granted and not await is_org_admin(user.id, org_id, db_session):
        raise OAuthError("access_denied", "Admin access needs an admin or maintainer role", 403)

    provenance = get_session_provenance()
    now = _now()
    # Reconnecting the same app replaces its connection, so the connected-apps
    # list keeps one row per app. The old one is revoked with all its tokens:
    # reusing it would revive tokens a password change or a narrower scope
    # was meant to end.
    previous = (
        await db_session.execute(
            select(MCPOAuthGrant.id).where(
                MCPOAuthGrant.client_id == client.client_id,
                MCPOAuthGrant.user_id == user.id,
                MCPOAuthGrant.org_id == org_id,
                MCPOAuthGrant.revoked_at.is_(None),
            )
        )
    ).all()
    for (previous_id,) in previous:
        await _revoke_grant(previous_id, db_session)
    grant = MCPOAuthGrant(
        grant_uuid=f"mcpgrant_{uuid4()}",
        client_id=client.client_id,
        user_id=user.id,
        org_id=org_id,
    )
    grant.created_at = now
    grant.scope = format_scope(granted)
    grant.auth_method = provenance.amr if provenance else None
    db_session.add(grant)
    await db_session.flush()

    code = secrets.token_urlsafe(32)
    db_session.add(
        MCPOAuthCode(
            code_hash=hash_secret(code),
            grant_id=grant.id,
            redirect_uri=redirect_uri,
            code_challenge=req["code_challenge"],
            resource=req.get("resource"),
            scope=grant.scope,
            expires_at=now + CODE_TTL,
        )
    )
    await db_session.commit()
    return redirect_with(redirect_uri, {"code": code, "state": state, "iss": issuer})


# ─── Token endpoint ───────────────────────────────────────────────────────────


def _pkce_ok(verifier: Optional[str], challenge: str) -> bool:
    if not verifier or not (43 <= len(verifier) <= 128):
        return False
    digest = hashlib.sha256(verifier.encode()).digest()
    expected = base64.urlsafe_b64encode(digest).rstrip(b"=").decode()
    return hmac.compare_digest(expected, challenge)


async def _issue_tokens(
    grant: MCPOAuthGrant, scope: str, resource: Optional[str], db_session: AsyncSession
) -> dict[str, Any]:
    now = _now()
    access = ACCESS_TOKEN_PREFIX + secrets.token_urlsafe(32)
    refresh = REFRESH_TOKEN_PREFIX + secrets.token_urlsafe(32)
    for value, kind, ttl in (
        (access, "access", ACCESS_TOKEN_TTL),
        (refresh, "refresh", REFRESH_TOKEN_TTL),
    ):
        db_session.add(
            MCPOAuthToken(
                token_hash=hash_secret(value),
                kind=kind,
                grant_id=grant.id,
                scope=scope,
                resource=resource,
                created_at=now,
                expires_at=now + ttl,
            )
        )
    grant.last_used_at = now
    db_session.add(grant)
    await db_session.commit()
    return {
        "access_token": access,
        "token_type": "Bearer",
        "expires_in": ACCESS_TOKEN_TTL,
        "refresh_token": refresh,
        "scope": scope,
    }


async def _revoke_grant(grant_id: int, db_session: AsyncSession) -> None:
    now = _now()
    await db_session.execute(
        update(MCPOAuthGrant)
        .where(MCPOAuthGrant.id == grant_id, MCPOAuthGrant.revoked_at.is_(None))
        .values(revoked_at=now)
    )
    await db_session.execute(
        update(MCPOAuthToken)
        .where(MCPOAuthToken.grant_id == grant_id, MCPOAuthToken.revoked_at.is_(None))
        .values(revoked_at=now)
    )


async def exchange_token(
    form: dict[str, str],
    authorization: Optional[str],
    request: Request,
    db_session: AsyncSession,
) -> dict[str, Any]:
    grant_type = form.get("grant_type")
    client_id = form.get("client_id") or _client_id_from_basic(authorization)
    client = await get_client(client_id, db_session)
    if client is None:
        raise OAuthError("invalid_client", "Unknown client", 401)
    _authenticate_client(client, form, authorization)

    await maybe_prune(db_session)
    if grant_type == "authorization_code":
        return await _exchange_code(client, form, request, db_session)
    if grant_type == "refresh_token":
        return await _exchange_refresh(client, form, request, db_session)
    raise OAuthError("unsupported_grant_type", f"Unsupported grant_type: {grant_type}")


async def _exchange_code(
    client: MCPOAuthClient, form: dict[str, str], request: Request, db_session: AsyncSession
) -> dict[str, Any]:
    code = form.get("code")
    if not code:
        raise OAuthError("invalid_request", "code is required")
    # DELETE ... RETURNING claims the code exactly once, even under a race.
    row = (
        await db_session.execute(
            delete(MCPOAuthCode)
            .where(MCPOAuthCode.code_hash == hash_secret(code))
            .returning(
                MCPOAuthCode.grant_id,
                MCPOAuthCode.redirect_uri,
                MCPOAuthCode.code_challenge,
                MCPOAuthCode.resource,
                MCPOAuthCode.scope,
                MCPOAuthCode.expires_at,
            )
        )
    ).first()
    await db_session.commit()
    if row is None:
        raise OAuthError("invalid_grant", "The authorization code is invalid or was already used")
    grant_id, redirect_uri, challenge, resource, scope, expires_at = row
    if expires_at < _now():
        raise OAuthError("invalid_grant", "The authorization code expired")

    grant = await db_session.get(MCPOAuthGrant, grant_id)
    if grant is None or grant.revoked_at is not None or grant.client_id != client.client_id:
        raise OAuthError("invalid_grant", "The authorization code was not issued to this client")
    sent_redirect = form.get("redirect_uri")
    if sent_redirect is None and client.redirect_uris != [redirect_uri]:
        raise OAuthError("invalid_request", "redirect_uri is required")
    if sent_redirect is not None and sent_redirect != redirect_uri:
        raise OAuthError("invalid_grant", "redirect_uri does not match the authorization request")
    if not _pkce_ok(form.get("code_verifier"), challenge):
        raise OAuthError("invalid_grant", "PKCE verification failed")
    asked_resource = (form.get("resource") or "").rstrip("/")
    if asked_resource and resource and asked_resource != resource:
        raise OAuthError("invalid_target", "resource does not match the authorization request")

    return await _issue_tokens(grant, scope, resource or mcp_resource_url(request), db_session)


async def _exchange_refresh(
    client: MCPOAuthClient, form: dict[str, str], request: Request, db_session: AsyncSession
) -> dict[str, Any]:
    raw = form.get("refresh_token")
    if not raw or not raw.startswith(REFRESH_TOKEN_PREFIX):
        raise OAuthError("invalid_grant", "refresh_token is invalid")
    token = (
        await db_session.execute(
            select(MCPOAuthToken).where(
                MCPOAuthToken.token_hash == hash_secret(raw),
                MCPOAuthToken.kind == "refresh",
            )
        )
    ).scalars().first()
    if token is None:
        raise OAuthError("invalid_grant", "refresh_token is invalid")
    grant = await db_session.get(MCPOAuthGrant, token.grant_id)
    if grant is None or grant.client_id != client.client_id:
        raise OAuthError("invalid_grant", "refresh_token was not issued to this client")

    if token.revoked_at is not None:
        # A rotated-out refresh token came back: someone holds a copy. Kill the
        # whole grant so neither copy works (OAuth 2.1 section 4.3.1).
        if grant.revoked_at is None:
            logger.warning("mcp-oauth: refresh token replay, revoking grant %s", grant.grant_uuid)
            await _revoke_grant(grant.id, db_session)
            await db_session.commit()
        raise OAuthError("invalid_grant", "refresh_token was already used")
    if grant.revoked_at is not None or token.expires_at < _now():
        raise OAuthError("invalid_grant", "refresh_token expired or was revoked")
    if not await _grant_user_still_valid(grant, db_session):
        # Ended for good: a later reconnect starts a new connection rather
        # than bringing this one's tokens back.
        await _revoke_grant(grant.id, db_session)
        await db_session.commit()
        raise OAuthError("invalid_grant", "The member's credentials changed; reconnect the app")

    scope = token.scope
    if form.get("scope"):
        asked = parse_scope(form["scope"])
        if any(s not in token.scope.split() for s in asked):
            raise OAuthError("invalid_scope", "Cannot widen the scope on refresh")
        scope = format_scope(asked)

    claimed = await db_session.execute(
        update(MCPOAuthToken)
        .where(MCPOAuthToken.id == token.id, MCPOAuthToken.revoked_at.is_(None))
        .values(revoked_at=_now())
    )
    if claimed.rowcount != 1:
        await db_session.rollback()
        raise OAuthError("invalid_grant", "refresh_token was already used")
    return await _issue_tokens(grant, scope, token.resource or mcp_resource_url(request), db_session)


async def revoke_token(
    form: dict[str, str], authorization: Optional[str], db_session: AsyncSession
) -> None:
    """RFC 7009: unknown tokens are not an error. Revoking either token of a
    grant revokes the grant, which is what "disconnect" means to a member."""
    raw = form.get("token")
    if not raw:
        raise OAuthError("invalid_request", "token is required")
    client = await get_client(form.get("client_id") or _client_id_from_basic(authorization), db_session)
    if client is not None:
        _authenticate_client(client, form, authorization)
    token = (
        await db_session.execute(
            select(MCPOAuthToken).where(MCPOAuthToken.token_hash == hash_secret(raw))
        )
    ).scalars().first()
    if token is None:
        return
    grant = await db_session.get(MCPOAuthGrant, token.grant_id)
    if grant is None or (client is not None and grant.client_id != client.client_id):
        return
    await _revoke_grant(grant.id, db_session)
    await db_session.commit()


# ─── Resource server side ─────────────────────────────────────────────────────


@dataclass(frozen=True)
class OAuthPrincipal:
    user: PublicUser
    org_id: int
    scopes: tuple[str, ...]
    grant_id: int
    grant_uuid: str
    client_id: str
    client_name: str
    auth_method: Optional[str]
    expires_at: int


async def _has_membership(user_id: int, org_id: int, db_session: AsyncSession) -> bool:
    found = (
        await db_session.execute(
            select(UserOrganization.id).where(
                UserOrganization.user_id == user_id, UserOrganization.org_id == org_id
            )
        )
    ).first()
    return found is not None


async def _grant_user_still_valid(grant: MCPOAuthGrant, db_session: AsyncSession) -> bool:
    """A password change after consent cuts the client off, and so does the
    connection's maximum age or the member leaving the organization."""
    if grant.created_at and _now() - grant.created_at > MAX_GRANT_AGE:
        return False
    user = await db_session.get(User, grant.user_id)
    if user is None:
        return False
    if not await _has_membership(grant.user_id, grant.org_id, db_session):
        return False
    changed = getattr(user, "password_changed_at", None)
    if changed is not None:
        try:
            if changed.tzinfo is None:
                # Stored as naive UTC; .timestamp() would read it as local time.
                changed = changed.replace(tzinfo=timezone.utc)
            if int(changed.timestamp()) > grant.created_at:
                return False
        except (AttributeError, TypeError, ValueError, OSError):
            pass
    return True


async def verify_access_token(
    raw: str, expected_resource: str, db_session: AsyncSession
) -> Optional[OAuthPrincipal]:
    if not raw.startswith(ACCESS_TOKEN_PREFIX):
        return None
    token = (
        await db_session.execute(
            select(MCPOAuthToken).where(
                MCPOAuthToken.token_hash == hash_secret(raw),
                MCPOAuthToken.kind == "access",
            )
        )
    ).scalars().first()
    now = _now()
    if token is None or token.revoked_at is not None or token.expires_at < now:
        return None
    if token.resource and token.resource.rstrip("/") != expected_resource.rstrip("/"):
        return None
    grant = await db_session.get(MCPOAuthGrant, token.grant_id)
    if grant is None or grant.revoked_at is not None:
        return None
    user = await db_session.get(User, grant.user_id)
    if user is None or not await _grant_user_still_valid(grant, db_session):
        await _revoke_grant(grant.id, db_session)
        await db_session.commit()
        return None
    client = await get_client(grant.client_id, db_session)

    # Cheap "last used" signal for the connected-apps list, at most once a minute.
    if not grant.last_used_at or now - grant.last_used_at > 60:
        await db_session.execute(
            update(MCPOAuthGrant).where(MCPOAuthGrant.id == grant.id).values(last_used_at=now)
        )
        await db_session.commit()

    # Never a superadmin through an app: the connection is bound to the org
    # the member picked, and platform-wide power must not reach a third party.
    data = user.model_dump()
    data["is_superadmin"] = False
    return OAuthPrincipal(
        user=PublicUser(**data),
        org_id=grant.org_id,
        scopes=tuple(token.scope.split()),
        grant_id=grant.id,
        grant_uuid=grant.grant_uuid,
        client_id=grant.client_id,
        client_name=client.client_name if client else "MCP client",
        auth_method=grant.auth_method,
        expires_at=token.expires_at,
    )


# ─── Connected apps ───────────────────────────────────────────────────────────


async def list_grants(
    org_id: int, db_session: AsyncSession, user_id: Optional[int] = None
) -> list[dict[str, Any]]:
    """Active grants in an org, for one member or (admins) everyone."""
    query = (
        select(MCPOAuthGrant, MCPOAuthClient, User)
        .join(MCPOAuthClient, MCPOAuthClient.client_id == MCPOAuthGrant.client_id)
        .join(User, User.id == MCPOAuthGrant.user_id)
        .where(
            MCPOAuthGrant.org_id == org_id,
            MCPOAuthGrant.revoked_at.is_(None),
            # Only grants an app can still use: one live refresh token.
            exists().where(
                MCPOAuthToken.grant_id == MCPOAuthGrant.id,
                MCPOAuthToken.kind == "refresh",
                MCPOAuthToken.revoked_at.is_(None),
                MCPOAuthToken.expires_at > _now(),
            ),
        )
        .order_by(MCPOAuthGrant.created_at.desc())
    )
    if user_id is not None:
        query = query.where(MCPOAuthGrant.user_id == user_id)
    rows = (await db_session.execute(query)).all()
    out = []
    for grant, client, user in rows:
        out.append(
            {
                "grant_uuid": grant.grant_uuid,
                "client_name": client.client_name,
                "client_uri": client.client_uri,
                "logo_uri": client.logo_uri,
                "scopes": grant.scope.split(),
                "created_at": grant.created_at,
                "last_used_at": grant.last_used_at,
                "user": {
                    "user_uuid": user.user_uuid,
                    "username": user.username,
                    "first_name": user.first_name,
                    "last_name": user.last_name,
                    "avatar_image": user.avatar_image,
                },
            }
        )
    return out


async def revoke_grant_by_uuid(
    grant_uuid: str, org_id: int, db_session: AsyncSession, user_id: Optional[int] = None
) -> bool:
    query = select(MCPOAuthGrant).where(
        MCPOAuthGrant.grant_uuid == grant_uuid,
        MCPOAuthGrant.org_id == org_id,
        MCPOAuthGrant.revoked_at.is_(None),
    )
    if user_id is not None:
        query = query.where(MCPOAuthGrant.user_id == user_id)
    grant = (await db_session.execute(query)).scalars().first()
    if grant is None:
        return False
    await _revoke_grant(grant.id, db_session)
    await db_session.commit()
    return True


async def revoke_member_grants(db_session: AsyncSession, user_id: int, org_id: Optional[int] = None) -> int:
    """Disconnect every app a member connected (in one org, or everywhere).

    Called when the member leaves an organization or their sign-in security
    changes (two-factor turned on or off, reset by an admin). The caller
    commits. Returns how many connections were cut."""
    query = select(MCPOAuthGrant.id).where(
        MCPOAuthGrant.user_id == user_id, MCPOAuthGrant.revoked_at.is_(None)
    )
    if org_id is not None:
        query = query.where(MCPOAuthGrant.org_id == org_id)
    ids = [row[0] for row in (await db_session.execute(query)).all()]
    for grant_id in ids:
        await _revoke_grant(grant_id, db_session)
    return len(ids)


async def prune_expired(db_session: AsyncSession) -> None:
    """Drop codes and tokens that can never verify again, and registered
    clients that never got a grant (registration is open, so abandoned ones
    would otherwise pile up)."""
    now = _now()
    cutoff = now - 24 * 60 * 60
    await db_session.execute(delete(MCPOAuthCode).where(MCPOAuthCode.expires_at < cutoff))
    await db_session.execute(delete(MCPOAuthToken).where(MCPOAuthToken.expires_at < cutoff))
    await db_session.execute(
        delete(MCPOAuthClient).where(
            MCPOAuthClient.created_at < now - ABANDONED_CLIENT_TTL,
            ~exists().where(MCPOAuthGrant.client_id == MCPOAuthClient.client_id),
        )
    )
    await db_session.commit()


async def maybe_prune(db_session: AsyncSession) -> None:
    """Prune now and then from the token endpoint instead of a scheduler.
    Never lets a cleanup failure break a token request."""
    if secrets.randbelow(PRUNE_ONE_IN) != 0:
        return
    try:
        await prune_expired(db_session)
    except Exception:  # pragma: no cover - best effort
        logger.exception("mcp-oauth: prune failed")
        await db_session.rollback()
