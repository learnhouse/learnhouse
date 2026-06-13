"""Tests for the third_party_login OAuth handler in src/routers/auth.py.

Targets the `else: raise HTTPException(...)` branch (line ~497) that rejects any
provider other than the supported ones (currently only "google").
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException, Response, status

from src.db.users import AnonymousUser
from src.routers.auth import third_party_login


@pytest.mark.asyncio
async def test_third_party_login_rejects_unsupported_provider():
    # provider != "google" with org_id=None skips the org-validation block and
    # falls straight through to the unsupported-provider `else: raise`.
    body = SimpleNamespace(
        email="user@example.com",
        provider="facebook",
        access_token="tok",
    )

    with pytest.raises(HTTPException) as exc_info:
        await third_party_login(
            request=SimpleNamespace(),
            response=Response(),
            body=body,
            org_id=None,
            current_user=AnonymousUser(),
            db_session=AsyncMock(),
        )

    assert exc_info.value.status_code == status.HTTP_400_BAD_REQUEST
    assert exc_info.value.detail == "Unsupported provider"
