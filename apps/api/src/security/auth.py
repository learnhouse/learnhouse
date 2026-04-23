from typing import Optional, Union
from sqlmodel import Session, select
from src.core.events.database import get_db_session
from src.db.users import AnonymousUser, APITokenUser, PublicUser, User, UserRead
from src.services.users.users import security_get_user
from config.config import get_learnhouse_config
from pydantic import BaseModel
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordBearer
import jwt
from jwt.exceptions import PyJWTError
from datetime import datetime, timedelta, timezone
from src.services.users.users import security_verify_password
from src.security.security import ALGORITHM, SECRET_KEY, security_hash_password


# SECURITY: Pre-computed Argon2 hash of an unknown password. Verifying a
# submitted password against this hash takes roughly the same wall-clock time
# as verifying against a real user's hash, so an attacker cannot distinguish
# "user exists, wrong password" from "user does not exist" by timing the login
# endpoint. The value is computed once at import time so we do not re-hash on
# every unauthenticated attempt.
_DUMMY_PASSWORD_HASH = security_hash_password("unused-sentinel-for-timing-equalization")

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")


#### JWT Auth Configuration ####################################################
JWT_SECRET_KEY = SECRET_KEY
# Dev mode only affects whether expiration is VERIFIED, not whether it's SET
# This ensures tokens created in dev mode will expire if the app switches to production
JWT_ACCESS_TOKEN_EXPIRES = timedelta(hours=8)
JWT_COOKIE_SAMESITE = "lax"
JWT_COOKIE_SECURE = True
JWT_COOKIE_DOMAIN = get_learnhouse_config().hosting_config.cookie_config.domain
JWT_COOKIE_NAME = "access_token_cookie"


def extract_jwt_from_request(request: Request) -> Optional[str]:
    """Extract JWT token from Authorization header or cookies.

    Authorization header takes precedence over cookies to ensure
    explicit token passing works even if stale cookies exist.
    """
    # Try Authorization header first (standard API behavior)
    auth_header = request.headers.get("Authorization", "")
    if auth_header.lower().startswith("bearer ") and not auth_header.lower().startswith("bearer lh_"):
        return auth_header[7:].strip()

    # Fall back to cookies (for browser-based requests without explicit token)
    token = request.cookies.get(JWT_COOKIE_NAME)
    if token:
        return token

    return None


def decode_jwt(token: str) -> Optional[dict]:
    """
    Decode and validate a JWT token.

    SECURITY NOTES:
    - Always requires 'sub' (subject) claim
    - In production, requires and verifies 'exp' (expiration) claim
    - In dev mode, expiration verification is skipped for convenience,
      but tokens should still have exp set (for when mode changes)
    - Uses explicit algorithm list to prevent algorithm confusion attacks
    """
    try:
        # SECURITY: Always require sub and exp claims, always verify expiration.
        # Dev mode no longer bypasses JWT expiration to prevent leaked tokens
        # from being valid forever if dev mode is accidentally left on.
        decode_options = {"require": ["exp", "sub"]}

        payload = jwt.decode(
            token,
            JWT_SECRET_KEY,
            algorithms=[ALGORITHM],  # Explicit algorithm prevents confusion attacks
            options=decode_options
        )
        return payload
    except PyJWTError:
        return None


#### JWT Auth Configuration ####################################################


#### Classes ####################################################


class Token(BaseModel):
    access_token: str
    token_type: str


class TokenData(BaseModel):
    username: str | None = None


#### Classes ####################################################
async def authenticate_user(
    request: Request,
    email: str,
    password: str,
    db_session: Session,
) -> User | bool:
    user = await security_get_user(request, db_session, email)
    if not user:
        # SECURITY: run a real password-verify against a dummy hash so
        # unknown-user responses take roughly the same time as known-user
        # wrong-password responses. Without this, an attacker can enumerate
        # accounts via response timing alone (Argon2 verify is slow, skipping
        # it is fast).
        security_verify_password(password, _DUMMY_PASSWORD_HASH)
        return False
    if not security_verify_password(password, user.password):
        return False
    return user


