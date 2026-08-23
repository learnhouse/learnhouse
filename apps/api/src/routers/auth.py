import logging
from datetime import timedelta, datetime, timezone
from typing import Literal, Optional
from fastapi import Depends, APIRouter, HTTPException, Response, status, Request, Form
from pydantic import BaseModel, EmailStr
from sqlalchemy import func
from sqlmodel import select
from src.db.users import AnonymousUser, User, UserRead
from sqlmodel.ext.asyncio.session import AsyncSession
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
    _store_refresh_grace,
    _get_refresh_grace,
    JWT_ACCESS_TOKEN_EXPIRES,
    JWT_REFRESH_TOKEN_EXPIRES,
    JWT_REFRESH_COOKIE_NAME,
    JWT_COOKIE_NAME,
)
from src.services.users.users import security_get_user
from src.services.auth.utils import signWithGoogle, get_google_user_info
from src.services.audit.audit import record_audit_event
from src.db.user_audit_events import UserAuditEventType
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
from src.services.auth.session import issue_session_or_challenge
from src.security.session_context import (
    AUTH_METHOD_GOOGLE,
    AUTH_METHOD_PASSWORD,
    carry_session_claims,
)
from src.db.organizations import Organization


async def _resolve_org_id_from_slug(org_slug: Optional[str], db_session: AsyncSession) -> Optional[int]:
    """Map an optional login-page org slug to an org id, for the session's
    ``sorg`` binding. Unknown/absent slug → None (a central/apex login)."""
    if not org_slug:
        return None
    org = (
        await db_session.execute(select(Organization).where(Organization.slug == org_slug))
    ).scalars().first()
    return org.id if org else None


def get_token_expiry_ms() -> Optional[int]:
    """Get the token expiry timestamp in milliseconds for frontend use."""
    if isDevModeEnabled() or JWT_ACCESS_TOKEN_EXPIRES is None:
        return None  # No expiry in dev mode
    expiry_time = datetime.now(timezone.utc) + JWT_ACCESS_TOKEN_EXPIRES
    return int(expiry_time.timestamp() * 1000)


router = APIRouter()


def get_cookie_domain_for_request(request: Request) -> str | None:
    """
    Determine the appropriate cookie domain based on the tenancy mode.

    - tenancy == "single": always returns None. Cookies are host-only on
      whatever Host the request arrived with — same code path serves
      localhost dev and self-hosted VPS deployments on any domain.
    - tenancy == "multi":
        - request from a subdomain of LEARNHOUSE_DOMAIN → configured cookie
          domain (e.g. ".learnhouse.io") so subdomains share the session.
        - request from a custom (per-org) domain or unknown host → None
          (host-only cookie).
    """
    config = get_learnhouse_config()
    tenancy = config.hosting_config.tenancy

    if tenancy == "single":
        return None

    origin = request.headers.get("origin", "")
    referer = request.headers.get("referer", "")
    host = request.headers.get("host", "")

    config_domain = config.hosting_config.domain
    config_cookie_domain = config.hosting_config.cookie_config.domain

    check_value = origin or referer or host
    if not check_value:
        return config_cookie_domain

    # Strip protocol, path, and port for hostname comparison.
    check_value = check_value.replace("https://", "").replace("http://", "")
    check_value = check_value.split("/")[0].split(":")[0]

    # In multi mode, localhost should not appear in practice (would indicate
    # misconfig). Treat it as host-only as a safety net.
    if "localhost" in check_value or "127.0.0.1" in check_value:
        return None

    is_subdomain = (
        check_value.endswith(f".{config_domain}")
        or check_value == config_domain
    )

    if is_subdomain:
        return config_cookie_domain

    # Custom (per-org) domain, or an unrecognized/forged origin → host-only
    # cookie. This is the safe boundary: a host-only cookie is scoped to the
    # exact Host that received it, so a request carrying a forged Origin/Referer
    # can never cause a session cookie to be written on the shared
    # `.{top_domain}` scope (which is the only thing that would enable
    # cross-domain theft). Registered custom domains are deliberately a separate
    # auth realm and also get host-only cookies here.
    #
    # We intentionally do NOT query the CustomDomain table to *reject*
    # unrecognized origins: that would add an async DB lookup to the login/
    # refresh hot path and risk locking out legitimate custom domains during DNS
    # propagation / verification lag — for no real gain, since the host-only
    # fallback already removes the cross-domain leakage vector. If an explicit
    # allowlist is ever required (e.g. to harden against cache-poisoning of the
    # Host header), enforce it in a dedicated dependency on the login/oauth
    # routes, not in this cookie-scope resolver.
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
        max_age=int(timedelta(hours=8).total_seconds()),
    )
    response.set_cookie(
        key=JWT_REFRESH_COOKIE_NAME,
        value=refresh_token,
        httponly=True,
        secure=is_secure,
        samesite="lax",
        domain=cookie_domain,
        max_age=int(timedelta(days=30).total_seconds()),
    )


