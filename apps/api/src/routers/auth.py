from datetime import timedelta, datetime, timezone
from typing import Literal, Optional
from fastapi import Depends, APIRouter, HTTPException, Response, status, Request, Form
from pydantic import BaseModel, EmailStr
from sqlmodel import Session, select
from src.db.users import AnonymousUser, User, UserRead
from src.core.events.database import get_db_session
from config.config import get_learnhouse_config
from src.core.deployment_mode import get_deployment_mode
from src.security.auth import (
    authenticate_user,
    get_current_user,
    create_access_token,
    create_refresh_token,
    decode_jwt,
    decode_refresh_token,
    extract_jwt_from_request,
    revoke_user_sessions_before,
    _is_token_revoked_for_user,
    _mark_refresh_jti_used,
    JWT_ACCESS_TOKEN_EXPIRES,
    JWT_REFRESH_TOKEN_EXPIRES,
    JWT_REFRESH_COOKIE_NAME,
    JWT_COOKIE_NAME,
)
from src.services.users.users import security_get_user
from src.services.auth.utils import signWithGoogle
from src.services.dev.dev import isDevModeEnabled
from src.services.security.rate_limiting import (
    check_login_rate_limit,
    check_refresh_rate_limit,
    check_email_verification_rate_limit,
    get_client_ip,
)
from src.services.security.account_lockout import (
    check_account_locked,
    record_failed_login,
    reset_failed_attempts,
    update_login_info,
    format_lockout_message,
)
from src.services.users.email_verification import (
    verify_email_token,
    resend_verification_email,
)


def get_token_expiry_ms() -> Optional[int]:
    """Get the token expiry timestamp in milliseconds for frontend use."""
    if isDevModeEnabled() or JWT_ACCESS_TOKEN_EXPIRES is None:
        return None  # No expiry in dev mode
    expiry_time = datetime.now(timezone.utc) + JWT_ACCESS_TOKEN_EXPIRES
    return int(expiry_time.timestamp() * 1000)


router = APIRouter()


def get_cookie_domain_for_request(request: Request) -> str | None:
    """
    Determine the appropriate cookie domain based on the request origin.

    - For custom domains: Returns None (cookie is host-specific)
    - For configured domain/subdomains: Returns the configured cookie domain
    - For localhost: Returns None
    """
    origin = request.headers.get("origin", "")
    referer = request.headers.get("referer", "")
    host = request.headers.get("host", "")

    # Get the configured domain
    config_domain = get_learnhouse_config().hosting_config.domain
    config_cookie_domain = get_learnhouse_config().hosting_config.cookie_config.domain

    # Check origin, referer, or host
    check_value = origin or referer or host
    if not check_value:
        return config_cookie_domain

    # Remove protocol if present
    check_value = check_value.replace("https://", "").replace("http://", "")
    # Remove path and port
    check_value = check_value.split("/")[0].split(":")[0]

    # Localhost always gets no domain
    if "localhost" in check_value or "127.0.0.1" in check_value:
        return None

    # Check if it's a subdomain of the configured domain
    is_subdomain = check_value.endswith(f".{config_domain}") or check_value == config_domain

    if is_subdomain:
        # Use configured cookie domain for subdomains
        return config_cookie_domain
    else:
        # Custom domain - no domain restriction (host-specific cookie).
        # TODO: add custom domain allowlist — query the CustomDomain table for
        # active/verified entries and raise HTTPException(400, "Invalid request
        # origin") when check_value does not match any of them. This requires
        # threading a db_session into this function (or a separate helper).
        return None


def is_request_secure(request: Request | None) -> bool:
    """
    Determine if the request is over HTTPS.
    Only trusts X-Forwarded-Proto when the direct connection is from a local proxy.
    """
    if not request:
        return not isDevModeEnabled()

    # Only trust proxy headers if connection comes from a local reverse proxy
    direct_ip = request.client.host if request.client else None
    trust_proxy = False
    if direct_ip:
        import ipaddress
        try:
            addr = ipaddress.ip_address(direct_ip)
            trust_proxy = addr.is_loopback or addr.is_private
        except ValueError:
            pass

    if trust_proxy:
        forwarded_proto = request.headers.get("x-forwarded-proto", "")
        if forwarded_proto.lower() == "https":
            return True
        if forwarded_proto.lower() == "http":
            return False

    # Check the URL scheme
    if request.url.scheme == "https":
        return True

    # Fall back to dev mode check
    return not isDevModeEnabled()