def create_access_token(data: dict, expires_delta: timedelta | None = None):
    """
    Create a JWT access token.

    SECURITY: always sets ``exp`` and ``iat`` claims. ``iat`` lets
    :func:`get_current_user` enforce both password-change-based revocation and
    the logout blocklist (see :func:`revoke_user_sessions_before`), neither of
    which can work on tokens missing an issuance timestamp.
    """
    to_encode = data.copy()
    now = datetime.now(timezone.utc)
    if expires_delta:
        expire = now + expires_delta
    else:
        # SECURITY: Always set expiration (8 hours default)
        expire = now + JWT_ACCESS_TOKEN_EXPIRES
    to_encode.update({"exp": expire, "iat": now})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt


JWT_REFRESH_TOKEN_EXPIRES = timedelta(days=30)
JWT_REFRESH_COOKIE_NAME = "refresh_token_cookie"


def create_refresh_token(data: dict, expires_delta: timedelta | None = None):
    """
    Create a JWT refresh token.

    Always sets ``exp``, ``iat`` and a random ``jti``. ``iat`` is required
    for logout/password-change revocation to apply to refresh tokens;
    ``jti`` enables one-time-use rotation with replay detection.
    """
    import secrets as _secrets
    to_encode = data.copy()
    now = datetime.now(timezone.utc)
    if expires_delta:
        expire = now + expires_delta
    else:
        expire = now + JWT_REFRESH_TOKEN_EXPIRES
    to_encode.update({
        "exp": expire,
        "iat": now,
        "type": "refresh",
        "jti": _secrets.token_urlsafe(16),
    })
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt


def _get_revocation_redis_client():
    """Return a Redis client for the session-revocation blocklist, or ``None``
    if Redis isn't configured. Failing open is acceptable here because JWTs
    still honour ``exp`` and ``password_changed_at`` — the blocklist is a
    defense-in-depth timer, not the only wall.
    """
    try:
        import redis  # local import keeps auth module importable in Redis-less tests
        lh_config = get_learnhouse_config()
        url = lh_config.redis_config.redis_connection_string
        if not url:
            return None
        return redis.Redis.from_url(url, socket_connect_timeout=2, socket_timeout=2)
    except Exception:
        return None


def revoke_user_sessions_before(user_id: int, cutoff: Optional[datetime] = None) -> bool:
    """
    Record that any JWT for ``user_id`` issued strictly before ``cutoff`` (or
    now, if omitted) must be rejected by :func:`get_current_user`. Safe to
    call on every logout; the key is written with a TTL that matches the
    longest possible session so old keys garbage-collect themselves.
    """
    ts = (cutoff or datetime.now(timezone.utc)).replace(microsecond=0)
    r = _get_revocation_redis_client()
    if r is None:
        return False
    try:
        r.setex(
            f"jwt_revoked_before:{user_id}",
            int(JWT_REFRESH_TOKEN_EXPIRES.total_seconds()),
            int(ts.timestamp()),
        )
        return True
    except Exception:
        return False


def _is_token_revoked_for_user(user_id: int, token_iat: Optional[datetime]) -> bool:
    if token_iat is None:
        # Without ``iat`` we cannot compare — treat as potentially revoked only
        # if the user has an active revocation key. This prevents pre-upgrade
        # tokens from silently bypassing logout once the key is set.
        r = _get_revocation_redis_client()
        if r is None:
            return False
        try:
            raw = r.get(f"jwt_revoked_before:{user_id}")
            return raw is not None
        except Exception:
            return False

    r = _get_revocation_redis_client()
    if r is None:
        return False
    try:
        raw = r.get(f"jwt_revoked_before:{user_id}")
    except Exception:
        return False
    if raw is None:
        return False
    try:
        cutoff_ts = int(raw)
    except (TypeError, ValueError):
        return False
    return int(token_iat.timestamp()) < cutoff_ts


