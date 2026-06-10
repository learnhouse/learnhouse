"""Behavioral tests for src/routers/ai/magicblocks.py.

Covers:
- event_generator refund on failure / empty / CancelledError (lines 37-77).
- start_magicblock_session org-membership 403 (lines 152-161).
- iterate_magicblock_session ownership 404 + org-membership (lines 226-229, 263-271).
- get_session_state ownership 404 / 200 (lines 325-327, 328-337).

External I/O fully mocked. Handlers are called directly with an AsyncMock
db_session whose .execute() returns a result supporting .scalars().first().
"""

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

from src.routers.ai import magicblocks as mb
from src.services.ai.schemas.magicblocks import (
    MagicBlockContext,
    SendMagicBlockMessage,
    StartMagicBlockSession,
)


def _result(value):
    """Build a fake SQLAlchemy result: result.scalars().first() -> value."""
    scalars = MagicMock()
    scalars.first.return_value = value
    res = MagicMock()
    res.scalars.return_value = scalars
    return res


def _db_returning(*values):
    """AsyncMock db_session whose successive execute() calls return values."""
    db = AsyncMock()
    db.execute.side_effect = [_result(v) for v in values]
    return db


def _context():
    return MagicBlockContext(
        course_title="C",
        course_description="D",
        activity_name="A",
        activity_content_summary="S",
    )


def _session(user_id=1, iteration_count=0, max_iterations=5):
    return SimpleNamespace(
        session_uuid="sess_1",
        block_uuid="block_1",
        activity_uuid="act_1",
        iteration_count=iteration_count,
        max_iterations=max_iterations,
        current_html="<div></div>",
        message_history=[],
        user_id=user_id,
    )


async def _drain(gen):
    return [chunk async for chunk in gen]


# ---------------------------------------------------------------------------
# event_generator (lines 37-77)
# ---------------------------------------------------------------------------


class TestEventGeneratorRefund:
    async def test_refund_on_stream_exception(self):
        async def failing():
            if False:
                yield ""  # pragma: no cover
            raise RuntimeError("boom")

        with patch.object(mb, "refund_ai_credit") as refund:
            events = await _drain(
                mb.event_generator(failing(), "sess_1", org_id=3, reserved_credits=3)
            )

        assert any('"type": "error"' in e for e in events)
        refund.assert_called_once_with(3, 3)

    async def test_refund_on_empty_stream(self):
        async def empty():
            if False:
                yield ""  # pragma: no cover
            return

        with patch.object(mb, "refund_ai_credit") as refund:
            events = await _drain(
                mb.event_generator(empty(), "sess_1", org_id=4, reserved_credits=3)
            )

        # done emitted but no content -> refund
        assert any('"type": "done"' in e for e in events)
        refund.assert_called_once_with(4, 3)

    async def test_no_refund_when_content_produced(self):
        async def good():
            yield "html"

        with patch.object(mb, "refund_ai_credit") as refund:
            events = await _drain(
                mb.event_generator(good(), "sess_1", org_id=5, reserved_credits=3)
            )

        assert any('"type": "chunk"' in e for e in events)
        refund.assert_not_called()

    async def test_refund_on_cancelled_error_and_reraise(self):
        async def cancelling():
            if False:
                yield ""  # pragma: no cover
            raise asyncio.CancelledError()

        with patch.object(mb, "refund_ai_credit") as refund:
            with pytest.raises(asyncio.CancelledError):
                await _drain(
                    mb.event_generator(
                        cancelling(), "sess_1", org_id=6, reserved_credits=3
                    )
                )

        refund.assert_called_once_with(6, 3)

    async def test_no_refund_when_org_id_none(self):
        async def failing():
            if False:
                yield ""  # pragma: no cover
            raise RuntimeError("boom")

        with patch.object(mb, "refund_ai_credit") as refund:
            await _drain(
                mb.event_generator(failing(), "sess_1", org_id=None, reserved_credits=3)
            )

        refund.assert_not_called()

    async def test_refund_failure_swallowed(self):
        """Failing refund (lines 76-77) must not break the generator."""

        async def failing():
            if False:
                yield ""  # pragma: no cover
            raise RuntimeError("boom")

        with patch.object(
            mb, "refund_ai_credit", side_effect=RuntimeError("refund down")
        ):
            events = await _drain(
                mb.event_generator(failing(), "sess_1", org_id=8, reserved_credits=3)
            )

        assert any('"type": "error"' in e for e in events)

    async def test_no_refund_when_reserved_credits_zero(self):
        """reserved_credits=0 guard (line 73) -> no refund attempt."""

        async def failing():
            if False:
                yield ""  # pragma: no cover
            raise RuntimeError("boom")

        with patch.object(mb, "refund_ai_credit") as refund:
            await _drain(
                mb.event_generator(failing(), "sess_1", org_id=8, reserved_credits=0)
            )

        refund.assert_not_called()