def unset_auth_cookies(response: Response, request: Request = None):
    """Helper to unset authentication cookies."""
    cookie_domain = get_cookie_domain_for_request(request) if request else None

    response.delete_cookie(key=JWT_COOKIE_NAME, domain=cookie_domain)
    response.delete_cookie(key=JWT_REFRESH_COOKIE_NAME, domain=cookie_domain)


_refresh_logger = logging.getLogger("learnhouse.auth.refresh")


def _token_age_seconds(payload: dict | None) -> int | None:
    """Seconds since the presented refresh token was issued, or None.

    The key disambiguator for replay detection: a benign desync (two tabs, a
    server-rendered page racing the client) re-presents a token seconds old,
    while a genuinely stolen token is reused hours or days later.
    """
    if not payload:
        return None
    iat = payload.get("iat")
    if not iat:
        return None
    try:
        issued = datetime.fromtimestamp(iat, tz=timezone.utc)
    except (TypeError, ValueError, OSError, OverflowError):
        return None
    return int((datetime.now(timezone.utc) - issued).total_seconds())


def _log_refresh_outcome(
    outcome: str,
    *,
    user_id: int | None = None,
    token_age_seconds: int | None = None,
    level: int = logging.INFO,
) -> None:
    """Emit one structured line per refresh attempt, tagged with its outcome.

    Exists because this endpoint had NO telemetry: when users reported being
    randomly signed out, there was no way to tell an expired token from a
    revocation from replay detection, and diagnosing it required reading the
    code instead of querying. Outcomes are a closed set —
    ``ok``, ``grace_reused``, ``rate_limited``, ``cookie_missing``,
    ``undecodable``, ``no_subject``, ``user_not_found``, ``password_changed``,
    ``revoked_before``, ``replay_detected`` — so they can be counted and alerted
    on. A rising ``replay_detected`` or ``revoked_before`` rate is the signal
    that sessions are being destroyed rather than expiring.

    Never raises: telemetry must not be able to break authentication.
    """
    try:
        _refresh_logger.log(
            level,
            "auth.refresh outcome=%s user_id=%s token_age_seconds=%s",
            outcome,
            user_id if user_id is not None else "-",
            token_age_seconds if token_age_seconds is not None else "-",
            extra={
                "event": "auth.refresh",
                "outcome": outcome,
                "user_id": user_id,
                "token_age_seconds": token_age_seconds,
            },
        )
    except Exception:  # pragma: no cover - telemetry must never break auth
        pass


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
    db_session: AsyncSession = Depends(get_db_session),
):
    """
    Validates the refresh token and issues a new access token + rotated refresh
    token. The refresh token is read from cookies.

    Applies the same ``password_changed_at`` and logout-revocation checks as
    ``get_current_user`` — a refresh must not outlive either. Rotates the
    refresh cookie on every call; the old token's ``jti`` is marked consumed
    in Redis, and replay is treated as theft (all sessions revoked).

    Every exit path emits an ``auth.refresh`` log line tagged with its outcome —
    see :func:`_log_refresh_outcome`.
    """
    # Rate limit refresh endpoint to prevent brute force attacks
    is_allowed, retry_after = check_refresh_rate_limit(request)
    if not is_allowed:
        _log_refresh_outcome("rate_limited")
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
        _log_refresh_outcome("cookie_missing")
        raise credentials_exception

    payload = decode_refresh_token(refresh_token)
    if not payload:
        # Bad signature, wrong token type, or — overwhelmingly the common case —
        # naturally expired.
        _log_refresh_outcome("undecodable")
        raise credentials_exception

    email = payload.get("sub")
    if not email:
        _log_refresh_outcome("no_subject")
        raise credentials_exception

    user = await security_get_user(request, db_session, email=email)
    if user is None or user.id is None:
        _log_refresh_outcome("user_not_found", token_age_seconds=_token_age_seconds(payload))
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
            _log_refresh_outcome(
                "password_changed", user_id=user.id, token_age_seconds=_token_age_seconds(payload)
            )
            raise credentials_exception

    if _is_token_revoked_for_user(user.id, issued_at):
        # The user's sessions were revoked after this token was issued — by an
        # explicit logout, or by replay detection firing on another request.
        _log_refresh_outcome(
            "revoked_before", user_id=user.id, token_age_seconds=_token_age_seconds(payload)
        )
        raise credentials_exception

    # One-time-use rotation with replay detection and a benign-replay grace
    # window. Atomically mark this refresh token's jti as consumed. The FIRST
    # presentation succeeds and caches the rotated pair for a few seconds.
    #
    # A subsequent presentation of the SAME jti is either:
    #   - a benign concurrent/retried refresh (multiple tabs sharing the cookie
    #     jar, a network retry) arriving within the grace window — we re-serve
    #     the exact pair the first call issued, so nobody gets logged out; or
    #   - a replay AFTER the window (a stolen token being reused) — treated as
    #     theft: every session for the user is revoked.
    jti = payload.get("jti")
    reused_pair = None
    if jti:
        first_use = _mark_refresh_jti_used(user.id, jti)
        if not first_use:
            # Poll briefly for the grace entry: a truly simultaneous request may
            # lose the NX race before the winner has written its cached pair.
            import asyncio as _asyncio
            for _attempt in range(15):
                reused_pair = _get_refresh_grace(user.id, jti)
                if reused_pair is not None:
                    break
                await _asyncio.sleep(0.1)
            if reused_pair is None:
                # No live grace entry → replay outside the window → theft.
                # This is the single most destructive outcome (it revokes every
                # session on every device), so it is logged at WARNING with the
                # token's age — a benign desync shows up as a young token, real
                # theft as an old one.
                _log_refresh_outcome(
                    "replay_detected",
                    user_id=user.id,
                    token_age_seconds=_token_age_seconds(payload),
                    level=logging.WARNING,
                )
                revoke_user_sessions_before(user.id)
                raise credentials_exception

    if reused_pair is not None:
        new_access_token = reused_pair["access_token"]
        new_refresh_token = reused_pair["refresh_token"]
    else:
        # Carry the session's provenance across rotation. Without this a refresh
        # would silently launder a method-bound/org-bound session into a
        # claim-less one that bypasses the org auth-method / sharing policy.
        # A session that records no method also picks up its grace deadline here.
        carried = carry_session_claims(payload)
        new_access_token = create_access_token(
            data={"sub": email, **carried},
            expires_delta=JWT_ACCESS_TOKEN_EXPIRES,
        )
        new_refresh_token = create_refresh_token(data={"sub": email, **carried})
        if jti:
            _store_refresh_grace(
                user.id, jti, new_access_token, new_refresh_token
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
        max_age=int(timedelta(hours=8).total_seconds()),
    )
    response.set_cookie(
        key=JWT_REFRESH_COOKIE_NAME,
        value=new_refresh_token,
        httponly=True,
        secure=is_secure,
        samesite="lax",
        domain=cookie_domain,
        max_age=int(JWT_REFRESH_TOKEN_EXPIRES.total_seconds()),
    )
    _log_refresh_outcome(
        "grace_reused" if reused_pair is not None else "ok",
        user_id=user.id,
        token_age_seconds=_token_age_seconds(payload),
    )

    # Return the rotated refresh token in the body so a Next.js route handler
    # acting as a proxy can mirror the rotation onto its own cookies. Without
    # this, browsers behind a proxy keep the OLD refresh token (now consumed
    # in Redis), and the next refresh call triggers replay detection → 401.
    return {
        "access_token": new_access_token,
        "refresh_token": new_refresh_token,
        "expiry": get_token_expiry_ms(),
    }


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
    org_slug: Optional[str] = Form(None),
    db_session: AsyncSession = Depends(get_db_session),
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
        user_record = (await db_session.execute(
            select(User).where(User.email == username)
        )).scalars().first()
        if user_record:
            await record_failed_login(
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

    # Step 5: Enforce the org's allowed sign-in methods. Only meaningful when the
    # login page named an org (the apex login belongs to no single org, and is
    # caught by the per-request gate instead). Runs after the password check so
    # the refusal can never be used to probe which orgs exist.
    from src.services.orgs.auth_policy import enforce_login_auth_method

    session_org_id = await _resolve_org_id_from_slug(org_slug, db_session)
    await enforce_login_auth_method(db_session, session_org_id, AUTH_METHOD_PASSWORD)

    # Step 6: Reset failed attempts and update login info
    await reset_failed_attempts(user, db_session)
    client_ip = get_client_ip(request)
    await update_login_info(user, client_ip, db_session)

    # Durable connection record for the per-student audit log. Org-agnostic —
    # a login authenticates the user, not a single org membership.
    await record_audit_event(
        event_type=UserAuditEventType.LOGIN,
        user_id=user.id,
        ip=client_ip,
        user_agent=request.headers.get("user-agent"),
        metadata={"method": "password"},
    )

    # Step 7: Issue a session — unless the account carries a second factor, in
    # which case this returns a short-lived pending token instead and the caller
    # must complete /auth/login/mfa. No cookies and no user object are returned
    # on that branch: nothing is authenticated until the code is verified.
    issue = await issue_session_or_challenge(
        db_session, user, amr=AUTH_METHOD_PASSWORD, org_id=session_org_id
    )
    if issue.mfa_required:
        return {
            "mfa_required": True,
            "mfa_token": issue.mfa_token,
        }

    set_auth_cookies(response, issue.access_token, issue.refresh_token, request)

    user = UserRead.model_validate(user)

    result = {
        "user": user,
        "tokens": {
            "access_token": issue.access_token,
            "refresh_token": issue.refresh_token,
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
        200: {
            "description": (
                "OAuth login successful; cookies set and body contains user + tokens. "
                "If the account has a confirmed second factor, no cookies are set and "
                "the body is {mfa_required: true, mfa_token} instead."
            )
        },
        400: {"description": "Unknown org_id or unsupported provider"},
        401: {"description": "Third-party authentication failed"},
        403: {"description": "Organization is invite-only and no valid invite was provided"},
        503: {"description": "Invitation could not be verified; retry"},
    },
)
async def third_party_login(
    request: Request,
    response: Response,
    body: ThirdPartyLogin,
    org_id: Optional[int] = None,
    invite_code: Optional[str] = None,
    current_user: AnonymousUser = Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
):
    import logging
    import redis as _redis
    _logger = logging.getLogger(__name__)

    # Usergroup to attach the user to after sign-in, when they joined through an
    # invite code that is linked to one (mirrors create_user_with_invite).
    _invite_usergroup_id = None
    # Pending email invite to mark as consumed once the user actually joins.
    _consume_invite_key = None

    # Validate org_id before passing it downstream. The rule must mirror the
    # email/password signup endpoints, otherwise the same person gets a
    # different outcome depending on which button they pressed:
    #
    #   open org       -> POST /users/{org_id}                (no invite needed)
    #   inviteOnly org -> POST /users/{org_id}/invite/{code}  (invite required)
    #
    # Previously this endpoint required a pending *email* invite in Redis for
    # every org regardless of its join mechanism, and silently dropped org_id
    # when none was found. Signing up with Google into an open org — or through
    # an invite *code* link — therefore created an account with no organization
    # at all, while the equivalent form signup joined the org normally.
    if org_id is not None:
        from src.db.organizations import Organization
        from src.services.orgs.orgs import get_org_join_mechanism
        from src.services.orgs.invites import get_invite_code

        org_record = (await db_session.execute(
            select(Organization).where(Organization.id == org_id)
        )).scalars().first()

        if not org_record:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid org_id",
            )

        # An org that has turned Google off must not be joinable — or reachable —
        # through the Google button. Same door-level refusal as password login.
        from src.services.orgs.auth_policy import enforce_login_auth_method

        await enforce_login_auth_method(db_session, org_id, AUTH_METHOD_GOOGLE)

        join_mechanism = await get_org_join_mechanism(
            request, org_id, current_user, db_session
        )

        # Open orgs: anyone may join, exactly as POST /users/{org_id} allows.
        # inviteOnly orgs: the caller must prove an invite.
        if join_mechanism == "inviteOnly":
            # SECURITY: resolve the identity from the Google-verified email, NOT
            # from the attacker-controlled body.email. signWithGoogle keys the
            # account on the Google-returned email but honors org_id to grant
            # membership. If the invite gate trusted body.email, an attacker could
            # supply a victim's invited address (passing the gate) while
            # authenticating with their own Google token, and get their own account
            # joined to an org they were never invited to. The invite must be
            # checked against the same email that will own the account.
            if body.provider == "google":
                _google_user = await get_google_user_info(body.access_token)
                _verified_email = _google_user.get("email")
                if not _verified_email or not _google_user.get("email_verified"):
                    raise HTTPException(
                        status_code=status.HTTP_401_UNAUTHORIZED,
                        detail="Google did not return a verified email for this account",
                    )
                _invite_email = _verified_email.strip().lower()
            else:
                _invite_email = body.email.strip().lower()

            _authorized = False

            # 0. Already a member: this is a plain sign-in, not a join. The org
            #    context cookie is set on the login page too, so requiring an
            #    invite here would lock existing members out of their own org.
            from src.db.user_organizations import UserOrganization

            _existing_member = (await db_session.execute(
                select(UserOrganization)
                .join(User, User.id == UserOrganization.user_id)  # type: ignore[arg-type]
                .where(
                    (func.lower(User.email) == _invite_email)
                    & (UserOrganization.org_id == org_id)
                )
            )).scalars().first()
            if _existing_member:
                _authorized = True

            # 1. An invite code carried through the OAuth redirect, same code the
            #    form signup would have posted to /users/{org_id}/invite/{code}.
            if invite_code:
                try:
                    _code_data = await get_invite_code(
                        request, org_id, invite_code, current_user, db_session
                    )
                except HTTPException:
                    _code_data = None
                if _code_data:
                    _authorized = True
                    _invite_usergroup_id = _code_data.get("usergroup_id")

            # 2. Or a pending invite sent to this address from the org dashboard.
            if not _authorized:
                _r = None
                try:
                    _lh_config = get_learnhouse_config()
                    _redis_url = _lh_config.redis_config.redis_connection_string
                    if _redis_url:
                        _r = _redis.Redis.from_url(_redis_url)
                        _invite_key = f"invited_user:{_invite_email}:org:{org_record.org_uuid}"
                        if _r.get(_invite_key):
                            _authorized = True
                            _consume_invite_key = _invite_key
                except Exception as e:
                    # Fail loudly. Continuing here used to create the account with
                    # no org, which looks like a successful signup to the user but
                    # leaves them outside the organization with nothing to retry.
                    _logger.error("Redis unavailable for invite validation: %s", e)
                    raise HTTPException(
                        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                        detail="Could not verify your invitation right now, please try again.",
                    )
                finally:
                    # Always release the Redis connection pool created by from_url;
                    # otherwise every OAuth login leaks a connection pool/socket and
                    # the API eventually exhausts file descriptors / Redis connections.
                    if _r is not None:
                        try:
                            _r.close()
                        except Exception:
                            pass

            if not _authorized:
                _logger.warning(
                    "OAuth org_id=%s supplied but no valid invite was found for the account",
                    org_id,
                )
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="You need an invite to join this organization",
                )

    user = None

    # Google
    if body.provider == "google":

        user = await signWithGoogle(
            request, body.access_token, body.email, org_id, current_user, db_session
        )
    else:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unsupported provider",
        )

    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect Email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Finish the invite the same way the form signup does: attach the usergroup
    # the invite code is linked to, and stop showing the invite as pending.
    # Neither of these ran on the OAuth path before, so a user invited by email
    # stayed "pending" in the org's member list after joining, and an invite code
    # carrying a usergroup silently didn't apply it.
    if _invite_usergroup_id and user.id is not None:
        from src.db.users import InternalUser
        from src.services.users.usergroups import add_users_to_usergroup

        try:
            await add_users_to_usergroup(
                request,
                db_session,
                InternalUser(id=0),
                int(_invite_usergroup_id),
                str(user.id),
            )
        except Exception:
            # The account exists and is in the org; a usergroup failure must not
            # turn a completed sign-in into an error.
            _logger.warning("Could not attach OAuth user to invite usergroup")

    if _consume_invite_key:
        _r = None
        try:
            _redis_url = get_learnhouse_config().redis_config.redis_connection_string
            if _redis_url:
                _r = _redis.Redis.from_url(_redis_url)
                _invited_data = _r.get(_consume_invite_key)
                if _invited_data:
                    import json as _json

                    _invited_record = _json.loads(_invited_data)
                    _invited_record["pending"] = False
                    _remaining_ttl = _r.ttl(_consume_invite_key)
                    _r.set(
                        _consume_invite_key,
                        _json.dumps(_invited_record),
                        ex=_remaining_ttl if _remaining_ttl > 0 else None,
                    )
        except Exception:
            _logger.warning("Could not mark invitation as accepted")
        finally:
            if _r is not None:
                try:
                    _r.close()
                except Exception:
                    pass

    # Issue the session through the same chokepoint as password and magic-link
    # login, so an account with a confirmed second factor is challenged here too.
    # Minting directly meant a Google sign-in skipped an enrolled TOTP factor
    # entirely — and the org-wide require_2fa policy did not catch it either,
    # because the factor exists and so the user counts as compliant. The
    # provenance (amr/sorg) is stamped either way for the org auth-method policy.
    issue = await issue_session_or_challenge(
        db_session, user, amr=AUTH_METHOD_GOOGLE, org_id=org_id
    )
    if issue.mfa_required:
        return {
            "mfa_required": True,
            "mfa_token": issue.mfa_token,
        }

    set_auth_cookies(response, issue.access_token, issue.refresh_token, request)

    user = UserRead.model_validate(user)

    result = {
        "user": user,
        "tokens": {
            "access_token": issue.access_token,
            "refresh_token": issue.refresh_token,
            "expiry": get_token_expiry_ms(),
        },
    }
    return result