def decode_refresh_token(token: str) -> Optional[dict]:
    """
    Decode and validate a refresh JWT token.

    SECURITY: Always requires expiration claim for refresh tokens.
    Dev mode does not affect refresh token validation.
    """
    try:
        # SECURITY: Always verify expiration for refresh tokens
        decode_options = {"require": ["exp", "sub"]}

        payload = jwt.decode(
            token,
            JWT_SECRET_KEY,
            algorithms=[ALGORITHM],
            options=decode_options
        )
        if payload.get("type") != "refresh":
            return None
        return payload
    except PyJWTError:
        return None


def _mark_refresh_jti_used(user_id: int, jti: str) -> bool:
    """
    Atomically record a refresh token jti as consumed. Returns True on the
    first call for a given jti and False for every subsequent replay.

    A replayed jti is a strong theft signal; callers should revoke all of
    the user's sessions.
    """
    r = _get_revocation_redis_client()
    if r is None:
        # Redis unavailable — fail open for usability (tokens still honour exp
        # and password_changed_at). This is the same defense-in-depth posture
        # as the logout blocklist.
        return True
    try:
        # NX + TTL = set-if-not-exists, auto-cleanup after the full refresh
        # window so keys don't accumulate forever.
        ok = r.set(
            f"refresh_used:{user_id}:{jti}",
            "1",
            nx=True,
            ex=int(JWT_REFRESH_TOKEN_EXPIRES.total_seconds()),
        )
        return bool(ok)
    except Exception:
        return True


async def _verify_api_token_org_boundary(
    request: Request,
    api_token_user: APITokenUser,
    db_session: Session,
) -> None:
    """
    Global safety net: reject API token requests that target a different organization.

    Checks path parameters for org_id or org_slug and verifies they match
    the token's organization. This runs before any endpoint logic.
    """
    path_params = request.path_params

    # Check org_id in path
    org_id_param = path_params.get("org_id")
    if org_id_param is not None:
        try:
            if int(org_id_param) != api_token_user.org_id:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="API token cannot access resources outside its organization",
                )
        except (ValueError, TypeError):
            pass

    # Check org_slug in path
    org_slug_param = path_params.get("org_slug")
    if org_slug_param is not None:
        from src.db.organizations import Organization
        org = db_session.exec(
            select(Organization).where(Organization.slug == org_slug_param)
        ).first()
        if org and org.id != api_token_user.org_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="API token cannot access resources outside its organization",
            )


