"""PSP <-> LearnHouse token-exchange platform endpoints.

  POST /api/v1/psp/token-exchange  (called by psp-module)
      Authorization: Bearer <shell JWT>  ->  { code, learnhouse_url }

  GET  /api/auth/exchange-code?code=     (called by LH Next.js route)
      -> { access_token, refresh_token }   (single-use)
"""

import json
import os
import random
import secrets
from uuid import uuid4

from fastapi import APIRouter, Header, HTTPException, Query

from src.core.redis import get_redis_client
from src.security.auth import create_access_token, create_refresh_token
from src.services.auth.psp_jwks import ShellTokenError, validate_shell_token

CODE_TTL_SECONDS = 60
CODE_PREFIX = "psp_code:"

psp_router = APIRouter(tags=["psp"])
platform_router = APIRouter(tags=["psp-platform"])


async def _provision_psp_user(session, email: str, org_id: int) -> None:
    """Create an SSO/PSP-provisioned LearnHouse user on `session`.

    Empty password (SSO-only), email pre-verified - mirrors the Google SSO
    provisioning in src/services/auth/utils.py.
    """
    from src.db.users import User

    username = email.split("@")[0] + str(random.randint(10, 99))
    session.add(
        User(
            email=email,
            username=username,
            password="",
            user_uuid=f"user_{uuid4()}",
            email_verified=True,
        )
    )
    await session.commit()


async def _ensure_lh_user(email: str) -> None:
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
        await _provision_psp_user(session, normalized, org_id)


@psp_router.post("/token-exchange")
async def token_exchange(authorization: str = Header(default="")):
    token = authorization[7:] if authorization.lower().startswith("bearer ") else ""
    try:
        email = validate_shell_token(token)
    except ShellTokenError as err:
        raise HTTPException(status_code=401, detail=str(err))

    await _ensure_lh_user(email)

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
