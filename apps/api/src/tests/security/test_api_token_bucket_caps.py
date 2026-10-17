"""Token-only rights buckets are capped by the creator's closest role bucket."""

import pytest
from fastapi import HTTPException

from src.services.api_tokens.api_tokens import validate_rights_structure
from src.tests.conftest import USER_RIGHTS

pytestmark = pytest.mark.asyncio

BUCKETS = ["courses", "activities", "coursechapters", "folders", "media",
           "certifications", "usergroups", "payments", "search"]


def _token_rights(**overrides):
    rights = {b: {"action_read": True} for b in BUCKETS}
    rights.update(overrides)
    return rights


async def test_reader_cannot_mint_certification_writes():
    with pytest.raises(HTTPException) as exc:
        await validate_rights_structure(
            _token_rights(certifications={"action_read": True, "action_create": True}),
            USER_RIGHTS.model_dump(),
        )
    assert exc.value.status_code == 403


async def test_reader_cannot_mint_payment_writes():
    with pytest.raises(HTTPException) as exc:
        await validate_rights_structure(
            _token_rights(payments={"action_read": True, "action_update": True}),
            USER_RIGHTS.model_dump(),
        )
    assert exc.value.status_code == 403


async def test_read_only_token_is_fine():
    await validate_rights_structure(_token_rights(), USER_RIGHTS.model_dump())