async def get_current_user(
    request: Request,
    db_session: Session = Depends(get_db_session),
) -> Union[PublicUser, APITokenUser, AnonymousUser]:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )

    # Step 1: Check for API token (Bearer lh_...)
    auth_header = request.headers.get("Authorization", "").strip()

    # Case-insensitive check for "Bearer " prefix with lh_ token
    if auth_header.lower().startswith("bearer lh_"):
        token = auth_header[7:].strip()  # Remove "Bearer " prefix and trim
        api_token_user = await validate_api_token(token, db_session)
        if api_token_user:
            # Verify org boundary: if the URL contains an org_id or org_slug,
            # ensure it matches the token's organization
            await _verify_api_token_org_boundary(request, api_token_user, db_session)
            request.state.user = api_token_user
            request.state.is_api_token = True
            return api_token_user
        raise credentials_exception

    # Step 2: Fall back to JWT logic using PyJWT
    token = extract_jwt_from_request(request)
    username = None

    if token:
        payload = decode_jwt(token)
        if payload:
            # Reject tokens minted for a single-purpose flow (e.g. magic-link
            # one-time sign-in, password reset, email verification). Those tokens
            # are only valid at their specific consume endpoint — allowing them as
            # session tokens would let an intercepted single-use token act as a
            # full session for its entire TTL.
            # A token with no "purpose" key (purpose is None via .get) is treated
            # as a normal session token and is allowed through. A token that
            # explicitly carries purpose="session" is also allowed. Any other
            # purpose value — including "password_reset" and "email_verification"
            # — is rejected.
            token_purpose = payload.get("purpose")
            if token_purpose is not None and token_purpose != "session":
                raise credentials_exception
            username = payload.get("sub")

    token_data = TokenData(username=username)

    if username:
        user = await security_get_user(request, db_session, email=token_data.username)  # type: ignore # treated as an email
        if user is None:
            raise credentials_exception

        token_iat_raw = payload.get("iat") if token else None
        issued_at: Optional[datetime] = None
        if token_iat_raw:
            try:
                issued_at = datetime.fromtimestamp(token_iat_raw, tz=timezone.utc)
            except (TypeError, ValueError, OSError):
                issued_at = None

        # If the user changed their password after this token was issued, the
        # token is stale and must be rejected to force re-authentication.
        pca_raw = getattr(user, "password_changed_at", None)
        if isinstance(pca_raw, datetime) and issued_at is not None:
            if pca_raw.tzinfo is None:
                pca = pca_raw.replace(tzinfo=timezone.utc)
            else:
                pca = pca_raw
            if issued_at < pca:
                raise credentials_exception

        # SECURITY: if the user logged out after this token was issued, reject
        # it. This closes the "stolen token survives logout for its TTL" gap
        # without requiring a full DB-backed session store.
        if user.id is not None and _is_token_revoked_for_user(user.id, issued_at):
            raise credentials_exception

        public_user = PublicUser(**user.model_dump())
        request.state.user = public_user
        request.state.is_api_token = False
        return public_user
    else:
        return AnonymousUser()


async def non_public_endpoint(current_user: UserRead | AnonymousUser):
    if isinstance(current_user, AnonymousUser):
        raise HTTPException(status_code=401, detail="Not authenticated")


async def get_authenticated_user(
    request: Request,
    db_session: Session = Depends(get_db_session),
) -> Union[PublicUser, APITokenUser]:
    """
    Dependency that requires authentication.

    SECURITY: Use this for endpoints that should NOT be accessible to anonymous users.
    This prevents enumeration attacks where attackers iterate through IDs to scrape data.

    Returns:
        PublicUser or APITokenUser - never AnonymousUser

    Raises:
        HTTPException 401 if user is not authenticated
    """
    user = await get_current_user(request, db_session)

    if isinstance(user, AnonymousUser):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return user


async def validate_api_token(
    token: str,
    db_session: Session,
) -> Optional[APITokenUser]:
    """
    Validate an API token and return an APITokenUser if valid.

    Args:
        token: The full token string (lh_...)
        db_session: Database session

    Returns:
        APITokenUser if valid, None otherwise
    """
    from src.services.api_tokens.api_tokens import validate_api_token_for_auth

    # Validate the token using the service
    api_token = await validate_api_token_for_auth(token, db_session)

    if not api_token:
        return None

    # Normalize rights to a plain dict of plain dicts so .get() works everywhere
    raw_rights = api_token.rights
    if raw_rights is None:
        rights = None
    elif isinstance(raw_rights, dict):
        # Already a dict, but inner values might be Pydantic models
        rights = {}
        for k, v in raw_rights.items():
            if isinstance(v, dict):
                rights[k] = v
            elif hasattr(v, 'model_dump'):
                rights[k] = v.model_dump()
            elif hasattr(v, 'dict'):
                rights[k] = v.dict()
            else:
                rights[k] = v
    else:
        # Full Pydantic Rights model
        rights = raw_rights.model_dump() if hasattr(raw_rights, 'model_dump') else raw_rights.dict()

    # Create and return an APITokenUser
    return APITokenUser(
        id=api_token.id,
        user_uuid=api_token.token_uuid,
        username=f"api_token_{api_token.name}",
        org_id=api_token.org_id,
        rights=rights,
        token_name=api_token.name,
        created_by_user_id=api_token.created_by_user_id,
    )
