"""Behavioral tests for the new user_id field on MagicBlockSessionData.

Covers src/services/ai/schemas/magicblocks.py line 49
(``user_id: Optional[int] = None``).
"""
from src.services.ai.schemas.magicblocks import (
    MagicBlockContext,
    MagicBlockSessionData,
)


def _context():
    return MagicBlockContext(
        course_title="C",
        course_description="D",
        activity_name="A",
        activity_content_summary="S",
    )


def _base_kwargs():
    return dict(
        session_uuid="mb_1",
        block_uuid="b",
        activity_uuid="a",
        iteration_count=0,
        max_iterations=6,
        message_history=[],
        current_html=None,
        context=_context(),
    )


def test_user_id_defaults_to_none_when_omitted():
    session = MagicBlockSessionData(**_base_kwargs())
    assert session.user_id is None


def test_user_id_is_stored_when_provided():
    session = MagicBlockSessionData(user_id=42, **_base_kwargs())
    assert session.user_id == 42


def test_user_id_round_trips_through_model_dump():
    session = MagicBlockSessionData(user_id=42, **_base_kwargs())
    dumped = session.model_dump()
    assert dumped["user_id"] == 42
    rebuilt = MagicBlockSessionData(**dumped)
    assert rebuilt.user_id == 42
