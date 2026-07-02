"""Tests for src/services/ai/generations.py (durable AI generation history).

Uses the in-memory SQLite ``db`` fixture for real ORM round-trips. Imports the
assignment model so the FK on ``aigeneration.assignment_id`` resolves during
``create_all``.
"""

import pytest

import src.db.courses.assignments  # noqa: F401 — register FK target table
from src.db.ai.generations import AIGenerationKind
from src.services.ai.generations import (
    delete_generation,
    get_generation,
    list_generations,
    record_generation,
)

pytestmark = pytest.mark.asyncio


async def _make(db, *, kind=AIGenerationKind.IMAGE, user_id=7, org_id=1, prompt="p", result=None):
    return await record_generation(
        db,
        kind=kind,
        org_id=org_id,
        user_id=user_id,
        prompt=prompt,
        result=result or {"file_id": "f1"},
        session_uuid="sess_1",
    )


async def test_record_and_get(db):
    rec = await _make(db)
    assert rec.ai_generation_uuid.startswith("aigen_")
    assert rec.kind == AIGenerationKind.IMAGE
    assert rec.creation_date is not None

    got = await get_generation(db, ai_generation_uuid=rec.ai_generation_uuid, user_id=7)
    assert got is not None and got.result["file_id"] == "f1"


async def test_get_missing_returns_none(db):
    assert await get_generation(db, ai_generation_uuid="nope", user_id=7) is None


async def test_get_wrong_owner_blocked(db):
    rec = await _make(db, user_id=7)
    assert await get_generation(db, ai_generation_uuid=rec.ai_generation_uuid, user_id=999) is None


async def test_list_filters_by_kind_and_owner(db):
    await _make(db, kind=AIGenerationKind.IMAGE, user_id=7)
    await _make(db, kind=AIGenerationKind.QUIZ, user_id=7)
    await _make(db, kind=AIGenerationKind.IMAGE, user_id=8)

    images = await list_generations(db, org_id=1, user_id=7, kind=AIGenerationKind.IMAGE)
    assert len(images) == 1
    quizzes = await list_generations(db, org_id=1, user_id=7, kind=AIGenerationKind.QUIZ)
    assert len(quizzes) == 1


async def test_list_pagination_clamped(db):
    for _ in range(3):
        await _make(db, user_id=7)
    # limit clamped to >=1, offset clamped to >=0
    rows = await list_generations(db, org_id=1, user_id=7, kind=AIGenerationKind.IMAGE, limit=0, offset=-5)
    assert len(rows) == 1


async def test_delete_owned_and_idor(db):
    rec = await _make(db, user_id=7)
    # wrong owner cannot delete
    assert await delete_generation(db, ai_generation_uuid=rec.ai_generation_uuid, user_id=999) is False
    # owner can
    assert await delete_generation(db, ai_generation_uuid=rec.ai_generation_uuid, user_id=7) is True
    # gone
    assert await get_generation(db, ai_generation_uuid=rec.ai_generation_uuid, user_id=7) is None


async def test_delete_missing_returns_false(db):
    assert await delete_generation(db, ai_generation_uuid="nope", user_id=7) is False
