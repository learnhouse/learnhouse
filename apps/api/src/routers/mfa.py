"""Two-factor authentication: enrollment, management and the login challenge.

Mounted under ``/api/v1/auth`` alongside the main auth router. The login
challenge deliberately lives at ``/auth/login/mfa`` so the web app's auth proxy
(``TOKEN_RESPONSE_PATHS``, which matches on prefix) mirrors its cookies without
needing a separate allowlist entry.
"""

from datetime import datetime
from typing import Optional, Union

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel
from sqlalchemy.orm.attributes import flag_modified
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.core.events.database import get_db_session
from src.db.user_mfa import UserMFA
from src.db.users import APITokenUser, PublicUser, SuperadminAPITokenUser, User, UserRead
from src.security.auth import get_authenticated_user
from src.security.security import security_verify_password
from src.services.auth.mfa import (
    build_provisioning_uri,
    consume_backup_code,
    count_unused_backup_codes,
    decrypt_secret,
    disable_mfa,
    encrypt_secret,
    generate_totp_secret,
    get_user_mfa,
    replace_backup_codes,
    verify_and_consume_totp,
    verify_totp_code,
)
from src.services.auth.session import (
    decode_mfa_pending_token,
    decode_mfa_pending_provenance,
    mint_session_tokens,
)
from src.services.orgs.auth_policy import auth_policy_exception, evaluate_org_auth
from src.services.orgs.mfa_policy import evaluate_mfa_compliance, get_org_mfa_policy
from src.services.security.rate_limiting import check_rate_limit, get_client_ip
from src.security.org_auth import is_org_admin
from src.db.organization_config import OrganizationConfig
from src.db.user_organizations import UserOrganization
from src.routers.auth import get_token_expiry_ms, set_auth_cookies

router = APIRouter()


### 🔒 Request models ##############################################################


class MFASetupRequest(BaseModel):
    password: Optional[str] = None


class MFACodeRequest(BaseModel):
    code: str


class MFADisableRequest(BaseModel):
    password: Optional[str] = None
    code: str


class MFALoginRequest(BaseModel):
    mfa_token: str
    code: str
    is_backup_code: bool = False


### 🔒 Helpers ##############################################################


async def _require_human_user(
    current_user: Union[PublicUser, APITokenUser, SuperadminAPITokenUser],
    db_session: AsyncSession,
) -> User:
    """Resolve the acting principal to a real User row.

    API tokens are rejected outright: a machine credential must not be able to
    enroll, and more importantly must not be able to *remove* a second factor
    from a human's account.
    """
    if isinstance(current_user, (APITokenUser, SuperadminAPITokenUser)):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "code": "API_TOKEN_NOT_ALLOWED",
                "message": "Two-factor settings can only be changed from a signed-in session.",
            },
        )

    user = (
        await db_session.execute(select(User).where(User.id == current_user.id))
    ).scalars().first()
    if user is None:  # pragma: no cover - defensive: authenticated principal always resolves
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    return user


def _verify_password_if_set(user: User, password: Optional[str]) -> None:
    """Re-authenticate before a security-sensitive change.

    Users provisioned purely through Google/SSO have no local password; for them
    possession of the session is the only credential available, so the check is
    skipped rather than making the feature unreachable.
    """
    if not user.password:
        return
    if not password or not security_verify_password(password, user.password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "INVALID_PASSWORD", "message": "Incorrect password."},
        )


def _check_mfa_rate_limit(request: Request, scope: str, identifier: str) -> None:
    """Throttle code submission. Keyed on both the account and the source IP so
    neither a single account nor a single host can be used to grind codes."""
    for key in (f"mfa:{scope}:{identifier}", f"mfa:{scope}:ip:{get_client_ip(request)}"):
        is_allowed, _count, retry_after = check_rate_limit(
            key=key, max_attempts=10, window_seconds=5 * 60
        )
        if not is_allowed:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail={
                    "code": "RATE_LIMITED",
                    "message": "Too many attempts. Please wait before trying again.",
                    "retry_after": retry_after,
                },
            )


### 🔒 Status ##############################################################


