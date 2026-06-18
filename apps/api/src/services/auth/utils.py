import logging
import os
import random
from datetime import datetime, timezone
from typing import Optional
from fastapi import Depends, HTTPException, Request
import httpx
from sqlmodel import select, func
from sqlmodel.ext.asyncio.session import AsyncSession
from src.core.events.database import get_db_session
from src.db.users import User, UserCreate, UserRead
from src.security.auth import get_current_user
from src.services.users.users import create_user, create_user_without_org
from src.services.security.rate_limiting import get_client_ip
from src.services.security.account_lockout import update_login_info


logger = logging.getLogger(__name__)

# Emit the "audience not configured" warning at most once per process to
# avoid flooding logs on every login attempt.
_LOGGED_MISSING_GOOGLE_CLIENT_ID = False


async def _verify_google_token_audience(access_token: str) -> None:
    """
    Verify that ``access_token`` was minted for our Google OAuth client.

    Google's userinfo endpoint returns the account's email for any valid
    access token regardless of audience (``aud``/client_id). Without an
    explicit audience check, an access token obtained by a different OAuth
    app (e.g. one the victim authorized for an attacker-hosted site) could
    be replayed against ``/auth/oauth`` to impersonate the victim. Calling
    the tokeninfo endpoint first and comparing ``aud`` to our registered
    client_id closes that confused-deputy window.

    If ``LEARNHOUSE_GOOGLE_OAUTH_CLIENT_ID`` is not set we log a one-shot
    warning and fall through so existing deployments keep working, but
    operators should set it in production.
    """
    global _LOGGED_MISSING_GOOGLE_CLIENT_ID

    expected_client_id = os.environ.get("LEARNHOUSE_GOOGLE_OAUTH_CLIENT_ID")
    if not expected_client_id:
        if not _LOGGED_MISSING_GOOGLE_CLIENT_ID:
            logger.warning(
                "LEARNHOUSE_GOOGLE_OAUTH_CLIENT_ID is not set — Google OAuth "
                "audience verification is DISABLED. Set this env var to your "
                "Google OAuth client_id to block confused-deputy token reuse."
            )
            _LOGGED_MISSING_GOOGLE_CLIENT_ID = True
        return

    async with httpx.AsyncClient(timeout=5) as client:
        r = await client.get(
            "https://oauth2.googleapis.com/tokeninfo",
            params={"access_token": access_token},
        )
    if r.status_code != 200:
        raise HTTPException(
            status_code=401,
            detail="Google token could not be validated",
        )
    body = r.json()
    aud = body.get("aud") or body.get("azp")
    if aud != expected_client_id:
        # Do not echo the presented aud — it could leak which third-party
        # app the attacker tried to reuse.
        logger.warning(
            "Google OAuth audience mismatch: token aud did not match our client_id"
        )
        raise HTTPException(
            status_code=401,
            detail="Google token was not issued for this application",
        )


async def get_google_user_info(access_token: str):
    # Validate audience before trusting userinfo (confused-deputy guard).
    await _verify_google_token_audience(access_token)

    url = "https://www.googleapis.com/oauth2/v3/userinfo"
    headers = {"Authorization": f"Bearer {access_token}"}
    async with httpx.AsyncClient() as client:
        response = await client.get(url, headers=headers)

    if response.status_code != 200:
        raise HTTPException(
            status_code=response.status_code,
            detail="Failed to fetch user info from Google",
        )

    return response.json()