class MagicLinkLoginRequest(BaseModel):
    email: EmailStr
    org_slug: Optional[str] = None


class MagicLinkVerifyRequest(BaseModel):
    token: str


@router.post(
    "/magic-link/request",
    summary="Request a passwordless login link by email",
    description=(
        "Emails a one-time, short-lived login link to the address if an account "
        "exists. Always returns 200 with the same body regardless of whether the "
        "account exists, so it cannot be used to enumerate users."
    ),
    responses={200: {"description": "If the account exists, a link has been sent."}, 429: {"description": "Too many requests"}},
)
async def magic_link_request(
    request: Request,
    body: MagicLinkLoginRequest,
    db_session: AsyncSession = Depends(get_db_session),
):
    from src.services.auth.magic_login import (
        issue_magic_login_token,
        resolve_org,
        send_magic_login_email,
    )
    from src.services.orgs.auth_policy import is_login_method_allowed
    from src.security.session_context import AUTH_METHOD_MAGIC_LOGIN
    from src.services.email.utils import get_base_url_from_request

    is_allowed, retry_after = check_login_rate_limit(request)
    if not is_allowed:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail={"code": "RATE_LIMITED", "message": "Too many requests. Please try again later.", "retry_after": retry_after},
        )

    generic = {"detail": "If an account exists for that email, a login link has been sent."}

    org = await resolve_org(body.org_slug, db_session)
    # If the request is scoped to an org that does not offer magic-link login,
    # do not send one — the link would only be refused at the org gate anyway.
    if org is not None and not await is_login_method_allowed(
        db_session, org.id, AUTH_METHOD_MAGIC_LOGIN
    ):
        return generic

    user = (
        await db_session.execute(select(User).where(User.email == str(body.email)))
    ).scalars().first()
    if user is None:
        return generic
    # In SaaS mode an unverified account can't log in by password; keep parity so
    # a magic link can't be a verification-bypass side channel.
    if not user.email_verified and get_deployment_mode() == "saas":
        return generic

    try:
        token = issue_magic_login_token(user.email, org.id if org else None)
        send_magic_login_email(
            UserRead.model_validate(user),
            user.email,
            get_base_url_from_request(request),
            token,
        )
    except Exception:
        import logging
        logging.getLogger(__name__).exception("Failed to send magic-login email")
    return generic