@router.get(
    "/mfa/status",
    summary="Get the caller's two-factor status",
    tags=["auth"],
)
async def api_mfa_status(
    db_session: AsyncSession = Depends(get_db_session),
    current_user=Depends(get_authenticated_user),
):
    user = await _require_human_user(current_user, db_session)
    mfa = await get_user_mfa(db_session, user.id)
    enabled = mfa is not None and mfa.confirmed_at is not None
    return {
        "enabled": enabled,
        "confirmed_at": mfa.confirmed_at if mfa else None,
        "backup_codes_remaining": (
            await count_unused_backup_codes(db_session, user.id) if enabled else 0
        ),
        "has_password": bool(user.password),
    }


### 🔒 Enrollment ##############################################################


@router.post(
    "/mfa/setup",
    summary="Begin two-factor enrollment",
    description=(
        "Generate a TOTP secret and return the `otpauth://` provisioning URI. "
        "The factor is NOT active until confirmed with a valid code."
    ),
    tags=["auth"],
    responses={
        401: {"description": "Incorrect password"},
        409: {"description": "Two-factor is already enabled"},
    },
)
async def api_mfa_setup(
    form: MFASetupRequest,
    db_session: AsyncSession = Depends(get_db_session),
    current_user=Depends(get_authenticated_user),
):
    user = await _require_human_user(current_user, db_session)
    _verify_password_if_set(user, form.password)

    existing = await get_user_mfa(db_session, user.id)
    if existing is not None and existing.confirmed_at is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "MFA_ALREADY_ENABLED",
                "message": "Two-factor authentication is already enabled. Disable it first to re-enroll.",
            },
        )

    secret = generate_totp_secret()
    now = str(datetime.now())

    if existing is not None:
        # Restarting an abandoned enrollment — overwrite the unconfirmed secret
        # so the QR the user is looking at is the one we will verify against.
        existing.secret_encrypted = encrypt_secret(secret)
        existing.last_used_timestep = None
        existing.update_date = now
        db_session.add(existing)
    else:
        db_session.add(
            UserMFA(
                user_id=user.id,
                secret_encrypted=encrypt_secret(secret),
                creation_date=now,
                update_date=now,
            )
        )
    await db_session.commit()

    return {
        "secret": secret,
        "provisioning_uri": build_provisioning_uri(secret, user.email),
    }


@router.post(
    "/mfa/confirm",
    summary="Confirm and activate two-factor enrollment",
    description="Verify a code from the authenticator app, activate the factor, and return single-use backup codes. The codes are shown exactly once.",
    tags=["auth"],
    responses={
        400: {"description": "No enrollment in progress, or invalid code"},
        429: {"description": "Too many attempts"},
    },
)
async def api_mfa_confirm(
    request: Request,
    form: MFACodeRequest,
    db_session: AsyncSession = Depends(get_db_session),
    current_user=Depends(get_authenticated_user),
):
    user = await _require_human_user(current_user, db_session)
    _check_mfa_rate_limit(request, "confirm", str(user.id))

    mfa = await get_user_mfa(db_session, user.id)
    if mfa is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "NO_ENROLLMENT", "message": "Start enrollment before confirming."},
        )
    if mfa.confirmed_at is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "MFA_ALREADY_ENABLED", "message": "Two-factor is already enabled."},
        )

    secret = decrypt_secret(mfa.secret_encrypted)
    if secret is None:  # pragma: no cover - defensive: only a rotated encryption key hits this
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"code": "MFA_SECRET_UNREADABLE", "message": "Could not read the enrollment secret. Please restart setup."},
        )

    # Burn the timestep atomically before activating, so the very code used to
    # confirm cannot then be replayed at /auth/login/mfa within its window.
    consumed = await verify_and_consume_totp(
        db_session, user.id, secret, form.code, mfa.last_used_timestep
    )
    if not consumed:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "code": "INVALID_CODE",
                "message": "That code isn't right. Check your device's clock is set automatically, then try the next code.",
            },
        )

    now = str(datetime.now())
    mfa.confirmed_at = now
    mfa.update_date = now
    db_session.add(mfa)
    await db_session.commit()

    codes = await replace_backup_codes(db_session, user.id)
    return {"enabled": True, "backup_codes": codes}