async def signWithGoogle(
    request: Request,
    access_token: str,
    email: str,
    org_id: Optional[int] = None,
    current_user=Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
):
    # Google
    google_user = await get_google_user_info(access_token)

    # SECURITY: trust only the email Google returns *and* explicitly marks as
    # verified. Previously this fell back to the body-supplied ``email`` when
    # Google omitted it (which happens whenever the access token was minted
    # without the ``email`` scope), letting an attacker with any valid Google
    # token impersonate any LearnHouse user whose address they knew. The body
    # ``email`` field is kept in the request schema for backward compatibility
    # but is no longer used for identity resolution.
    google_email = google_user.get("email")
    google_email_verified = google_user.get("email_verified")
    # SECURITY: Google's userinfo/tokeninfo endpoints sometimes serialise
    # ``email_verified`` as the JSON *string* ``"true"``/``"false"`` (notably
    # the v1/v2 userinfo and some Workspace federated accounts) rather than a
    # native boolean. A plain truthiness test (``not google_email_verified``)
    # treats the string ``"false"`` as verified, which would let an attacker
    # who controls an *unverified* Google account matching a victim's address
    # take over the LearnHouse account. Accept only an explicit boolean ``True``
    # or the string ``"true"`` (case-insensitive).
    if isinstance(google_email_verified, str):
        email_is_verified = google_email_verified.strip().lower() == "true"
    else:
        email_is_verified = google_email_verified is True
    if not google_email or not email_is_verified:
        raise HTTPException(
            status_code=401,
            detail="Google did not return a verified email for this account",
        )
    # Normalise to lower-case to match the DB unique-ish invariant on email.
    user_email = google_email.strip().lower()

    # Match existing accounts case-insensitively. Local email/password signups
    # store the email exactly as submitted (no lower-casing), so an account
    # registered as "Victim@Gmail.com" would NOT be matched by an exact compare
    # against the lower-cased Google address. That mismatch would silently
    # create a duplicate account (or raise on a case-insensitive unique index),
    # stranding the user in an empty second account or breaking OAuth login.
    user = (await db_session.execute(
        select(User).where(func.lower(User.email) == user_email)
    )).scalars().first()

    if not user:
        # Extract user data with safe defaults
        given_name = google_user.get("given_name", "")
        family_name = google_user.get("family_name", "")
        picture = google_user.get("picture", "")

        # Generate username more robustly
        username_parts = []
        if given_name:
            username_parts.append(given_name)
        if family_name:
            username_parts.append(family_name)

        # If no name parts available, use part of email
        if not username_parts and user_email and "@" in user_email:
            email_prefix = user_email.split("@")[0]
            if email_prefix:  # Make sure it's not empty
                username_parts.append(email_prefix)

        # If still no parts, use a default
        if not username_parts:
            username_parts.append("user")

        # Use a wide random suffix to make username collisions vanishingly
        # unlikely. The previous 2-digit suffix (only 90 possible values) made
        # collisions probable for common names/email prefixes; a collision
        # bubbles up from create_user[_without_org] as a 400 "already in use",
        # which permanently blocks an otherwise-new Google account from signing
        # up because the conflict is on the generated username, not the email.
        username = "".join(username_parts) + str(random.randint(100000, 999999))

        user_object = UserCreate(
            email=user_email,
            username=username,
            password="",
            first_name=given_name,
            last_name=family_name,
            avatar_image=picture,
        )

        if org_id is not None:
            user = await create_user(
                request, db_session, current_user, user_object, org_id, is_oauth=True, signup_provider="google"
            )

            return user
        else:
            user = await create_user_without_org(
                request, db_session, current_user, user_object, is_oauth=True, signup_provider="google"
            )

            return user

    # For existing users, ensure email is verified (Google already verified it)
    needs_update = False
    if not user.email_verified:
        user.email_verified = True
        user.email_verified_at = datetime.now(timezone.utc).isoformat()
        needs_update = True

    # Backfill signup_method for existing users who sign in with Google
    if not user.signup_method:
        user.signup_method = "google"
        needs_update = True

    if needs_update:
        db_session.add(user)
        await db_session.commit()
        await db_session.refresh(user)

    # If the caller supplied (and the router validated, via a pending invite)
    # an ``org_id``, an *existing* user signing in with Google must still be
    # added to that organization. The new-user branch above does this through
    # ``create_user``; previously the existing-user branch dropped ``org_id``
    # entirely, so a person who already had a LearnHouse account and accepted
    # an org invite via Google was authenticated but never actually joined the
    # org. We mirror create_user's behaviour: enforce the member quota, avoid
    # double-counting on repeat logins, then create the membership link.
    if org_id is not None and user.id is not None:
        from src.db.user_organizations import UserOrganization
        from src.security.features_utils.usage import (
            check_limits_with_usage,
            increase_feature_usage,
        )

        existing_membership = (await db_session.execute(
            select(UserOrganization).where(
                (UserOrganization.user_id == user.id)
                & (UserOrganization.org_id == org_id)
            )
        )).scalars().first()

        if not existing_membership:
            await check_limits_with_usage("members", org_id, db_session)
            user_organization = UserOrganization(
                user_id=user.id,
                org_id=org_id,
                role_id=4,
                creation_date=str(datetime.now()),
                update_date=str(datetime.now()),
            )
            db_session.add(user_organization)
            await db_session.commit()
            await db_session.refresh(user_organization)
            await increase_feature_usage("members", org_id, db_session)

    # Update last login info
    client_ip = get_client_ip(request)
    await update_login_info(user, client_ip, db_session)

    return UserRead.model_validate(user)
