"""Tests for src/services/nudges/runner.py.

The guardrails are the product here. A nudge system that double-sends, ignores
an opt-out, or mails an unverified address costs more than it earns.
"""

from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import pytest
from sqlmodel import select

from src.db.courses.courses import Course
from src.db.nudges import NudgeSend, NudgeSendStatus
from src.services.nudges import runner as runner_module
from src.services.nudges.preferences import set_lifecycle_opt_out
from src.services.nudges.runner import RunStats, dedupe_key, run_nudges
from src.services.nudges.catalog import get_spec

NOW = datetime(2026, 7, 28, 12, 0, 0, tzinfo=timezone.utc)


def _stored(days_ago: float) -> str:
    """A timestamp in the naive string format the schema uses."""
    return str((NOW - timedelta(days=days_ago)).replace(tzinfo=None))


@pytest.fixture(autouse=True)
def _saas_and_enabled(monkeypatch):
    """Both gates open by default; individual tests close one to assert it."""
    monkeypatch.setenv("LEARNHOUSE_NUDGES_ENABLED", "true")
    monkeypatch.setattr(runner_module, "get_deployment_mode", lambda: "saas")
    monkeypatch.setattr(
        runner_module.links, "org_base_url", _fake_base_url
    )
    monkeypatch.setattr(runner_module, "get_media_base_url", lambda _r=None: "https://api.test")


async def _fake_base_url(org_slug, db_session=None, org_id=None):
    return f"https://{org_slug}.test"


@pytest.fixture(autouse=True)
async def _seeded_ledger(db, org):
    """Pin the activation boundary in the past.

    The boundary is derived from the earliest ledger row, so an empty ledger
    means every org predates the system. Production pins it by running
    `nudges-seed`; the tests pin it here so their orgs count as new.
    """
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


@pytest.fixture
def sender():
    """Patch the provider call and record what would go out."""
    with patch("src.services.nudges.runner.send_nudge_email") as mock:
        mock.return_value = {"id": "sent"}
        yield mock


@pytest.fixture
async def verified_admin(db, admin_user):
    from src.db.users import User

    row = (
        await db.execute(select(User).where(User.id == admin_user.id))
    ).scalars().first()
    row.email_verified = True
    db.add(row)
    await db.commit()
    return row


@pytest.fixture
async def activation_org(db, org, verified_admin):
    """An org one and a half days old with no course — the day-1 case."""
    org.creation_date = _stored(1.5)
    org.update_date = _stored(1.5)
    db.add(org)
    await db.commit()
    return org


async def _ledger(db):
    """Ledger rows written by the run under test, excluding the bootstrap row."""
    rows = (await db.execute(select(NudgeSend))).scalars().all()
    return [r for r in rows if r.nudge_id != "bootstrap"]


class TestGates:
    async def test_non_saas_deployments_send_nothing(
        self, db, activation_org, sender, monkeypatch
    ):
        """Self-hosted instances must not mail their own admins on our behalf."""
        monkeypatch.setattr(runner_module, "get_deployment_mode", lambda: "oss")

        stats = await run_nudges(db, now=NOW)

        assert stats.sent == 0
        sender.assert_not_called()
        assert await _ledger(db) == []

    async def test_kill_switch_off_sends_nothing(
        self, db, activation_org, sender, monkeypatch
    ):
        monkeypatch.setenv("LEARNHOUSE_NUDGES_ENABLED", "false")

        stats = await run_nudges(db, now=NOW)

        assert stats.sent == 0
        sender.assert_not_called()

    async def test_force_overrides_the_gates(
        self, db, activation_org, sender, monkeypatch
    ):
        monkeypatch.setattr(runner_module, "get_deployment_mode", lambda: "oss")
        monkeypatch.setenv("LEARNHOUSE_NUDGES_ENABLED", "false")

        stats = await run_nudges(db, now=NOW, force=True)

        assert stats.sent == 1


class TestSending:
    async def test_sends_the_activation_nudge(self, db, activation_org, sender):
        stats = await run_nudges(db, now=NOW)

        assert stats.sent == 1
        assert stats.by_nudge == {"activation.first_course_d1": 1}
        sender.assert_called_once()

        kwargs = sender.call_args.kwargs
        assert kwargs["nudge_id"] == "activation.first_course_d1"
        assert kwargs["cta_url"] == "https://test-org.test/dash/courses"
        assert kwargs["unsubscribe_url"].startswith(
            "https://api.test/api/v1/emails/unsubscribe?token="
        )

    async def test_ledger_row_records_the_send(self, db, activation_org, sender):
        await run_nudges(db, now=NOW)

        rows = await _ledger(db)
        assert len(rows) == 1
        assert rows[0].status == NudgeSendStatus.SENT
        assert rows[0].sent_at is not None
        assert rows[0].nudge_id == "activation.first_course_d1"
        assert rows[0].meta["track"] == "activation"

    async def test_only_filters_to_one_nudge(self, db, activation_org, sender):
        stats = await run_nudges(db, now=NOW, only="dormancy.no_login_30d")

        assert stats.sent == 0
        sender.assert_not_called()

    async def test_org_id_targets_a_single_org(
        self, db, activation_org, other_org, sender
    ):
        stats = await run_nudges(db, now=NOW, org_id=other_org.id)

        assert stats.sent == 0