@router.post(
    "/mfa/disable",
    summary="Disable two-factor authentication",
    description="Requires both the current password (when the account has one) and a valid code, so a hijacked session alone cannot strip the factor.",
    tags=["auth"],
    responses={400: {"description": "Invalid code"}, 401: {"description": "Incorrect password"}},
)
async def api_mfa_disable(
    request: Request,
    form: MFADisableRequest,
    db_session: AsyncSession = Depends(get_db_session),
    current_user=Depends(get_authenticated_user),
):
    user = await _require_human_user(current_user, db_session)
    _check_mfa_rate_limit(request, "disable", str(user.id))
    _verify_password_if_set(user, form.password)

    mfa = await get_user_mfa(db_session, user.id)
    if mfa is None or mfa.confirmed_at is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "MFA_NOT_ENABLED", "message": "Two-factor is not enabled."},
        )

    secret = decrypt_secret(mfa.secret_encrypted)
    # A backup code is accepted here too: someone who has lost their device
    # still needs a way to turn the factor off rather than being stuck with it.
    accepted = False
    if secret is not None:
        accepted, _ = verify_totp_code(secret, form.code, mfa.last_used_timestep)
    if not accepted:
        accepted = await consume_backup_code(db_session, user.id, form.code)
    if not accepted:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "INVALID_CODE", "message": "That code isn't right."},
        )

    await disable_mfa(db_session, user.id)
    return {"enabled": False}


@router.post(
    "/mfa/backup-codes/regenerate",
    summary="Regenerate backup codes",
    description="Invalidates all existing codes and returns a fresh batch, shown exactly once.",
    tags=["auth"],
)
async def api_mfa_regenerate_backup_codes(
    request: Request,
    form: MFACodeRequest,
    db_session: AsyncSession = Depends(get_db_session),
    current_user=Depends(get_authenticated_user),
):
    user = await _require_human_user(current_user, db_session)
    _check_mfa_rate_limit(request, "regen", str(user.id))

    mfa = await get_user_mfa(db_session, user.id)
    if mfa is None or mfa.confirmed_at is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "MFA_NOT_ENABLED", "message": "Two-factor is not enabled."},
        )

    secret = decrypt_secret(mfa.secret_encrypted)
    is_valid = False
    if secret is not None:
        is_valid = await verify_and_consume_totp(
            db_session, user.id, secret, form.code, mfa.last_used_timestep
        )
    if not is_valid:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "INVALID_CODE", "message": "That code isn't right."},
        )

    codes = await replace_backup_codes(db_session, user.id)
    return {"backup_codes": codes}


### 🔒 Login challenge ##############################################################


@router.post(
    "/login/mfa",
    summary="Complete login with a second factor",
    description=(
        "Exchange the short-lived `mfa_token` returned by `/auth/login` plus a "
        "TOTP or backup code for a real session."
    ),
    tags=["auth"],
    responses={
        401: {"description": "Expired or invalid pending token, or invalid code"},
        429: {"description": "Too many attempts"},
    },
)
async def api_login_mfa(
    request: Request,
    response: Response,
    form: MFALoginRequest,
    db_session: AsyncSession = Depends(get_db_session),
):
    email = decode_mfa_pending_token(form.mfa_token)
    if not email:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={
                "code": "MFA_SESSION_EXPIRED",
                "message": "That took too long — please sign in again.",
            },
        )

    _check_mfa_rate_limit(request, "login", email)

    # Provenance (how the user authenticated, which org for) was stamped into the
    # pending token at the password/magic-link/SSO step; carry it into the real
    # session so the org auth-method / sharing policy sees the true method.
    pending_amr, pending_org_id = decode_mfa_pending_provenance(form.mfa_token)

    user = (
        await db_session.execute(select(User).where(User.email == email))
    ).scalars().first()
    if user is None:  # pragma: no cover - defensive: pending token only issued for a real user
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "MFA_SESSION_EXPIRED", "message": "Please sign in again."},
        )

    mfa = await get_user_mfa(db_session, user.id)
    if mfa is None or mfa.confirmed_at is None:
        # The factor was removed between password step and code step. Nothing
        # left to verify, so fall through to a normal session rather than
        # stranding the user at a challenge they can never satisfy.
        result = mint_session_tokens(user.email, pending_amr, pending_org_id)
    else:
        accepted = False
        if form.is_backup_code:
            accepted = await consume_backup_code(db_session, user.id, form.code)
        else:
            secret = decrypt_secret(mfa.secret_encrypted)
            if secret is not None:
                accepted = await verify_and_consume_totp(
                    db_session, user.id, secret, form.code, mfa.last_used_timestep
                )
            if not accepted:
                # Let a backup code through even if the user didn't tick the
                # box — they are unambiguously distinguishable from 6 digits.
                accepted = await consume_backup_code(db_session, user.id, form.code)

        if not accepted:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail={
                    "code": "INVALID_CODE",
                    "message": "That code isn't right. Check your device's clock is set automatically, then try the next code.",
                },
            )

        result = mint_session_tokens(user.email, pending_amr, pending_org_id)

    set_auth_cookies(response, result.access_token, result.refresh_token, request)

    return {
        "user": UserRead.model_validate(user),
        "tokens": {
            "access_token": result.access_token,
            "refresh_token": result.refresh_token,
            "expiry": get_token_expiry_ms(),
        },
        "backup_codes_remaining": await count_unused_backup_codes(db_session, user.id),
    }