def set_auth_cookies(response: Response, access_token: str, refresh_token: str, request: Request = None):
    """Helper to set authentication cookies."""
    is_secure = is_request_secure(request)
    cookie_domain = get_cookie_domain_for_request(request) if request else None

    response.set_cookie(
        key=JWT_COOKIE_NAME,
        value=access_token,
        httponly=True,
        secure=is_secure,
        samesite="lax",
        domain=cookie_domain,
        expires=int(timedelta(hours=8).total_seconds()),
    )
    response.set_cookie(
        key=JWT_REFRESH_COOKIE_NAME,
        value=refresh_token,
        httponly=True,
        secure=is_secure,
        samesite="lax",
        domain=cookie_domain,
        expires=int(timedelta(days=30).total_seconds()),
    )


def unset_auth_cookies(response: Response, request: Request = None):
    """Helper to unset authentication cookies."""
    cookie_domain = get_cookie_domain_for_request(request) if request else None

    response.delete_cookie(key=JWT_COOKIE_NAME, domain=cookie_domain)
    response.delete_cookie(key=JWT_REFRESH_COOKIE_NAME, domain=cookie_domain)


@router.get(
    "/refresh",
    summary="Refresh access token",
    description=(
        "Validate the refresh token (read from the `refresh_token` httpOnly cookie) "
        "and issue a new access token. Subject to IP-based rate limiting."
    ),
    responses={
        200: {"description": "New access token issued and set as cookie; body contains the token and its expiry."},
        401: {"description": "Refresh token is missing or invalid"},
        429: {"description": "Too many refresh attempts from this IP"},
    },
)
async def refresh(
    request: Request,
    response: Response,
    db_session: Session = Depends(get_db_session),
):
    """
    Validates the refresh token and issues a new access token + rotated refresh
    token. The refresh token is read from cookies.

    Applies the same ``password_changed_at`` and logout-revocation checks as
    ``get_current_user`` — a refresh must not outlive either. Rotates the
    refresh cookie on every call; the old token's ``jti`` is marked consumed
    in Redis, and replay is treated as theft (all sessions revoked).
    """
    # Rate limit refresh endpoint to prevent brute force attacks
    is_allowed, retry_after = check_refresh_rate_limit(request)
    if not is_allowed:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail={
                "code": "RATE_LIMITED",
                "message": "Too many refresh attempts. Please try again later.",
                "retry_after": retry_after,
            },
        )

    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )

    refresh_token = request.cookies.get(JWT_REFRESH_COOKIE_NAME)
    if not refresh_token:
        raise credentials_exception

    payload = decode_refresh_token(refresh_token)
    if not payload:
        raise credentials_exception

    email = payload.get("sub")
    if not email:
        raise credentials_exception

    user = await security_get_user(request, db_session, email=email)
    if user is None or user.id is None:
        raise credentials_exception

    # Enforce password-change cutover: tokens minted before the user's last
    # password change are stale.
    iat_raw = payload.get("iat")
    issued_at = None
    if iat_raw:
        try:
            issued_at = datetime.fromtimestamp(iat_raw, tz=timezone.utc)
        except (TypeError, ValueError, OSError):
            issued_at = None

    pca_raw = getattr(user, "password_changed_at", None)
    if isinstance(pca_raw, datetime) and issued_at is not None:
        pca = pca_raw if pca_raw.tzinfo else pca_raw.replace(tzinfo=timezone.utc)
        if issued_at < pca:
            raise credentials_exception

    if _is_token_revoked_for_user(user.id, issued_at):
        raise credentials_exception

    # Single-use rotation + reuse detection: the first caller to present a
    # given jti claims it; any replay means the token was stolen, so wipe
    # every session for the user.
    jti = payload.get("jti")
    if jti:
        claimed = _mark_refresh_jti_used(user.id, jti)
        if not claimed:
            revoke_user_sessions_before(user.id)
            unset_auth_cookies(response, request)
            raise credentials_exception
    # Tokens minted before jti was added pass through; the rotated token
    # issued below carries a jti so reuse detection engages from here on.

    new_access_token = create_access_token(
        data={"sub": email},
        expires_delta=JWT_ACCESS_TOKEN_EXPIRES,
    )
    new_refresh_token = create_refresh_token(data={"sub": email})

    cookie_domain = get_cookie_domain_for_request(request)
    is_secure = is_request_secure(request)
    response.set_cookie(
        key=JWT_COOKIE_NAME,
        value=new_access_token,
        httponly=True,
        secure=is_secure,
        samesite="lax",
        domain=cookie_domain,
        expires=int(timedelta(hours=8).total_seconds()),
    )
    response.set_cookie(
        key=JWT_REFRESH_COOKIE_NAME,
        value=new_refresh_token,
        httponly=True,
        secure=is_secure,
        samesite="lax",
        domain=cookie_domain,
        expires=int(JWT_REFRESH_TOKEN_EXPIRES.total_seconds()),
    )
    return {"access_token": new_access_token, "expiry": get_token_expiry_ms()}