class TestDedupe:
    async def test_running_twice_sends_once(self, db, activation_org, sender):
        first = await run_nudges(db, now=NOW)
        second = await run_nudges(db, now=NOW + timedelta(days=1))

        assert first.sent == 1
        assert second.sent == 0
        assert sender.call_count == 1
        assert len(await _ledger(db)) == 1

    async def test_dedupe_holds_even_once_the_cap_has_cleared(
        self, db, activation_org, verified_admin, sender
    ):
        """The frequency cap masks a re-send for a couple of days. Past that,
        the dedupe key is the only thing standing between an admin and a
        second copy of the same email."""
        await run_nudges(db, now=NOW)

        # Clear the trailing-week cap so only dedupe can block the second run,
        # while keeping the org inside the activation window.
        rows = await _ledger(db)
        rows[0].sent_at = NOW - timedelta(days=30)
        db.add(rows[0])
        await db.commit()

        stats = await run_nudges(db, now=NOW)

        assert stats.sent == 0
        assert stats.skipped_dedupe >= 1
        assert sender.call_count == 1

    async def test_dry_run_does_not_consume_the_real_key(
        self, db, activation_org, sender
    ):
        """A rehearsal must not silently disqualify the live send."""
        await run_nudges(db, now=NOW, dry_run=True)
        stats = await run_nudges(db, now=NOW)

        assert stats.sent == 1

    def test_repeatable_nudges_key_by_period(self):
        spec = get_spec("dormancy.no_login_30d")
        quarterly = type(spec)(**{**spec.__dict__, "repeat": "quarterly"})

        q3 = dedupe_key(quarterly, 1, 1, datetime(2026, 8, 1, tzinfo=timezone.utc), False)
        q4 = dedupe_key(quarterly, 1, 1, datetime(2026, 11, 1, tzinfo=timezone.utc), False)

        assert q3 != q4
        assert q3.endswith(":2026-Q3")
        assert q4.endswith(":2026-Q4")

    def test_dry_run_keys_are_namespaced(self):
        spec = get_spec("activation.first_course_d1")
        assert dedupe_key(spec, 1, 1, NOW, True).startswith("dryrun:")
        assert not dedupe_key(spec, 1, 1, NOW, False).startswith("dryrun:")


class TestDryRun:
    async def test_dry_run_writes_a_row_and_sends_nothing(
        self, db, activation_org, sender
    ):
        stats = await run_nudges(db, now=NOW, dry_run=True)

        sender.assert_not_called()
        assert stats.sent == 0
        assert stats.by_nudge == {"activation.first_course_d1": 1}

        rows = await _ledger(db)
        assert len(rows) == 1
        assert rows[0].status == NudgeSendStatus.DRY_RUN
        assert rows[0].sent_at is None

    async def test_dry_run_works_with_the_kill_switch_off(
        self, db, activation_org, sender, monkeypatch
    ):
        """Rehearsing against production must not require arming the system."""
        monkeypatch.setenv("LEARNHOUSE_NUDGES_ENABLED", "false")

        stats = await run_nudges(db, now=NOW, dry_run=True)
        assert stats.by_nudge == {"activation.first_course_d1": 1}