### 🔒 Org-wide policy ##############################################################


class OrgMFAPolicyUpdate(BaseModel):
    """Partial update — every field is optional and an omitted one is left as-is.

    The dashboard splits this policy across two tabs (two-factor / sign-in
    methods); each must be able to save its own fields without resetting the
    other tab's to their defaults.
    """

    require_2fa: Optional[bool] = None
    require_2fa_grace_days: Optional[int] = None
    exempt_external_auth: Optional[bool] = None
    allowed_auth_methods: Optional[list[str]] = None
    allow_central_session_sharing: Optional[bool] = None


@router.get(
    "/mfa/org-policy/{org_id}",
    summary="Get the caller's two-factor compliance state for an org",
    description=(
        "Drives the in-app banner and the blocking interstitial. `blocking` is "
        "true only once the grace deadline has passed without enrollment."
    ),
    tags=["auth"],
)
async def api_org_mfa_compliance(
    org_id: int,
    db_session: AsyncSession = Depends(get_db_session),
    current_user=Depends(get_authenticated_user),
):
    user = await _require_human_user(current_user, db_session)

    # The org's auth-method / session-sharing policy is enforced per request all
    # over the API, but this endpoint is the one the dashboard polls to decide
    # what to tell the user. Evaluating it here is what turns a scattering of
    # 403s into the single "sign in to this org again" screen — without it the
    # restriction is enforced but never explained, which reads as "the setting
    # does nothing unless two-factor is also on".
    block = await evaluate_org_auth(db_session, user.id, org_id)
    if block is not None:
        raise auth_policy_exception(block)

    state = await evaluate_mfa_compliance(db_session, user, org_id)
    return state.to_dict()


@router.get(
    "/mfa/org-policy/{org_id}/settings",
    summary="Get the org's saved security policy",
    description=(
        "Admin/maintainer only. Returns the policy exactly as stored, read "
        "straight from the database. The settings UI reads it from here rather "
        "than from the cached organization payload, so a save is never followed "
        "by the previous values reappearing."
    ),
    tags=["auth"],
    responses={403: {"description": "Not an org admin"}},
)
async def api_get_org_security_policy(
    org_id: int,
    db_session: AsyncSession = Depends(get_db_session),
    current_user=Depends(get_authenticated_user),
):
    user = await _require_human_user(current_user, db_session)

    if not await is_org_admin(user.id, org_id, db_session):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"code": "NOT_ORG_ADMIN", "message": "Only org admins can view this setting."},
        )

    return await _org_security_policy_payload(db_session, org_id)


async def _org_security_policy_payload(db_session: AsyncSession, org_id: int) -> dict:
    """The saved policy, in the one shape both the GET and the PUT answer with."""
    from src.services.orgs.auth_policy import get_org_auth_policy

    policy = await get_org_mfa_policy(db_session, org_id)
    auth_policy = await get_org_auth_policy(db_session, org_id)
    return {
        "require_2fa": policy.require_2fa,
        "require_2fa_grace_days": policy.grace_days,
        "require_2fa_enabled_at": policy.enabled_at,
        "exempt_external_auth": policy.exempt_external_auth,
        "allowed_auth_methods": auth_policy.allowed_auth_methods,
        "allow_central_session_sharing": auth_policy.allow_central_session_sharing,
    }


