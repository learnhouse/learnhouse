"""PSP <-> LearnHouse token-exchange platform endpoints.

  POST /api/v1/psp/token-exchange  (called by psp-module)
      Authorization: Bearer <shell JWT>  ->  { code, learnhouse_url }

  GET  /api/auth/exchange-code?code=     (called by LH Next.js route)
      -> { access_token, refresh_token }   (single-use)
"""

import json
import logging
import os
import random
import secrets
from uuid import uuid4

from fastapi import APIRouter, Header, HTTPException, Query, Request
from sqlalchemy.exc import IntegrityError

from src.core.redis import get_redis_client
from src.security.auth import create_access_token, create_refresh_token
from src.services.auth.psp_jwks import ShellTokenError, validate_shell_token

logger = logging.getLogger(__name__)

CODE_TTL_SECONDS = 60
CODE_PREFIX = "psp_code:"

psp_router = APIRouter(tags=["psp"])
platform_router = APIRouter(tags=["psp-platform"])


async def _unique_username(session, email: str) -> str:
    """Derive a username from `email` that no existing user holds.

    The base (email local-part) plus a random 4-digit suffix gives 9000
    candidates; we still verify against the DB so a collision raises nothing
    silently. A concurrent insert that beats us is caught by the IntegrityError
    handler in `_ensure_lh_user`.
    """
    from sqlalchemy import select

    from src.db.users import User

    base = email.split("@")[0] or "user"
    for _ in range(5):
        candidate = f"{base}{random.randint(1000, 9999)}"
        taken = (
            await session.execute(select(User).where(User.username == candidate))
        ).scalars().first()
        if not taken:
            return candidate
    # Astronomically unlikely fall-through: guarantee uniqueness with uuid entropy.
    return f"{base}_{uuid4().hex[:8]}"


async def _provision_psp_user(request, session, email: str, org_id: int) -> None:
    """Create an SSO/PSP-provisioned LearnHouse user in `org_id`.

    Routes through the canonical `create_user` service (the same path the Google
    SSO flow uses) so the user gets the UserOrganization membership + role + a
    `signup_method`, not just a bare User row. Empty password (SSO-only) and
    `is_oauth=True` mark the email pre-verified.
    """
    from src.db.users import AnonymousUser, UserCreate
    from src.services.users.users import create_user

    username = await _unique_username(session, email)
    user_object = UserCreate(email=email, username=username, password="")
    await create_user(
        request,
        session,
        AnonymousUser(),
        user_object,
        org_id,
        is_oauth=True,
        signup_provider="psp",
    )


async def _ensure_lh_user(request, email: str) -> None:
    """Find-or-create the LearnHouse user for `email`. Async (DB is async-only).
    Thin seam so endpoint tests can stub it."""
    from sqlalchemy import select

    from src.core.events.database import _async_session_factory
    from src.db.users import User

    org_id = int(os.getenv("ENABLEMENT_ORG_ID", "1"))
    normalized = email.strip().lower()
    async with _async_session_factory() as session:
        existing = (
            await session.execute(select(User).where(User.email == normalized))
        ).scalars().first()
        if existing:
            return
        try:
            await _provision_psp_user(request, session, normalized, org_id)
        except IntegrityError:
            # Concurrent first-login race: another request provisioned this same
            # email between our existence check and commit. The unique constraint
            # did its job — treat as already-provisioned (idempotent success).
            await session.rollback()
            logger.info("psp: user %s provisioned concurrently; treating as exists", normalized)


@psp_router.post("/token-exchange")
async def token_exchange(request: Request, authorization: str = Header(default="")):
    token = authorization[7:] if authorization.lower().startswith("bearer ") else ""
    try:
        email = validate_shell_token(token)
    except ShellTokenError as err:
        raise HTTPException(status_code=401, detail=str(err))

    await _ensure_lh_user(request, email)

    access_token = create_access_token(data={"sub": email})
    refresh_token = create_refresh_token(data={"sub": email})

    code = secrets.token_urlsafe(32)
    redis = get_redis_client()
    if redis is None:
        raise HTTPException(status_code=503, detail="session store unavailable")
    redis.setex(
        f"{CODE_PREFIX}{code}",
        CODE_TTL_SECONDS,
        json.dumps({"access_token": access_token, "refresh_token": refresh_token}),
    )

    learnhouse_url = os.getenv("NEXT_PUBLIC_LEARNHOUSE_URL", "").rstrip("/")
    return {"code": code, "learnhouse_url": learnhouse_url}


@platform_router.get("/api/auth/exchange-code")
async def exchange_code(code: str = Query(...)):
    redis = get_redis_client()
    if redis is None:
        raise HTTPException(status_code=503, detail="session store unavailable")
    raw = redis.getdel(f"{CODE_PREFIX}{code}")
    if not raw:
        raise HTTPException(status_code=404, detail="code expired or already used")
    data = json.loads(raw)
    return {"access_token": data["access_token"], "refresh_token": data["refresh_token"]}