class TestSuppression:
    async def test_unverified_admins_are_never_mailed(
        self, db, activation_org, verified_admin, sender
    ):
        verified_admin.email_verified = False
        db.add(verified_admin)
        await db.commit()

        stats = await run_nudges(db, now=NOW)

        assert stats.sent == 0
        sender.assert_not_called()

    async def test_opted_out_admins_are_skipped(
        self, db, activation_org, verified_admin, sender
    ):
        await set_lifecycle_opt_out(db, verified_admin.id)

        stats = await run_nudges(db, now=NOW)

        assert stats.sent == 0
        assert stats.skipped_optout == 1
        sender.assert_not_called()

    async def test_inactive_orgs_are_skipped(
        self, db, activation_org, sender
    ):
        from src.db.organization_config import OrganizationConfig

        db.add(
            OrganizationConfig(
                org_id=activation_org.id,
                config={"config_version": "2.0", "plan": "free", "active": False},
                creation_date=_stored(0),
                update_date=_stored(0),
            )
        )
        await db.commit()

        stats = await run_nudges(db, now=NOW)

        assert stats.sent == 0
        assert stats.skipped_inactive_org == 1

    async def test_an_org_that_came_back_on_its_own_is_left_alone(
        self, db, activation_org, sender
    ):
        db.add(
            Course(
                id=99,
                name="Just Started",
                description="",
                public=False,
                published=False,
                open_to_contributors=False,
                org_id=activation_org.id,
                course_uuid="course_new",
                creation_date=_stored(0.1),
                update_date=_stored(0.1),
            )
        )
        await db.commit()

        stats = await run_nudges(db, now=NOW)
        assert stats.sent == 0


class TestFrequencyCap:
    async def test_weekly_cap_blocks_further_sends(
        self, db, activation_org, verified_admin, sender
    ):
        for index in range(2):
            db.add(
                NudgeSend(
                    nudge_id=f"other.nudge_{index}",
                    dedupe_key=f"other.nudge_{index}:1:1",
                    org_id=activation_org.id,
                    user_id=verified_admin.id,
                    status=NudgeSendStatus.SENT,
                    claimed_at=NOW - timedelta(days=5),
                    sent_at=NOW - timedelta(days=5),
                )
            )
        await db.commit()

        stats = await run_nudges(db, now=NOW)

        assert stats.sent == 0
        assert stats.skipped_cap == 1

    async def test_recent_send_enforces_a_minimum_gap(
        self, db, activation_org, verified_admin, sender
    ):
        """One email yesterday is under the weekly cap but still too soon."""
        db.add(
            NudgeSend(
                nudge_id="other.nudge",
                dedupe_key="other.nudge:1:1",
                org_id=activation_org.id,
                user_id=verified_admin.id,
                status=NudgeSendStatus.SENT,
                claimed_at=NOW - timedelta(hours=6),
                sent_at=NOW - timedelta(hours=6),
            )
        )
        await db.commit()

        stats = await run_nudges(db, now=NOW)

        assert stats.sent == 0
        assert stats.skipped_cap == 1

    async def test_old_sends_do_not_count_against_the_cap(
        self, db, activation_org, verified_admin, sender
    ):
        db.add(
            NudgeSend(
                nudge_id="other.nudge",
                dedupe_key="other.nudge:1:1",
                org_id=activation_org.id,
                user_id=verified_admin.id,
                status=NudgeSendStatus.SENT,
                claimed_at=NOW - timedelta(days=30),
                sent_at=NOW - timedelta(days=30),
            )
        )
        await db.commit()

        stats = await run_nudges(db, now=NOW)
        assert stats.sent == 1

    async def test_failed_sends_do_not_count_against_the_cap(
        self, db, activation_org, verified_admin, sender
    ):
        db.add(
            NudgeSend(
                nudge_id="other.nudge",
                dedupe_key="other.nudge:1:1",
                org_id=activation_org.id,
                user_id=verified_admin.id,
                status=NudgeSendStatus.FAILED,
                claimed_at=NOW - timedelta(hours=1),
                sent_at=None,
            )
        )
        await db.commit()

        stats = await run_nudges(db, now=NOW)
        assert stats.sent == 1


class TestBudget:
    async def test_max_sends_stops_the_run(self, db, activation_org, sender):
        stats = await run_nudges(db, now=NOW, max_sends=0)

        assert stats.sent == 0
        assert stats.budget_exhausted is True
        sender.assert_not_called()

    async def test_deferred_candidates_are_not_claimed(
        self, db, activation_org, sender
    ):
        """Budget exhaustion must leave them eligible tomorrow, not burn them."""
        await run_nudges(db, now=NOW, max_sends=0)
        assert await _ledger(db) == []

        stats = await run_nudges(db, now=NOW, max_sends=10)
        assert stats.sent == 1


class TestProviderFailure:
    async def test_failure_is_recorded_and_does_not_raise(
        self, db, activation_org, sender
    ):
        """`_send_notification_email` returns False on a provider failure; one
        bad address must not take down the batch."""
        sender.return_value = False

        stats = await run_nudges(db, now=NOW)

        assert stats.failed == 1
        assert stats.sent == 0

        rows = await _ledger(db)
        assert rows[0].status == NudgeSendStatus.FAILED
        assert rows[0].sent_at is None
        assert rows[0].error