@router.put(
    "/mfa/org-policy/{org_id}",
    summary="Set the org-wide two-factor requirement",
    description=(
        "Admin/maintainer only. Enabling the policy requires the calling admin "
        "to already have two-factor enabled themselves."
    ),
    tags=["auth"],
    responses={
        403: {"description": "Not an org admin, or admin has not enrolled themselves"},
    },
)
async def api_set_org_mfa_policy(
    org_id: int,
    form: OrgMFAPolicyUpdate,
    db_session: AsyncSession = Depends(get_db_session),
    current_user=Depends(get_authenticated_user),
):
    user = await _require_human_user(current_user, db_session)

    if not await is_org_admin(user.id, org_id, db_session):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"code": "NOT_ORG_ADMIN", "message": "Only org admins can change this setting."},
        )

    # Self-lockout guard. With grace_days=0 an admin without a second factor
    # would be blocked from their own org the instant this saves — and there
    # would be no admin left able to turn it back off.
    if form.require_2fa:
        mfa = await get_user_mfa(db_session, user.id)
        if mfa is None or mfa.confirmed_at is None:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={
                    "code": "ADMIN_MFA_REQUIRED_FIRST",
                    "message": "Enable two-factor on your own account before requiring it for the organization.",
                },
            )

    row = (
        await db_session.execute(
            select(OrganizationConfig).where(OrganizationConfig.org_id == org_id)
        )
    ).scalars().first()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Organization config not found")

    config = dict(row.config or {})
    toggles = dict(config.get("admin_toggles") or {})
    security = dict(toggles.get("security") or {})

    was_enabled = bool(security.get("require_2fa", False))

    if form.require_2fa_grace_days is not None:
        security["require_2fa_grace_days"] = max(0, form.require_2fa_grace_days)
    if form.exempt_external_auth is not None:
        security["exempt_external_auth"] = form.exempt_external_auth
    if form.require_2fa is not None:
        security["require_2fa"] = form.require_2fa
        # Only re-anchor when switching off→on. Re-saving an already-active policy
        # (e.g. to tweak the grace length) must not silently restart everyone's
        # countdown.
        if form.require_2fa and not was_enabled:
            security["require_2fa_enabled_at"] = datetime.now().isoformat()
        elif not form.require_2fa:
            security["require_2fa_enabled_at"] = None

    # Auth-method / session-sharing policy, with self-lockout guards so an admin
    # cannot save a policy that would refuse their own current session.
    from src.security.session_context import POLICY_AUTH_METHODS, get_session_provenance
    from src.security.superadmin import is_user_superadmin

    is_super = await is_user_superadmin(user.id, db_session)
    provenance = get_session_provenance()

    if form.allowed_auth_methods is not None:
        methods = [m for m in form.allowed_auth_methods if m in POLICY_AUTH_METHODS]
        restrictive = bool(methods) and not set(POLICY_AUTH_METHODS).issubset(methods)
        # A session with no recorded method is refused by the gate exactly like a
        # disallowed one, so it has to trip this guard too. Sessions minted before
        # the policy shipped carry no `amr`, and a refresh copies the missing
        # claim forward — so without this the admin saves, is locked out on the
        # next request, and no re-login prompt can be reached from inside.
        unknown_method = provenance is None or provenance.amr is None
        if (
            restrictive
            and not is_super
            and (unknown_method or provenance.amr not in methods)
            and (unknown_method or provenance.amr in POLICY_AUTH_METHODS)
        ):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={
                    "code": "AUTH_METHOD_SELF_LOCKOUT",
                    "message": (
                        "That would lock you out — this session isn't signed in with one of "
                        "the methods you're allowing. Sign in to this organization again with "
                        "an allowed method, then save."
                    ),
                },
            )
        security["allowed_auth_methods"] = methods

    if form.allow_central_session_sharing is not None:
        if (
            form.allow_central_session_sharing is False
            and not is_super
            and (provenance is None or provenance.org_id != org_id)
        ):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={
                    "code": "SESSION_SHARING_SELF_LOCKOUT",
                    "message": "Sign in from this organization's own login page before turning off session sharing, otherwise your current session would be locked out.",
                },
            )
        security["allow_central_session_sharing"] = form.allow_central_session_sharing

    toggles["security"] = security
    config["admin_toggles"] = toggles
    row.config = config
    # SQLAlchemy does not track in-place mutation of a JSON column; without an
    # explicit flag the reassignment above can be dropped on commit.
    flag_modified(row, "config")
    row.update_date = str(datetime.now())
    db_session.add(row)
    await db_session.commit()

    return await _org_security_policy_payload(db_session, org_id)