@router.post(
    "/magic-link/verify",
    summary="Complete a passwordless login",
    description=(
        "Exchange a one-time login-link token for a session. If the account has "
        "two-factor enabled, returns an `mfa_token` instead and no cookies are set "
        "until the code is verified at /auth/login/mfa."
    ),
    responses={200: {"description": "Login successful, or a second factor is required."}, 410: {"description": "Link invalid or already used"}},
)
async def magic_link_verify(
    request: Request,
    response: Response,
    body: MagicLinkVerifyRequest,
    db_session: AsyncSession = Depends(get_db_session),
):
    from src.services.auth.magic_login import consume_magic_login_token
    from src.security.session_context import AUTH_METHOD_MAGIC_LOGIN
    from src.services.orgs.auth_policy import enforce_login_auth_method

    email, org_id = consume_magic_login_token(body.token)

    # A link issued before the org turned magic login off must not still work.
    await enforce_login_auth_method(db_session, org_id, AUTH_METHOD_MAGIC_LOGIN)

    user = (
        await db_session.execute(select(User).where(User.email == email))
    ).scalars().first()
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail={"code": "MAGIC_LINK_INVALID", "message": "This login link is no longer valid."},
        )

    client_ip = get_client_ip(request)
    await update_login_info(user, client_ip, db_session)

    issue = await issue_session_or_challenge(
        db_session, user, amr=AUTH_METHOD_MAGIC_LOGIN, org_id=org_id
    )
    if issue.mfa_required:
        return {"mfa_required": True, "mfa_token": issue.mfa_token}

    set_auth_cookies(response, issue.access_token, issue.refresh_token, request)
    return {
        "user": UserRead.model_validate(user),
        "tokens": {
            "access_token": issue.access_token,
            "refresh_token": issue.refresh_token,
            "expiry": get_token_expiry_ms(),
        },
    }


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
    db_session: AsyncSession = Depends(get_db_session),
):
    """
    Clear the auth cookies and revoke every JWT (access and refresh) that was
    issued for this user up to this moment. The revocation is enforced by
    ``get_current_user`` via a Redis blocklist, so stolen tokens cannot
    outlive logout simply by being replayed outside the browser.
    """
    # Identify the session from either credential. A caller that presents only
    # the refresh cookie is still logging out a real session, and refusing it
    # meant the revocation below never ran — a proxy that forwarded one cookie
    # and not the other silently turned every logout into cookie-clearing only.
    token = extract_jwt_from_request(request)
    payload = decode_jwt(token) if token else None
    if not payload or not payload.get("sub"):
        refresh_token = request.cookies.get(JWT_REFRESH_COOKIE_NAME)
        if refresh_token:
            payload = decode_refresh_token(refresh_token) or payload
            token = token or refresh_token

    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Best-effort resolve the user to revoke every session they have across
    # devices (not just the one tied to this cookie).
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
    response: Response,
    body: VerifyEmailRequest,
    db_session: AsyncSession = Depends(get_db_session),
):
    """
    Verify user email with token.

    On success the user is also signed in automatically: access/refresh cookies
    are set (same as ``/login``) and the tokens are returned in the body so a
    same-origin proxy can mirror them. This spares newly-verified users from
    re-entering their password right after confirming their email.
    """
    # Rate limit: 5 attempts per 5 minutes. Key strictly on the stable
    # user_uuid (+ org_uuid) identity, NOT on the attacker-controllable
    # ``email`` field. ``email`` is not used by verify_email_token at all, so
    # keying on it let a caller bypass the limit entirely by rotating the
    # email value while brute-forcing tokens for a fixed user_uuid.
    is_allowed, retry_after = check_email_verification_rate_limit(
        f"{body.user_uuid}:{body.org_uuid}"
    )
    if not is_allowed:
        raise HTTPException(
            status_code=429,
            detail=f"Too many verification attempts. Please try again in {retry_after // 60} minutes.",
        )

    # On invalid/expired/mismatched tokens this raises (4xx) and no session is
    # issued — only a fresh, valid verification reaches the token-minting below.
    user, message = await verify_email_token(
        request=request,
        db_session=db_session,
        token=body.token,
        user_uuid=body.user_uuid,
        org_uuid=body.org_uuid,
    )

    # Auto sign-in: issue a session exactly like /login (sub = email), and go
    # through the same second-factor gate. A brand-new user cannot have MFA yet,
    # but an existing user re-verifying their address can — and without this the
    # verification link would be a way around their own second factor.
    #
    # Stamp the provenance like every other sign-in path. Minting a claim-less
    # session here meant a freshly-verified member could not be matched against
    # the org's allowed-method policy at all.
    from src.security.session_context import AUTH_METHOD_MAGIC_LOGIN

    verified_org = (
        await db_session.execute(
            select(Organization).where(Organization.org_uuid == body.org_uuid)
        )
    ).scalars().first()
    issue = await issue_session_or_challenge(
        db_session,
        user,
        amr=AUTH_METHOD_MAGIC_LOGIN,
        org_id=verified_org.id if verified_org else None,
    )
    if issue.mfa_required:  # pragma: no cover - same 2FA branch as /login, exercised there
        return {
            "message": message,
            "mfa_required": True,
            "mfa_token": issue.mfa_token,
        }

    set_auth_cookies(response, issue.access_token, issue.refresh_token, request)

    return {
        "message": message,
        "user": UserRead.model_validate(user),
        "tokens": {
            "access_token": issue.access_token,
            "refresh_token": issue.refresh_token,
            "expiry": get_token_expiry_ms(),
        },
    }


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
    db_session: AsyncSession = Depends(get_db_session),
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
