"""Tests for reading delivery outcomes back from the provider.

This is what protects the sending domain when no webhook is configured, so the
cases that matter are: a bad address gets suppressed, a good one does not, and
a provider outage delays the check rather than losing it.
"""

from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

import pytest
from sqlmodel import select

from src.db.nudges import EmailPreference, NudgeSend, NudgeSendStatus

# Imported for its side effect: the in-memory schema is built from whatever
# models have been imported, and a full run touches every table the snapshot
# scan reads.
from src.services.nudges import eligibility as _eligibility  # noqa: F401
from src.services.nudges.delivery import (
    MAX_AGE_DAYS,
    MIN_AGE_HOURS,
    reconcile_delivery,
)

NOW = datetime(2026, 7, 28, 12, 0, 0, tzinfo=timezone.utc)


@pytest.fixture
async def sent_row(db, org, admin_user):
    def _make(hours_ago=48, provider_id="re_1", email=None, checked=False):
        row = NudgeSend(
            nudge_id="content.course_draft_d3",
            dedupe_key=f"k:{provider_id}",
            org_id=org.id,
            user_id=admin_user.id,
            status=NudgeSendStatus.SENT,
            claimed_at=NOW - timedelta(hours=hours_ago),
            sent_at=NOW - timedelta(hours=hours_ago),
            provider_id=provider_id,
            delivery_checked=checked,
            meta={"email": email or admin_user.email},
        )
        db.add(row)
        return row

    return _make


async def _pref(db, user_id):
    return (
        await db.execute(
            select(EmailPreference).where(EmailPreference.user_id == user_id)
        )
    ).scalars().first()


class TestOutcomes:
    @pytest.mark.parametrize(
        "event,reason", [("bounced", "bounce"), ("complained", "complaint")]
    )
    async def test_a_failed_message_suppresses_the_address(
        self, db, sent_row, admin_user, event, reason
    ):
        sent_row()
        await db.commit()

        with patch(
            "src.services.nudges.delivery._last_event", AsyncMock(return_value=event)
        ):
            result = await reconcile_delivery(db, now=NOW)

        assert result == {"checked": 1, "suppressed": 1}
        pref = await _pref(db, admin_user.id)
        assert pref.suppressed is True and pref.suppressed_reason == reason

    @pytest.mark.parametrize("event", ["delivered", "sent", "opened", "delivery_delayed"])
    async def test_a_healthy_message_suppresses_nothing(
        self, db, sent_row, admin_user, event
    ):
        sent_row()
        await db.commit()

        with patch(
            "src.services.nudges.delivery._last_event", AsyncMock(return_value=event)
        ):
            result = await reconcile_delivery(db, now=NOW)

        assert result == {"checked": 1, "suppressed": 0}
        assert await _pref(db, admin_user.id) is None

    async def test_an_unknown_event_is_treated_as_healthy(self, db, sent_row, admin_user):
        """A new event name the provider adds must not start suppressing."""
        sent_row()
        await db.commit()

        with patch(
            "src.services.nudges.delivery._last_event",
            AsyncMock(return_value="some_future_event"),
        ):
            assert (await reconcile_delivery(db, now=NOW))["suppressed"] == 0

    async def test_a_missing_event_is_treated_as_healthy(self, db, sent_row, admin_user):
        sent_row()
        await db.commit()

        with patch(
            "src.services.nudges.delivery._last_event", AsyncMock(return_value=None)
        ):
            assert (await reconcile_delivery(db, now=NOW))["suppressed"] == 0


class TestWhatGetsPolled:
    async def test_each_message_is_asked_about_once(self, db, sent_row):
        sent_row()
        await db.commit()

        lookup = AsyncMock(return_value="delivered")
        with patch("src.services.nudges.delivery._last_event", lookup):
            await reconcile_delivery(db, now=NOW)
            await reconcile_delivery(db, now=NOW)

        assert lookup.await_count == 1

    async def test_recent_messages_are_left_to_settle(self, db, sent_row):
        """Read too early, a delayed message looks bounced — and suppressing on
        that would throw away a perfectly good address."""
        sent_row(hours_ago=MIN_AGE_HOURS - 1)
        await db.commit()

        lookup = AsyncMock(return_value="bounced")
        with patch("src.services.nudges.delivery._last_event", lookup):
            result = await reconcile_delivery(db, now=NOW)

        assert result["checked"] == 0
        lookup.assert_not_awaited()

    async def test_ancient_messages_are_not_polled(self, db, sent_row):
        sent_row(hours_ago=(MAX_AGE_DAYS + 2) * 24)
        await db.commit()

        with patch("src.services.nudges.delivery._last_event", AsyncMock()) as lookup:
            assert (await reconcile_delivery(db, now=NOW))["checked"] == 0
        lookup.assert_not_awaited()

    async def test_rows_without_a_provider_id_are_skipped(self, db, sent_row):
        """Dry runs and seeded rows never reached the provider."""
        sent_row(provider_id=None)
        await db.commit()

        with patch("src.services.nudges.delivery._last_event", AsyncMock()) as lookup:
            assert (await reconcile_delivery(db, now=NOW))["checked"] == 0
        lookup.assert_not_awaited()

    async def test_the_batch_is_bounded(self, db, sent_row):
        for index in range(5):
            sent_row(provider_id=f"re_{index}")
        await db.commit()

        with patch(
            "src.services.nudges.delivery._last_event", AsyncMock(return_value="delivered")
        ):
            result = await reconcile_delivery(db, now=NOW, limit=2)

        assert result["checked"] == 2