@router.post(
    "/login",
    summary="Log in with email and password",
    description=(
        "Authenticate a user with username (email) and password. On success, sets "
        "httpOnly access and refresh cookies and returns the user profile and tokens. "
        "Subject to IP-based rate limiting and account lockout after repeated failures. "
        "In SaaS mode, the account's email must be verified."
    ),
    responses={
        200: {"description": "Login successful; cookies set and body contains user + tokens."},
        401: {"description": "Incorrect email or password"},
        403: {"description": "Email not verified (SaaS mode)"},
        423: {"description": "Account is locked due to too many failed attempts"},
        429: {"description": "Too many login attempts from this IP"},
    },
)
async def login(
    request: Request,
    response: Response,
    username: str = Form(...),
    password: str = Form(...),
    db_session: Session = Depends(get_db_session),
):
    # Step 1: Check rate limit (IP-based)
    is_allowed, retry_after = check_login_rate_limit(request)
    if not is_allowed:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail={
                "code": "RATE_LIMITED",
                "message": f"Too many login attempts. Please try again in {retry_after // 60} minutes.",
                "retry_after": retry_after,
            },
        )

    # Step 2: Authenticate. authenticate_user does its own user lookup and
    # runs a dummy Argon2 verify on the unknown-user path, so the two failure
    # modes take the same wall-clock time. Anything that only runs for known
    # users (lockout bookkeeping, verification gate) must happen AFTER this
    # call returns, otherwise an observable timing asymmetry leaks account
    # existence.
    user = await authenticate_user(
        request, username, password, db_session
    )

    if not user:
        # Unknown user OR wrong password — responses are indistinguishable.
        # The row lookup below runs behind that wall for lockout bookkeeping.
        user_record = db_session.exec(
            select(User).where(User.email == username)
        ).first()
        if user_record:
            record_failed_login(
                user_record,
                db_session,
                ip_address=get_client_ip(request),
            )

        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={
                "code": "INVALID_CREDENTIALS",
                "message": "Incorrect Email or password",
            },
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Password was correct. From here on, disclosing lockout/verification
    # state no longer enables enumeration since the caller has proven they
    # control the account.

    # Step 3: Enforce lockout from prior failed attempts.
    is_pre_locked, pre_lock_remaining = check_account_locked(user)
    if is_pre_locked and pre_lock_remaining:
        raise HTTPException(
            status_code=status.HTTP_423_LOCKED,
            detail={
                "code": "ACCOUNT_LOCKED",
                "message": format_lockout_message(pre_lock_remaining),
                "retry_after": pre_lock_remaining,
            },
        )

    # Step 4: Check email verification (required for SaaS login only)
    if not user.email_verified and get_deployment_mode() == 'saas':
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "code": "EMAIL_NOT_VERIFIED",
                "message": "Please verify your email address before logging in. Check your inbox for the verification email.",
                "email": user.email,
            },
        )

    # Step 5: Reset failed attempts and update login info
    reset_failed_attempts(user, db_session)
    client_ip = get_client_ip(request)
    update_login_info(user, client_ip, db_session)

    # Step 6: Issue tokens
    access_token = create_access_token(
        data={"sub": username},
        expires_delta=JWT_ACCESS_TOKEN_EXPIRES
    )
    refresh_token = create_refresh_token(data={"sub": username})

    set_auth_cookies(response, access_token, refresh_token, request)

    user = UserRead.model_validate(user)

    result = {
        "user": user,
        "tokens": {
            "access_token": access_token,
            "refresh_token": refresh_token,
            "expiry": get_token_expiry_ms(),
        },
    }
    return result


class ThirdPartyLogin(BaseModel):
    email: EmailStr
    provider: Literal["google"]
    access_token: str


