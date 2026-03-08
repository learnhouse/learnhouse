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
    decode_refresh_token,
    extract_jwt_from_request,
    JWT_ACCESS_TOKEN_EXPIRES,
    JWT_REFRESH_COOKIE_NAME,
    JWT_COOKIE_NAME,
)
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
        # Custom domain - no domain restriction (host-specific cookie)
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


@router.get("/refresh")
def refresh(request: Request, response: Response):
    """
    Validates the refresh token and issues a new access token.
    The refresh token is read from cookies.
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

    refresh_token = request.cookies.get(JWT_REFRESH_COOKIE_NAME)
    if not refresh_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Refresh token missing",
            headers={"WWW-Authenticate": "Bearer"},
        )

    payload = decode_refresh_token(refresh_token)
    if not payload:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid refresh token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    current_user = payload.get("sub")
    new_access_token = create_access_token(
        data={"sub": current_user},
        expires_delta=JWT_ACCESS_TOKEN_EXPIRES
    )

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
    return {"access_token": new_access_token, "expiry": get_token_expiry_ms()}


@router.post("/login")
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

    # Step 2: Get user to check lockout status
    statement = select(User).where(User.email == username)
    user_record = db_session.exec(statement).first()

    if user_record:
        # Step 3: Check if account is locked
        is_locked, remaining_seconds = check_account_locked(user_record)
        if is_locked and remaining_seconds:
            raise HTTPException(
                status_code=status.HTTP_423_LOCKED,
                detail={
                    "code": "ACCOUNT_LOCKED",
                    "message": format_lockout_message(remaining_seconds),
                    "retry_after": remaining_seconds,
                },
            )

    # Step 4: Authenticate user
    user = await authenticate_user(
        request, username, password, db_session
    )

    if not user:
        # Record failed attempt if user exists
        if user_record:
            is_now_locked, lockout_duration = record_failed_login(user_record, db_session)
            if is_now_locked:
                raise HTTPException(
                    status_code=status.HTTP_423_LOCKED,
                    detail={
                        "code": "ACCOUNT_LOCKED",
                        "message": f"Account locked due to too many failed attempts. Please try again in {lockout_duration // 60} minutes.",
                        "retry_after": lockout_duration,
                    },
                )

        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={
                "code": "INVALID_CREDENTIALS",
                "message": "Incorrect Email or password",
            },
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Step 5: Check email verification (required for SaaS login only)
    if not user.email_verified and get_deployment_mode() == 'saas':
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "code": "EMAIL_NOT_VERIFIED",
                "message": "Please verify your email address before logging in. Check your inbox for the verification email.",
                "email": user.email,
            },
        )

    # Step 6: Reset failed attempts and update login info
    reset_failed_attempts(user, db_session)
    client_ip = get_client_ip(request)
    update_login_info(user, client_ip, db_session)

    # Step 7: Issue tokens
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


@router.post("/oauth")
async def third_party_login(
    request: Request,
    response: Response,
    body: ThirdPartyLogin,
    org_id: Optional[int] = None,
    current_user: AnonymousUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
):
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


@router.delete("/logout")
def logout(request: Request, response: Response):
    """
    Because the JWT are stored in an httponly cookie now, we cannot
    log the user out by simply deleting the cookies in the frontend.
    We need the backend to send us a response to delete the cookies.
    """
    token = extract_jwt_from_request(request)
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )

    unset_auth_cookies(response, request)
    return {"msg": "Successfully logout"}


class VerifyEmailRequest(BaseModel):
    token: str
    user_uuid: str
    org_uuid: str


@router.post("/verify-email")
async def api_verify_email(
    request: Request,
    body: VerifyEmailRequest,
    db_session: Session = Depends(get_db_session),
):
    """
    Verify user email with token.
    """
    # Rate limit: 5 attempts per 5 minutes per user_uuid
    is_allowed, retry_after = check_email_verification_rate_limit(body.user_uuid)
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


@router.post("/resend-verification")
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