class TestSeeding:
    async def test_seed_suppresses_without_sending(self, db, activation_org, sender):
        stats = await run_nudges(db, now=NOW, seed=True)

        sender.assert_not_called()
        assert stats.sent == 0

        rows = await _ledger(db)
        assert len(rows) == 1
        assert rows[0].status == NudgeSendStatus.SUPPRESSED

    async def test_seeded_keys_are_permanently_consumed(
        self, db, activation_org, sender
    ):
        """The point of seeding: switching the system on must not fire a
        backlog of everything that happens to be true that day."""
        await run_nudges(db, now=NOW, seed=True)
        stats = await run_nudges(db, now=NOW)

        assert stats.sent == 0
        sender.assert_not_called()


class TestBackfillGuard:
    @pytest.fixture
    async def legacy_org(self, db, org, verified_admin):
        """An org from long before this system existed, quiet for 32 days."""
        # Older than the boundary the autouse fixture pinned.
        org.creation_date = _stored(500)
        org.update_date = _stored(32)
        db.add(org)
        db.add(
            Course(
                id=50,
                name="Old Course",
                description="",
                public=True,
                published=True,
                open_to_contributors=False,
                org_id=org.id,
                course_uuid="course_old",
                creation_date=_stored(490),
                update_date=_stored(32),
            )
        )
        await db.commit()
        return org

    async def test_backfill_off_excludes_preexisting_orgs(
        self, db, legacy_org, sender, monkeypatch
    ):
        monkeypatch.setenv("LEARNHOUSE_NUDGES_BACKFILL_MODE", "off")

        stats = await run_nudges(db, now=NOW)

        assert stats.sent == 0
        assert stats.skipped_backfill >= 1

    async def test_winback_mode_admits_the_winback_tracks(
        self, db, legacy_org, sender, monkeypatch
    ):
        monkeypatch.setenv("LEARNHOUSE_NUDGES_BACKFILL_MODE", "winback")

        stats = await run_nudges(db, now=NOW)

        assert stats.sent == 1
        assert set(stats.by_nudge) <= {
            "dormancy.no_login_30d",
            "reactivation.opener",
        }

    async def test_full_mode_admits_everything(self, db, legacy_org, sender, monkeypatch):
        monkeypatch.setenv("LEARNHOUSE_NUDGES_BACKFILL_MODE", "full")

        stats = await run_nudges(db, now=NOW)
        assert stats.sent == 1


class TestActivationBoundary:
    """The pre-existing/new boundary is derived from the ledger, not configured."""

    async def test_the_earliest_ledger_row_is_the_boundary(self, db):
        from src.services.nudges.runner import activation_date

        # The autouse fixture pinned it 400 days back.
        assert (await activation_date(db)) == NOW - timedelta(days=400)

    async def test_an_empty_ledger_means_everything_predates_the_system(self, db):
        """Nothing has run here yet, so no org can be "new". That is what makes
        `nudges-seed` a real prerequisite rather than a suggestion."""
        from sqlmodel import delete

        from src.services.nudges.runner import activation_date

        await db.execute(delete(NudgeSend))
        await db.commit()

        boundary = await activation_date(db)
        assert boundary > NOW - timedelta(days=1)

    async def test_seeding_pins_the_boundary(self, db, activation_org, sender):
        """`nudges-seed` writes rows, so seeding is what fixes the date — there
        is no separate value to set, and none to get wrong."""
        from sqlmodel import delete

        from src.services.nudges.runner import activation_date

        await db.execute(delete(NudgeSend))
        await db.commit()

        await run_nudges(db, now=NOW, seed=True)
        assert (await activation_date(db)) == NOW


class TestEnvHelpers:
    @pytest.mark.parametrize(
        "value,expected",
        [("true", True), ("1", True), ("YES", True), ("off", False), ("", False)],
    )
    def test_flag_parsing(self, monkeypatch, value, expected):
        monkeypatch.setenv("LEARNHOUSE_TEST_FLAG", value)
        assert runner_module._flag("LEARNHOUSE_TEST_FLAG") is expected

    def test_flag_default_when_unset(self, monkeypatch):
        monkeypatch.delenv("LEARNHOUSE_TEST_FLAG", raising=False)
        assert runner_module._flag("LEARNHOUSE_TEST_FLAG", True) is True

    def test_stats_serialise(self):
        stats = RunStats()
        stats.record("a.b")
        stats.record("a.b")
        assert stats.as_dict()["by_nudge"] == {"a.b": 2}


