"""
Regression tests for F-2: get_non_api_token_user silently admitted AnonymousUser.

The historical helper only rejected APITokenUser. Every router that used it
as the router-level dependency (e.g. /ai/*, /blocks/*, /trail/*, /analytics,
/code, /webhooks, /api-tokens, /roles, /ai_credits, /custom_domains,
/migration, /assignments, /usergroups, /utils, /boards/playground,
/playgrounds, /playgrounds_generator, /packs, /audit_logs) treated
unauthenticated callers as "authenticated-but-anonymous" and relied on each
handler to remember to reject them.

``get_authenticated_non_api_token_user`` is the new shared guard that:
    - returns the user if it's a PublicUser,
    - raises 401 if the caller is anonymous,
    - raises 403 if the caller is an API token.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException

from src.db.users import APITokenUser, AnonymousUser, PublicUser
from src.security.api_token_utils import get_authenticated_non_api_token_user


@pytest.fixture
def mock_request_and_db():
    request = SimpleNamespace(headers=SimpleNamespace(get=lambda *a, **k: ""), cookies={}, path_params={}, state=SimpleNamespace())
    db_session = SimpleNamespace()
    return request, db_session


@pytest.mark.asyncio
async def test_anonymous_is_rejected_with_401(mock_request_and_db):
    """Anonymous must be rejected at the dependency layer, not downstream."""
    request, db_session = mock_request_and_db
    with patch(
        "src.security.auth.get_authenticated_user",
        new=AsyncMock(side_effect=HTTPException(status_code=401, detail="Authentication required")),
    ):
        with pytest.raises(HTTPException) as exc_info:
            await get_authenticated_non_api_token_user(request, db_session)
        assert exc_info.value.status_code == 401


@pytest.mark.asyncio
async def test_api_token_user_is_rejected_with_403(mock_request_and_db):
    """API tokens are explicitly rejected with 403."""
    request, db_session = mock_request_and_db
    api_user = APITokenUser(
        id=1,
        user_uuid="apitoken_1",
        username="api_token_test",
        org_id=1,
        rights=None,
        token_name="t",
        created_by_user_id=99,
    )
    with patch(
        "src.security.auth.get_authenticated_user",
        new=AsyncMock(return_value=api_user),
    ):
        with pytest.raises(HTTPException) as exc_info:
            await get_authenticated_non_api_token_user(request, db_session)
        assert exc_info.value.status_code == 403


@pytest.mark.asyncio
async def test_authenticated_public_user_is_accepted(mock_request_and_db):
    """A real authenticated user passes through unchanged."""
    request, db_session = mock_request_and_db
    user = PublicUser(
        id=42,
        username="alice",
        first_name="Alice",
        last_name="Example",
        email="alice@example.com",
        user_uuid="user_alice",
    )
    with patch(
        "src.security.auth.get_authenticated_user",
        new=AsyncMock(return_value=user),
    ):
        result = await get_authenticated_non_api_token_user(request, db_session)
        assert result is user


@pytest.mark.asyncio
async def test_old_dependency_still_admits_anonymous():
    """Regression sanity check: the legacy helper still admits anonymous.

    This confirms we did not change the legacy path — routers with
    intentionally-public endpoints (e.g. /users, /orgs, /courses) keep the
    legacy behaviour so their public routes continue to work.
    """
    from src.security.api_token_utils import require_non_api_token_user

    anon = AnonymousUser()
    result = await require_non_api_token_user(anon)
    assert isinstance(result, AnonymousUser)