class TestFailureHandling:
    async def test_a_provider_outage_defers_rather_than_loses_the_check(
        self, db, sent_row
    ):
        """The flag stays unset, so the message is asked about again next run."""
        sent_row()
        await db.commit()

        with patch(
            "src.services.nudges.delivery._last_event",
            AsyncMock(side_effect=RuntimeError("resend down")),
        ):
            result = await reconcile_delivery(db, now=NOW)

        assert result == {"checked": 0, "suppressed": 0}

        with patch(
            "src.services.nudges.delivery._last_event", AsyncMock(return_value="bounced")
        ):
            retried = await reconcile_delivery(db, now=NOW)
        assert retried["suppressed"] == 1

    async def test_a_row_without_a_recorded_address_is_marked_checked(self, db, sent_row):
        """Nothing to suppress, but re-asking forever would be pointless."""
        row = sent_row()
        row.meta = {}
        await db.commit()

        with patch(
            "src.services.nudges.delivery._last_event", AsyncMock(return_value="bounced")
        ):
            result = await reconcile_delivery(db, now=NOW)

        assert result == {"checked": 1, "suppressed": 0}

    async def test_nothing_to_do_is_cheap(self, db):
        with patch("src.services.nudges.delivery._last_event", AsyncMock()) as lookup:
            assert await reconcile_delivery(db, now=NOW) == {
                "checked": 0,
                "suppressed": 0,
            }
        lookup.assert_not_awaited()


class TestLastEventShapes:
    async def test_reads_a_dict_response(self):
        from src.services.nudges.delivery import _last_event

        with patch("resend.Emails.get", return_value={"last_event": "bounced"}):
            assert await _last_event("re_1") == "bounced"

    async def test_reads_an_object_response(self):
        from src.services.nudges.delivery import _last_event

        class Email:
            last_event = "delivered"

        with patch("resend.Emails.get", return_value=Email()):
            assert await _last_event("re_1") == "delivered"


class TestReconcileInsideARun:
    async def test_a_run_reconciles_before_it_sends(self, db, org, monkeypatch):
        """The check happens first, so an address that just bounced is already
        suppressed by the time this run decides who to mail."""
        from src.services.nudges import runner as runner_module

        monkeypatch.setenv("LEARNHOUSE_NUDGES_ENABLED", "true")
        monkeypatch.setattr(runner_module, "get_deployment_mode", lambda: "saas")

        called = AsyncMock(return_value={"checked": 0, "suppressed": 0})
        monkeypatch.setattr(
            "src.services.nudges.delivery.reconcile_delivery", called
        )
        db.add(
            NudgeSend(
                nudge_id="bootstrap",
                dedupe_key="bootstrap:0:0",
                org_id=org.id,
                user_id=1,
                status=NudgeSendStatus.SUPPRESSED,
                claimed_at=NOW - timedelta(days=400),
            )
        )
        await db.commit()

        await runner_module.run_nudges(db, now=NOW)
        called.assert_awaited_once()

    async def test_a_broken_reconcile_never_stops_the_send(self, db, org, monkeypatch):
        """Losing the delivery check is bad; losing the whole run is worse."""
        from src.services.nudges import runner as runner_module

        monkeypatch.setenv("LEARNHOUSE_NUDGES_ENABLED", "true")
        monkeypatch.setattr(runner_module, "get_deployment_mode", lambda: "saas")
        monkeypatch.setattr(
            "src.services.nudges.delivery.reconcile_delivery",
            AsyncMock(side_effect=RuntimeError("provider down")),
        )
        db.add(
            NudgeSend(
                nudge_id="bootstrap",
                dedupe_key="bootstrap:0:0",
                org_id=org.id,
                user_id=1,
                status=NudgeSendStatus.SUPPRESSED,
                claimed_at=NOW - timedelta(days=400),
            )
        )
        await db.commit()

        stats = await runner_module.run_nudges(db, now=NOW)
        assert stats.failed == 0