@router.get(
    "/mfa/org-compliance/{org_id}",
    summary="List members and whether they have two-factor enabled",
    description=(
        "Admin/maintainer only. Intended to be checked BEFORE switching the "
        "policy on — enabling it blind is how an org locks out its own staff."
    ),
    tags=["auth"],
)
async def api_org_mfa_compliance_list(
    org_id: int,
    db_session: AsyncSession = Depends(get_db_session),
    current_user=Depends(get_authenticated_user),
):
    user = await _require_human_user(current_user, db_session)

    if not await is_org_admin(user.id, org_id, db_session):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"code": "NOT_ORG_ADMIN", "message": "Only org admins can view this."},
        )

    rows = (
        await db_session.execute(
            select(User, UserMFA)
            .join(UserOrganization, UserOrganization.user_id == User.id)
            .join(UserMFA, UserMFA.user_id == User.id, isouter=True)
            .where(UserOrganization.org_id == org_id)
        )
    ).all()

    members = []
    enabled_count = 0
    for member, mfa in rows:
        is_enabled = mfa is not None and mfa.confirmed_at is not None
        if is_enabled:
            enabled_count += 1
        members.append(
            {
                "user_id": member.id,
                "email": member.email,
                "username": member.username,
                "first_name": member.first_name,
                "last_name": member.last_name,
                "signup_method": member.signup_method,
                "mfa_enabled": is_enabled,
                "confirmed_at": mfa.confirmed_at if mfa else None,
            }
        )

    members.sort(key=lambda m: (m["mfa_enabled"], (m["email"] or "").lower()))

    return {
        "total": len(members),
        "enabled": enabled_count,
        "members": members,
    }


@router.post(
    "/mfa/org-reset/{org_id}/{user_id}",
    summary="Reset (clear) a member's two-factor factor",
    description=(
        "Admin/maintainer recovery tool. Removes a member's TOTP factor and all "
        "their backup codes so they can re-enroll — the supported path for a "
        "member who lost their device with no backup codes left. Does not enroll "
        "anything on their behalf; if the org requires 2FA the member re-enters "
        "their grace window and must set it up again."
    ),
    tags=["auth"],
    responses={
        403: {"description": "Not an org admin, or target is a platform superadmin"},
        404: {"description": "Target user is not a member of this org"},
        400: {"description": "Cannot reset your own factor here — use /mfa/disable"},
    },
)
async def api_org_reset_member_mfa(
    org_id: int,
    user_id: int,
    db_session: AsyncSession = Depends(get_db_session),
    current_user=Depends(get_authenticated_user),
):
    from src.security.org_auth import get_user_org
    from src.security.superadmin import is_user_superadmin
    from src.services.auth.mfa import disable_mfa

    admin = await _require_human_user(current_user, db_session)

    if not await is_org_admin(admin.id, org_id, db_session):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"code": "NOT_ORG_ADMIN", "message": "Only org admins can reset a member's two-factor."},
        )

    # Self-service disable is code-gated on purpose (a hijacked admin session must
    # not be able to strip the owner's own factor); route the admin's own account
    # through that flow instead of this unguarded admin tool.
    if user_id == admin.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "CANNOT_RESET_SELF", "message": "Use the disable flow (with a code) to reset your own two-factor."},
        )

    if await get_user_org(user_id, org_id, db_session) is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "NOT_A_MEMBER", "message": "That user is not a member of this organization."},
        )

    # An org admin must not be able to clear a platform superadmin's factor.
    if await is_user_superadmin(user_id, db_session) and not await is_user_superadmin(admin.id, db_session):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"code": "TARGET_IS_SUPERADMIN", "message": "You cannot reset this user's two-factor."},
        )

    had_factor = await get_user_mfa(db_session, user_id) is not None
    await disable_mfa(db_session, user_id)
    return {"reset": True, "user_id": user_id, "had_factor": had_factor}