class TestRepeatKeys:
    def test_monthly_repeat_keys_by_month(self):
        spec = get_spec("dormancy.no_login_30d")
        monthly = type(spec)(**{**spec.__dict__, "repeat": "monthly"})

        july = dedupe_key(monthly, 1, 1, datetime(2026, 7, 5, tzinfo=timezone.utc), False)
        august = dedupe_key(monthly, 1, 1, datetime(2026, 8, 5, tzinfo=timezone.utc), False)

        assert july.endswith(":2026-07")
        assert august.endswith(":2026-08")

    def test_full_backfill_mode_admits_every_track(self, monkeypatch):
        """Documented as unsupported, but it exists as an escape hatch and
        must do what it says."""
        monkeypatch.setenv("LEARNHOUSE_NUDGES_BACKFILL_MODE", "full")
        spec = get_spec("activation.first_course_d1")
        snapshot = type(
            "S", (), {"created_at": NOW - timedelta(days=400)}
        )()
        assert runner_module._backfill_allows(
            spec, snapshot, NOW - timedelta(days=30)
        ) is True


class TestWhiteLabelling:
    async def test_org_logo_is_used_when_the_org_has_one(
        self, db, activation_org, sender
    ):
        activation_org.logo_image = "logo.png"
        db.add(activation_org)
        await db.commit()

        await run_nudges(db, now=NOW)

        assert sender.call_args.kwargs["logo_url"] == (
            "https://api.test/content/orgs/org_test/logos/logo.png"
        )

    async def test_no_logo_leaves_the_default_mark(self, db, activation_org, sender):
        await run_nudges(db, now=NOW)
        assert sender.call_args.kwargs["logo_url"] is None


class TestBudgetMidOrganization:
    async def test_budget_stops_between_admins_of_one_org(
        self, db, org, admin_role, verified_admin, sender
    ):
        """The inner loop needs its own budget check — an org with several
        admins could otherwise overrun the cap on a single iteration."""
        from datetime import datetime as dt

        from src.db.user_organizations import UserOrganization
        from src.db.users import User

        org.creation_date = _stored(1.5)
        org.update_date = _stored(1.5)
        db.add(org)

        for index in range(2, 5):
            db.add(
                User(
                    id=index + 10,
                    username=f"admin{index}",
                    first_name="Admin",
                    last_name="Two",
                    email=f"admin{index}@test.com",
                    password="x",
                    user_uuid=f"user_admin{index}",
                    email_verified=True,
                    creation_date=str(dt.now()),
                    update_date=str(dt.now()),
                )
            )
            db.add(
                UserOrganization(
                    user_id=index + 10,
                    org_id=org.id,
                    role_id=admin_role.id,
                    creation_date=str(dt.now()),
                    update_date=str(dt.now()),
                )
            )
        await db.commit()

        stats = await run_nudges(db, now=NOW, max_sends=2)

        assert stats.sent == 2
        assert stats.budget_exhausted is True


class TestStatStripReachesTheEmail:
    async def test_content_nudge_carries_its_figures(self, db, org, verified_admin, sender):
        from src.db.courses.courses import Course

        org.creation_date = _stored(40)
        org.update_date = _stored(40)
        db.add(org)
        db.add(
            Course(
                id=60,
                name="Draft",
                description="",
                public=False,
                published=False,
                open_to_contributors=False,
                org_id=org.id,
                course_uuid="course_d",
                creation_date=_stored(30),
                update_date=_stored(4),
            )
        )
        await db.commit()

        from src.db.courses.activities import (
            Activity,
            ActivitySubTypeEnum,
            ActivityTypeEnum,
        )

        for index in (1, 2):
            db.add(
                Activity(
                    id=index,
                    name=f"Lesson {index}",
                    activity_type=ActivityTypeEnum.TYPE_DYNAMIC,
                    activity_sub_type=ActivitySubTypeEnum.SUBTYPE_DYNAMIC_PAGE,
                    content={},
                    published=False,
                    org_id=org.id,
                    course_id=60,
                    activity_uuid=f"activity_{index}",
                    creation_date=_stored(30),
                    update_date=_stored(30),
                )
            )
        await db.commit()

        await run_nudges(db, now=NOW, only="content.course_draft_d3")

        assert sender.call_args.kwargs["stats"] == [("chapters", 0), ("lessons", 2)]


class TestPreexistingEdgeCase:
    def test_an_org_with_no_parseable_creation_date_is_not_preexisting(self):
        """A malformed date must not silently move an org into the winback
        tracks — treat it as new and let day_max do the bounding."""
        from src.services.nudges.runner import _is_preexisting
        from src.services.nudges.snapshot import OrgSnapshot

        snap = OrgSnapshot(
            org_id=1, org_slug="a", org_name="A", plan="free", lang="en",
            now=NOW, created_at=None,
        )
        assert _is_preexisting(snap, NOW) is False
