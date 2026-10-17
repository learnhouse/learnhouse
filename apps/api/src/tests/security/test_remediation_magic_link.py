"""
F-06: admin magic-link tokens are single-use, durably.

Redeeming a link records its jti in ``used_link_token``. A replay is refused,
and no failure of a cache (or of the record itself) can let a link work twice.
"""

from datetime import timedelta
from unittest.mock import patch

import pytest
from fastapi import HTTPException
from sqlmodel import select

from src.db.used_link_tokens import UsedLinkToken
from src.security.auth import create_access_token
from src.services.admin.admin import consume_magic_link_token


def _link(email: str, org_id: int, **overrides) -> str:
    payload = {
        "sub": email,
        "purpose": "magic_link",
        "org_id": org_id,
        "redirect_to": "/dashboard",
        "jti": "one-shot-jti",
    }
    payload.update(overrides)
    payload = {k: v for k, v in payload.items() if v is not None}
    return create_access_token(data=payload, expires_delta=timedelta(minutes=5))


@pytest.mark.asyncio
async def test_magic_link_single_use_blocks_replay(db, org, regular_user):
    token = _link(regular_user.email, org.id)

    _, access, refresh, redirect_to, mfa_token = await consume_magic_link_token(token, db)
    assert access and refresh and mfa_token is None
    assert redirect_to == "/dashboard"

    with pytest.raises(HTTPException) as exc:
        await consume_magic_link_token(token, db)
    assert exc.value.status_code == 410


@pytest.mark.asyncio
async def test_use_is_recorded_in_the_database_not_a_cache(db, org, regular_user):
    # The record that refuses a replay is a row, so flushing or losing Redis
    # cannot bring an old link back.
    await consume_magic_link_token(_link(regular_user.email, org.id), db)
    rows = (await db.execute(select(UsedLinkToken))).scalars().all()
    assert [(r.jti, r.purpose) for r in rows] == [("one-shot-jti", "magic_link")]


@pytest.mark.asyncio
async def test_link_refused_when_the_use_cannot_be_recorded(db, org, regular_user):
    # Fail closed: if the use cannot be written, no session is minted.
    token = _link(regular_user.email, org.id)
    with patch.object(db, "commit", side_effect=RuntimeError("db down")):
        with pytest.raises(HTTPException) as exc:
            await consume_magic_link_token(token, db)
    assert exc.value.status_code == 503


@pytest.mark.asyncio
async def test_link_without_jti_is_refused(db, org, regular_user):
    with pytest.raises(HTTPException) as exc:
        await consume_magic_link_token(_link(regular_user.email, org.id, jti=None), db)
    assert exc.value.status_code == 410


@pytest.mark.asyncio
async def test_expired_link_is_refused(db, org, regular_user):
    token = create_access_token(
        data={
            "sub": regular_user.email,
            "purpose": "magic_link",
            "org_id": org.id,
            "jti": "late-jti",
        },
        expires_delta=timedelta(seconds=-1),
    )
    with pytest.raises(HTTPException) as exc:
        await consume_magic_link_token(token, db)
    assert exc.value.status_code == 401
    # A rejected link is not recorded, so it never reaches the use check.
    assert (await db.execute(select(UsedLinkToken))).scalars().first() is None


@pytest.mark.asyncio
async def test_expired_records_are_pruned(db, org, regular_user):
    db.add(UsedLinkToken(jti="ancient", purpose="magic_link", expires_at=1))
    await db.commit()

    # Pruning runs on a sample of redemptions; force this one.
    with patch("src.services.auth.link_tokens.secrets.randbelow", return_value=0):
        await consume_magic_link_token(_link(regular_user.email, org.id), db)

    jtis = {r.jti for r in (await db.execute(select(UsedLinkToken))).scalars().all()}
    assert jtis == {"one-shot-jti"}