# ---------------------------------------------------------------------------
# start_magicblock_session — org membership 403 (lines 152-161)
# ---------------------------------------------------------------------------


class TestStartMagicblockSession:
    def _request_obj(self):
        return StartMagicBlockSession(
            activity_uuid="act_1",
            block_uuid="block_1",
            prompt="make a thing",
            context=_context(),
        )

    async def test_non_member_raises_403(self):
        activity = SimpleNamespace(activity_uuid="act_1")
        course = SimpleNamespace(org_id=10)
        org = SimpleNamespace(id=10)
        db = _db_returning(activity, course, org)
        current_user = MagicMock()

        with patch.object(mb, "resolve_acting_user_id", return_value=1), patch.object(
            mb, "is_org_member", new_callable=AsyncMock, return_value=False
        ), patch.object(mb, "reserve_ai_credit", new_callable=AsyncMock) as reserve:
            with pytest.raises(HTTPException) as exc:
                await mb.start_magicblock_session(
                    MagicMock(), self._request_obj(), current_user, db
                )

        assert exc.value.status_code == 403
        # credits must not be reserved if membership failed
        reserve.assert_not_called()

    async def test_member_proceeds_and_returns_streaming_response(self):
        activity = SimpleNamespace(activity_uuid="act_1")
        course = SimpleNamespace(org_id=10)
        org = SimpleNamespace(id=10)
        db = _db_returning(activity, course, org)
        current_user = MagicMock()

        async def fake_stream():
            yield "html"

        with patch.object(mb, "resolve_acting_user_id", return_value=1), patch.object(
            mb, "is_org_member", new_callable=AsyncMock, return_value=True
        ), patch.object(
            mb, "reserve_ai_credit", new_callable=AsyncMock
        ) as reserve, patch.object(
            mb, "get_org_ai_model", new_callable=AsyncMock, return_value="gemini-x"
        ), patch.object(
            mb, "create_magicblock_session", return_value=_session()
        ), patch.object(
            mb, "generate_magicblock_stream", return_value=fake_stream()
        ), patch(
            "src.services.security.rate_limiting.enforce_ai_rate_limit"
        ):
            resp = await mb.start_magicblock_session(
                MagicMock(), self._request_obj(), current_user, db
            )

        assert resp.media_type == "text/event-stream"
        reserve.assert_awaited_once()
        # reserve called with amount=3
        assert reserve.await_args.kwargs.get("amount") == 3

    async def test_missing_activity_raises_404(self):
        db = _db_returning(None)
        with patch.object(mb, "resolve_acting_user_id", return_value=1):
            with pytest.raises(HTTPException) as exc:
                await mb.start_magicblock_session(
                    MagicMock(), self._request_obj(), MagicMock(), db
                )
        assert exc.value.status_code == 404


# ---------------------------------------------------------------------------
# iterate_magicblock_session — ownership 404 + membership 403
# ---------------------------------------------------------------------------


