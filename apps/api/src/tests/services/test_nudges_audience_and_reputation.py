"""Who is allowed to receive a nudge, and what stops us mailing them.

Two invariants worth a dedicated file:

* only organization admins are ever mailed — never members, never learners;
* an address a provider has told us is bad is never mailed again.
"""

from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import pytest
from sqlmodel import select

from src.db.nudges import EmailPreference
from src.db.user_organizations import UserOrganization
from src.db.users import User
from src.security.rbac.constants import ADMIN_ROLE_ID
from src.services.nudges import runner as runner_module
from src.services.nudges.eligibility import build_snapshots
from src.services.nudges.preferences import (
    get_opted_out_user_ids,
    is_suppressed,
    set_lifecycle_opt_out,
    suppress_address,
)
from src.services.nudges.runner import run_nudges

NOW = datetime(2026, 7, 28, 12, 0, 0, tzinfo=timezone.utc)


def _stored(days_ago: float) -> str:
    return str((NOW - timedelta(days=days_ago)).replace(tzinfo=None))


async def _fake_base_url(org_slug, db_session=None, org_id=None):
    return f"https://{org_slug}.test"


@pytest.fixture(autouse=True)
def _gates(monkeypatch):
    monkeypatch.setenv("LEARNHOUSE_NUDGES_ENABLED", "true")
    monkeypatch.setattr(runner_module, "get_deployment_mode", lambda: "saas")
    monkeypatch.setattr(runner_module.links, "org_base_url", _fake_base_url)
    monkeypatch.setattr(
        runner_module, "get_media_base_url", lambda _r=None: "https://api.test"
    )


@pytest.fixture(autouse=True)
async def _seeded_ledger(db, org):
    """Pin the activation boundary in the past.

    An empty ledger means every org predates the system; production pins the
    boundary with `nudges-seed`, and the tests pin it here.
    """
    from src.db.nudges import NudgeSend, NudgeSendStatus

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
    with patch("src.services.nudges.runner.send_nudge_email") as mock:
        mock.return_value = {"id": "sent"}
        yield mock


@pytest.fixture
async def populated_org(db, org, admin_role, user_role, admin_user, regular_user):
    """One admin, several non-admin members, all verified and mailable.

    Aged past the activity window on purpose: members who joined yesterday
    make the org active, and an active org is deliberately left alone.
    """
    org.creation_date = _stored(32)
    org.update_date = _stored(32)
    db.add(org)

    for index in range(3):
        uid = 40 + index
        db.add(
            User(
                id=uid,
                username=f"learner{index}",
                first_name="Learner",
                last_name=str(index),
                email=f"learner{index}@test.com",
                password="x",
                user_uuid=f"user_learner{index}",
                email_verified=True,
                creation_date=_stored(31),
                update_date=_stored(31),
            )
        )
        db.add(
            UserOrganization(
                user_id=uid,
                org_id=org.id,
                role_id=user_role.id,
                creation_date=_stored(31),
                update_date=_stored(31),
            )
        )

    row = (await db.execute(select(User).where(User.id == admin_user.id))).scalars().first()
    row.email_verified = True
    db.add(row)
    await db.commit()

    # The shared `regular_user` fixture joins with today's date, which would
    # make the org read as active and silence every track. Age every
    # membership so the org is genuinely quiet.
    links = (
        await db.execute(
            select(UserOrganization).where(UserOrganization.org_id == org.id)
        )
    ).scalars().all()
    for link in links:
        link.creation_date = _stored(31)
        link.update_date = _stored(31)
        db.add(link)
    await db.commit()
    return org


class TestOnlyAdminsAreMailed:
    async def test_snapshot_collects_admins_only(self, db, populated_org, admin_user):
        snap = (await build_snapshots(db, [populated_org]))[0]

        assert snap.member_count == 4  # regular_user + three learners
        assert [a.user_id for a in snap.admins] == [admin_user.id]

    async def test_a_run_mails_only_the_admin(self, db, populated_org, admin_user, sender):
        stats = await run_nudges(db, now=NOW)

        assert stats.sent == 1
        recipients = {call.kwargs["email"] for call in sender.call_args_list}
        assert recipients == {admin_user.email}

    async def test_no_member_address_is_ever_a_recipient(
        self, db, populated_org, sender
    ):
        await run_nudges(db, now=NOW)

        recipients = {call.kwargs["email"] for call in sender.call_args_list}
        for address in recipients:
            assert "learner" not in address
            assert "user@test.com" not in address

    async def test_promoting_a_member_brings_them_in(
        self, db, populated_org, admin_role, sender
    ):
        """The gate is the role, not a static list — a promotion takes effect."""
        link = (
            await db.execute(
                select(UserOrganization).where(UserOrganization.user_id == 40)
            )
        ).scalars().first()
        link.role_id = admin_role.id
        db.add(link)
        await db.commit()

        snap = (await build_snapshots(db, [populated_org]))[0]
        assert {a.user_id for a in snap.admins} == {1, 40}

    async def test_the_admin_query_filters_on_the_admin_role_id(self, db, populated_org):
        """Guards the constant itself: if ADMIN_ROLE_ID ever changed without
        the query changing, this is what would catch it."""
        rows = (
            await db.execute(
                select(UserOrganization.user_id).where(
                    UserOrganization.org_id == populated_org.id,
                    UserOrganization.role_id == ADMIN_ROLE_ID,
                )
            )
        ).scalars().all()
        snap = (await build_snapshots(db, [populated_org]))[0]
        assert {a.user_id for a in snap.admins} == set(rows)


class TestDeliverySuppression:
    async def test_a_hard_bounce_stops_future_mail(self, db, populated_org, admin_user, sender):
        await suppress_address(db, admin_user.email, "bounce")

        stats = await run_nudges(db, now=NOW)

        assert stats.sent == 0
        assert stats.skipped_optout == 1
        sender.assert_not_called()

    async def test_a_complaint_stops_future_mail(self, db, populated_org, admin_user, sender):
        await suppress_address(db, admin_user.email, "complaint")
        assert await is_suppressed(db, admin_user.id) is True

        stats = await run_nudges(db, now=NOW)
        assert stats.sent == 0

    async def test_suppression_survives_a_resubscribe(self, db, admin_user):
        """Re-subscribing is a preference; a dead address is a fact. Consent
        cannot make mail deliverable again."""
        await suppress_address(db, admin_user.email, "bounce")
        await set_lifecycle_opt_out(db, admin_user.id, opted_out=False)

        assert await is_suppressed(db, admin_user.id) is True
        assert await get_opted_out_user_ids(db, [admin_user.id]) == {admin_user.id}

    async def test_suppression_records_its_reason(self, db, admin_user):
        await suppress_address(db, admin_user.email, "complaint")

        pref = (
            await db.execute(
                select(EmailPreference).where(EmailPreference.user_id == admin_user.id)
            )
        ).scalars().first()
        assert pref.suppressed is True
        assert pref.suppressed_reason == "complaint"

    async def test_an_unknown_address_is_ignored(self, db):
        """Bounces arrive for users since deleted; that must not raise."""
        assert await suppress_address(db, "nobody@nowhere.test", "bounce") is None

    async def test_suppression_is_idempotent(self, db, admin_user):
        first = await suppress_address(db, admin_user.email, "bounce")
        stamp = first.unsubscribed_at
        second = await suppress_address(db, admin_user.email, "bounce")

        assert second.suppressed is True
        assert second.unsubscribed_at == stamp