@router.post(
    "/oauth",
    summary="Log in via third-party provider",
    description=(
        "Sign in or sign up using a third-party OAuth provider (currently Google). "
        "On success, sets httpOnly access and refresh cookies and returns the user "
        "profile and tokens."
    ),
    responses={
        200: {"description": "OAuth login successful; cookies set and body contains user + tokens."},
        401: {"description": "Third-party authentication failed"},
    },
)
async def third_party_login(
    request: Request,
    response: Response,
    body: ThirdPartyLogin,
    org_id: Optional[int] = None,
    current_user: AnonymousUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
):
    import logging
    import redis as _redis
    _logger = logging.getLogger(__name__)

    # Validate org_id before passing it downstream: verify the org exists and
    # that a pending invite exists for this email in that org.  If the org does
    # not exist we reject the request. If the org exists but no invite is found
    # we log a warning and clear org_id so the user is created without an org
    # association (prevents unauthorized org membership via OAuth).
    if org_id is not None:
        from src.db.organizations import Organization
        org_record = db_session.exec(
            select(Organization).where(Organization.id == org_id)
        ).first()

        if not org_record:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid org_id",
            )

        # Check that a pending email invite exists for this address in the org
        _invite_found = False
        try:
            _lh_config = get_learnhouse_config()
            _redis_url = _lh_config.redis_config.redis_connection_string
            if _redis_url:
                _r = _redis.Redis.from_url(_redis_url)
                _invite_key = f"invited_user:{body.email}:org:{org_record.org_uuid}"
                _invite_found = bool(_r.get(_invite_key))
        except Exception as e:
            _logger.error("Redis unavailable for invite validation, org_id will be ignored: %s", e)

        if not _invite_found:
            _logger.warning(
                "OAuth org_id=%s supplied for email=%s but no pending invite found; ignoring org_id",
                org_id,
                body.email,
            )
            org_id = None

    # Google
    if body.provider == "google":

        user = await signWithGoogle(
            request, body.access_token, body.email, org_id, current_user, db_session
        )

    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect Email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    access_token = create_access_token(
        data={"sub": user.email},
        expires_delta=JWT_ACCESS_TOKEN_EXPIRES
    )
    refresh_token = create_refresh_token(data={"sub": user.email})

    set_auth_cookies(response, access_token, refresh_token, request)

    user = UserRead.model_validate(user)

    result = {
        "user": user,
        "tokens": {
            "access_token": access_token,
            "refresh_token": refresh_token,
            "expiry": get_token_expiry_ms(),
        },
    }
    return result


@router.delete(
    "/logout",
    summary="Log out the current user",
    description=(
        "Log out the current user by clearing the access and refresh cookies. "
        "Because JWTs are stored in httpOnly cookies, the frontend cannot clear "
        "them directly — the backend must respond with cookie-clearing headers."
    ),
    responses={
        200: {"description": "Logout successful; auth cookies cleared."},
        401: {"description": "No authenticated session was found"},
    },
)
async def logout(
    request: Request,
    response: Response,
    db_session: Session = Depends(get_db_session),
):
    """
    Clear the auth cookies and revoke every JWT (access and refresh) that was
    issued for this user up to this moment. The revocation is enforced by
    ``get_current_user`` via a Redis blocklist, so stolen tokens cannot
    outlive logout simply by being replayed outside the browser.
    """
    token = extract_jwt_from_request(request)
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Best-effort resolve the user to revoke every session they have across
    # devices (not just the one tied to this cookie).
    payload = decode_jwt(token)
    if payload and payload.get("sub"):
        try:
            user_record = await security_get_user(
                request, db_session, email=payload["sub"]
            )
            if user_record is not None and user_record.id is not None:
                revoke_user_sessions_before(user_record.id)
        except Exception:
            # Never block logout on a revocation-store hiccup; cookies are
            # still cleared below so the browser session ends.
            pass

    unset_auth_cookies(response, request)
    return {"msg": "Successfully logout"}


class VerifyEmailRequest(BaseModel):
    token: str
    user_uuid: str
    org_uuid: str
    email: Optional[EmailStr] = None


@router.post(
    "/verify-email",
    summary="Verify user email",
    description=(
        "Verify a user's email address using the token delivered via verification email. "
        "Rate limited to 5 attempts per 5 minutes per user_uuid."
    ),
    responses={
        200: {"description": "Email verified successfully."},
        429: {"description": "Too many verification attempts for this user"},
    },
)
async def api_verify_email(
    request: Request,
    body: VerifyEmailRequest,
    db_session: Session = Depends(get_db_session),
):
    """
    Verify user email with token.
    """
    # Rate limit: 5 attempts per 5 minutes (keyed on email when provided, user_uuid otherwise)
    is_allowed, retry_after = check_email_verification_rate_limit(body.email or body.user_uuid)
    if not is_allowed:
        raise HTTPException(
            status_code=429,
            detail=f"Too many verification attempts. Please try again in {retry_after // 60} minutes.",
        )

    result = await verify_email_token(
        request=request,
        db_session=db_session,
        token=body.token,
        user_uuid=body.user_uuid,
        org_uuid=body.org_uuid,
    )
    return {"message": result}


class ResendVerificationRequest(BaseModel):
    email: EmailStr
    org_id: Optional[int] = None


@router.post(
    "/resend-verification",
    summary="Resend verification email",
    description=(
        "Resend the email-verification email for a user. The underlying service "
        "enforces its own rate limiting and will return a generic response whether "
        "or not an account exists."
    ),
    responses={
        200: {"description": "Verification email dispatch requested."},
        429: {"description": "Too many verification email requests — rate limited"},
    },
)
async def api_resend_verification_email(
    request: Request,
    body: ResendVerificationRequest,
    db_session: Session = Depends(get_db_session),
):
    """
    Resend verification email (rate limited).
    """
    result = await resend_verification_email(
        request=request,
        db_session=db_session,
        email=body.email,
        org_id=body.org_id,
    )
    return {"message": result}