class TestIterateMagicblockSession:
    def _msg(self):
        return SendMagicBlockMessage(
            session_uuid="sess_1",
            activity_uuid="act_1",
            block_uuid="block_1",
            message="iterate please",
        )

    async def test_session_owned_by_other_user_raises_404(self):
        """session.user_id != acting user -> 404 (lines 226-228)."""
        session = _session(user_id=999)
        with patch.object(mb, "get_magicblock_session", return_value=session), patch.object(
            mb, "resolve_acting_user_id", return_value=1
        ):
            with pytest.raises(HTTPException) as exc:
                await mb.iterate_magicblock_session(
                    MagicMock(), self._msg(), MagicMock(), AsyncMock()
                )
        assert exc.value.status_code == 404

    async def test_missing_session_raises_404(self):
        with patch.object(mb, "get_magicblock_session", return_value=None):
            with pytest.raises(HTTPException) as exc:
                await mb.iterate_magicblock_session(
                    MagicMock(), self._msg(), MagicMock(), AsyncMock()
                )
        assert exc.value.status_code == 404

    async def test_non_member_raises_403(self):
        """Owned session, valid limits, but not an org member -> 403 (263-267)."""
        session = _session(user_id=1)
        course = SimpleNamespace(org_id=10)
        org = SimpleNamespace(id=10)
        db = _db_returning(course, org)

        with patch.object(mb, "get_magicblock_session", return_value=session), patch.object(
            mb, "resolve_acting_user_id", return_value=1
        ), patch.object(
            mb, "is_org_member", new_callable=AsyncMock, return_value=False
        ), patch.object(mb, "reserve_ai_credit", new_callable=AsyncMock) as reserve:
            with pytest.raises(HTTPException) as exc:
                await mb.iterate_magicblock_session(
                    MagicMock(), self._msg(), MagicMock(), db
                )

        assert exc.value.status_code == 403
        reserve.assert_not_called()

    async def test_member_proceeds(self):
        session = _session(user_id=1)
        course = SimpleNamespace(org_id=10)
        org = SimpleNamespace(id=10)
        db = _db_returning(course, org)

        async def fake_stream():
            yield "html"

        with patch.object(mb, "get_magicblock_session", return_value=session), patch.object(
            mb, "resolve_acting_user_id", return_value=1
        ), patch.object(
            mb, "is_org_member", new_callable=AsyncMock, return_value=True
        ), patch.object(
            mb, "reserve_ai_credit", new_callable=AsyncMock
        ), patch.object(
            mb, "get_org_ai_model", new_callable=AsyncMock, return_value="gemini-x"
        ), patch.object(
            mb, "generate_magicblock_stream", return_value=fake_stream()
        ), patch(
            "src.services.security.rate_limiting.enforce_ai_rate_limit"
        ):
            resp = await mb.iterate_magicblock_session(
                MagicMock(), self._msg(), MagicMock(), db
            )

        assert resp.media_type == "text/event-stream"

    async def test_max_iterations_raises_400(self):
        session = _session(user_id=1, iteration_count=5, max_iterations=5)
        with patch.object(mb, "get_magicblock_session", return_value=session), patch.object(
            mb, "resolve_acting_user_id", return_value=1
        ):
            with pytest.raises(HTTPException) as exc:
                await mb.iterate_magicblock_session(
                    MagicMock(), self._msg(), MagicMock(), AsyncMock()
                )
        assert exc.value.status_code == 400


# ---------------------------------------------------------------------------
# get_session_state — ownership 404 / 200 (lines 320-337)
# ---------------------------------------------------------------------------


class TestGetSessionState:
    async def test_missing_session_404(self):
        with patch.object(mb, "get_magicblock_session", return_value=None):
            with pytest.raises(HTTPException) as exc:
                await mb.get_session_state("sess_1", MagicMock(), AsyncMock())
        assert exc.value.status_code == 404

    async def test_other_user_session_404(self):
        session = _session(user_id=999)
        with patch.object(mb, "get_magicblock_session", return_value=session), patch.object(
            mb, "resolve_acting_user_id", return_value=1
        ):
            with pytest.raises(HTTPException) as exc:
                await mb.get_session_state("sess_1", MagicMock(), AsyncMock())
        assert exc.value.status_code == 404

    async def test_owned_session_returns_state(self):
        session = _session(user_id=1)
        with patch.object(mb, "get_magicblock_session", return_value=session), patch.object(
            mb, "resolve_acting_user_id", return_value=1
        ):
            resp = await mb.get_session_state("sess_1", MagicMock(), AsyncMock())

        assert resp.session_uuid == "sess_1"
        assert resp.html_content == "<div></div>"

    async def test_anonymous_session_user_id_none_allowed(self):
        """session.user_id is None -> ownership guard skipped, returns 200."""
        session = _session(user_id=None)
        with patch.object(mb, "get_magicblock_session", return_value=session), patch.object(
            mb, "resolve_acting_user_id", return_value=1
        ):
            resp = await mb.get_session_state("sess_1", MagicMock(), AsyncMock())
        assert resp.session_uuid == "sess_1"
