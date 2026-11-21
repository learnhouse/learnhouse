"""SaaS plan lifecycle: the free trial, its expiry job and emails, the Free
plan's content rules on a downgrade and their undo on an upgrade, and the
gates that keep downgraded orgs to what Free includes."""

from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException
from sqlmodel import select

from src.db.courses.certifications import Certifications
from src.db.courses.courses import Course
from src.db.nudges import EmailPreference, NudgeSend
from src.db.org_plan_state import OrgDowngrade, OrgTrial, TrialStatus
from src.db.organization_config import OrganizationConfig
from src.db.organizations import Organization
from src.db.trail_runs import TrailRun
from src.db.user_organizations import UserOrganization
from src.db.users import User
from src.security.features_utils.plans import (
    FEATURE_PLAN_REQUIREMENTS,
    PLAN_FEATURE_CONFIGS,
    PLAN_HIERARCHY,
    plan_meets_requirement,
)
from src.services.plans import downgrade, notify, scheduler, transitions, trial

NOW = datetime(2026, 11, 15, 12, 0, tzinfo=timezone.utc)


@contextmanager
def saas():
    with patch("src.core.deployment_mode.get_deployment_mode", return_value="saas"), patch(
        "src.security.features_utils.resolve.get_deployment_mode", return_value="saas"
    ), patch("src.security.features_utils.plan_check.get_deployment_mode", return_value="saas"):
        yield


@contextmanager
def mail():
    """Capture outgoing plan emails instead of sending them."""
    sender = MagicMock(return_value={"id": "msg_1"})
    with patch("src.services.users.emails.send_plan_email", sender), patch(
        "src.services.nudges.links.org_base_url", AsyncMock(return_value="https://acme.test")
    ), patch("src.services.email.utils.get_media_base_url", return_value="https://api.test"):
        yield sender


@contextmanager
def quiet_notifications():
    emit = AsyncMock(return_value=[])
    with patch("src.services.notifications.emit.emit_admin", emit):
        yield emit


async def set_plan(db, org_id: int, plan: str, version: str = "2.0"):
    config = {"config_version": version, "plan": plan} if version == "2.0" else {"config_version": version, "cloud": {"plan": plan}}
    row = (await db.execute(select(OrganizationConfig).where(OrganizationConfig.org_id == org_id))).scalars().first()
    if row is None:
        db.add(OrganizationConfig(org_id=org_id, config=config, creation_date="", update_date=""))
    else:
        row.config = config
        db.add(row)
    await db.commit()


async def add_course(db, org_id: int, cid: int, *, public=True, published=True, learners=0, updated="2026-01-01", drip=False):
    c = Course(
        id=cid, name=f"Course {cid}", description="", public=public, published=published, org_id=org_id, open_to_contributors=False,
        course_uuid=f"course_{cid}", creation_date=updated, update_date=updated,
        drip_settings={"enabled": True, "mode": "relative"} if drip else None,
    )
    db.add(c)
    for i in range(learners):
        db.add(TrailRun(trail_id=1, course_id=cid, org_id=org_id, user_id=1000 + cid * 100 + i, creation_date="", update_date=""))
    await db.commit()
    return c


async def get_plan(db, org_id: int) -> str:
    return await transitions.get_org_plan_from_db(db, org_id)


# ── trial basics ─────────────────────────────────────────────────────────


class TestTrialBasics:
    def test_trials_only_on_saas_and_can_be_switched_off(self, monkeypatch):
        assert trial.trials_enabled() is False
        assert trial.plan_for_new_org() is None
        with saas():
            assert trial.plan_for_new_org() == trial.TRIAL_PLAN == "pro"
            monkeypatch.setenv("LEARNHOUSE_TRIALS_DISABLED", "1")
            assert trial.trials_enabled() is False

    async def test_begin_is_once_per_org(self, db, org, admin_user):
        t1 = await trial.begin_trial(db, org.id, admin_user.id, now=NOW)
        t2 = await trial.begin_trial(db, org.id, admin_user.id, now=NOW + timedelta(days=1))
        assert t1.ends_at.replace(tzinfo=timezone.utc) == NOW + timedelta(days=trial.TRIAL_DAYS)
        assert t2.org_id == t1.org_id and t2.started_at == t1.started_at

    async def test_state_and_days_left(self, db, org):
        assert trial.trial_state(None) is None
        t = await trial.begin_trial(db, org.id, now=NOW)
        state = trial.trial_state(t, NOW + timedelta(days=13, hours=21))
        assert state["active"] and state["days_left"] == 1 and state["plan"] == "pro"
        assert state["length_days"] == 14 and state["ended_at"] is None
        assert trial.days_left(t, NOW + timedelta(days=20)) == 0
        await trial.mark_converted(db, org.id, "standard", NOW)
        done = trial.trial_state(await trial.get_trial(db, org.id), NOW)
        assert done["status"] == "converted" and done["days_left"] == 0 and done["converted_plan"] == "standard"
        assert done["ended_at"]

    async def test_active_lookups(self, db, org, other_org):
        await trial.begin_trial(db, org.id, now=NOW)
        assert await trial.active_trial_org_ids(db, []) == set()
        assert await trial.active_trial_org_ids(db, [org.id, other_org.id]) == {org.id}
        assert (await trial.get_active_trial(db, org.id)).org_id == org.id
        assert await trial.get_active_trial(db, other_org.id) is None

    async def test_mark_converted_ignores_free_and_settles_once(self, db, org):
        await trial.begin_trial(db, org.id, now=NOW)
        assert await trial.mark_converted(db, org.id, "free") is False
        assert await trial.mark_converted(db, org.id, "pro") is True
        assert await trial.mark_converted(db, org.id, "pro") is False

    @pytest.mark.parametrize(
        "plan,reason,status",
        [("free", "trial_expired", TrialStatus.EXPIRED), ("free", "platform", TrialStatus.ENDED),
         ("pro", "poc", TrialStatus.ENDED), ("standard", "billing", TrialStatus.CONVERTED)],
    )
    async def test_settle_on_plan_change(self, db, org, plan, reason, status):
        await trial.begin_trial(db, org.id, now=NOW)
        assert await trial.settle_on_plan_change(db, org.id, plan, reason) == status
        assert await trial.settle_on_plan_change(db, org.id, plan, reason) is None


# ── org creation ─────────────────────────────────────────────────────────


class TestOrgCreation:
    async def _create(self, db, admin_user, slug="new-org"):
        from src.db.organizations import OrganizationCreate
        from src.services.orgs.orgs import create_org

        with patch("src.services.orgs.orgs._try_send_org_created", AsyncMock()), patch(
            "src.services.orgs.orgs._try_record_org_admin_in_loops"
        ), patch("src.services.orgs.orgs.is_multi_org_allowed", return_value=True), patch(
            "src.routers.users._invalidate_session_cache"
        ):
            return await create_org(
                MagicMock(), OrganizationCreate(name="New", slug=slug, email="n@x.io", description=None, logo_image=""),
                admin_user, db,
            )

    async def test_saas_org_starts_on_the_trial_plan(self, db, org, admin_user):
        with saas():
            created = await self._create(db, admin_user)
        assert await get_plan(db, created.id) == "pro"
        t = await trial.get_active_trial(db, created.id)
        assert t is not None and t.created_by_user_id == admin_user.id

    async def test_self_hosted_org_has_no_trial(self, db, org, admin_user):
        created = await self._create(db, admin_user)
        assert await get_plan(db, created.id) == "free"
        assert await trial.get_trial(db, created.id) is None

    async def test_trialing_orgs_count_toward_the_free_org_cap(self, db, org, admin_user):
        from src.services.orgs.orgs import MAX_FREE_ORGS, _enforce_free_org_cap

        await set_plan(db, org.id, "pro")
        await trial.begin_trial(db, org.id, now=NOW)
        for i in range(2, MAX_FREE_ORGS + 1):
            db.add(Organization(id=i, name=f"O{i}", slug=f"o{i}", email="o@x.io", org_uuid=f"org_{i}", creation_date="", update_date=""))
            db.add(UserOrganization(user_id=admin_user.id, org_id=i, role_id=1, creation_date="", update_date=""))
            await db.commit()
            await set_plan(db, i, "free")
        with pytest.raises(HTTPException) as exc:
            await _enforce_free_org_cap(admin_user, db)
        assert exc.value.status_code == 403
        # Once the trial org pays, the user is a customer and the cap lifts.
        await trial.mark_converted(db, org.id, "pro")
        await _enforce_free_org_cap(admin_user, db)

    async def test_org_created_email_mentions_the_trial(self, db, org, admin_user):
        from src.services.orgs.orgs import _try_send_org_created

        await trial.begin_trial(db, org.id, now=NOW)
        with patch("src.services.users.emails.send_org_created_email") as send, patch(
            "src.services.email.utils.get_org_signup_base_url", AsyncMock(return_value="https://a.test/")
        ):
            await _try_send_org_created(MagicMock(), org, admin_user, db)
        assert send.call_args.kwargs == {"trial_plan": "pro", "trial_days": trial.TRIAL_DAYS}


# ── transitions ──────────────────────────────────────────────────────────


class TestTransitions:
    def test_write_plan_layouts(self):
        v2 = transitions.write_plan({"config_version": "2.0", "plan": "pro"}, "free")
        assert v2["plan"] == "free" and v2["customization"]["general"]["watermark"] is True
        assert transitions.write_plan({"config_version": "2.0"}, "standard")["plan"] == "standard"
        v1 = transitions.write_plan({"config_version": "1.0"}, "pro")
        assert v1["cloud"] == {"plan": "pro", "custom_domain": True} and v1["general"]["watermark"] is False
        assert transitions.is_paid("pro") and not transitions.is_paid("free") and not transitions.is_paid(None)

    async def test_set_org_plan_errors_and_noop(self, db, org):
        with pytest.raises(ValueError):
            await transitions.set_org_plan(db, org.id, "gold")
        with pytest.raises(LookupError):
            await transitions.set_org_plan(db, org.id, "pro")
        await set_plan(db, org.id, "pro")
        assert await transitions.set_org_plan(db, org.id, "pro") == ("pro", False)
        assert await transitions.get_org_plan_from_db(db, 999) is None

    async def test_on_plan_changed_is_saas_only(self, db, org):
        with patch.object(downgrade, "enforce_downgrade", AsyncMock()) as enforce:
            await transitions.on_plan_changed(db, org.id, "pro", "free")
            with saas():
                await transitions.on_plan_changed(db, org.id, "pro", "pro")
                await transitions.on_plan_changed(db, org.id, "pro", None)
        enforce.assert_not_called()

    async def test_downgrade_then_upgrade_restores_everything(self, db, org, admin_user):
        await set_plan(db, org.id, "pro")
        await add_course(db, org.id, 1, learners=1)
        await add_course(db, org.id, 2, learners=5, drip=True)
        await add_course(db, org.id, 3, learners=0, public=False)
        with saas(), mail() as sent, quiet_notifications() as emit:
            assert await transitions.set_org_plan(db, org.id, "free", reason="billing") == ("pro", True)
            courses = {c.id: c for c in (await db.execute(select(Course))).scalars().all()}
            # The most-followed course stays public; the others go private.
            assert courses[2].public and not courses[1].public and not courses[3].public
            assert courses[2].drip_settings["enabled"] is False
            record = (await db.execute(select(OrgDowngrade))).scalars().one()
            assert record.changes["kept_course"]["id"] == 2
            assert [c["id"] for c in record.changes["courses"]] == [1]
            assert record.changes["drip_paused"] == [2]
            assert sent.call_args.args[0] == notify.PLAN_DOWNGRADED
            assert sent.call_args.kwargs["unsubscribe_url"] == ""  # account notice
            assert emit.call_args.args[1] == "plan_downgraded"

            # An admin's own change after the downgrade is respected.
            courses[3].public = False
            db.add(courses[3])
            await db.commit()

            await transitions.set_org_plan(db, org.id, "standard")
            await db.refresh(courses[1])
            await db.refresh(courses[2])
            assert courses[1].public is True
            assert courses[2].drip_settings["enabled"] is True
            assert emit.call_args.args[1] == "plan_restored"
            assert emit.call_args.kwargs["params"]["count"] == 1
            await db.refresh(record)
            assert record.restored_at is not None and record.restored_to_plan == "standard"

            # A second round trip works the same way.
            await transitions.set_org_plan(db, org.id, "free")
            await transitions.set_org_plan(db, org.id, "personal")
        assert emit.call_args.args[1] == "plan_restored"
        assert emit.call_args.kwargs["params"]["count"] == 1

    async def test_on_plan_changed_never_raises(self, db, org):
        with saas(), patch.object(trial, "settle_on_plan_change", AsyncMock(side_effect=RuntimeError)), patch.object(
            downgrade, "enforce_downgrade", AsyncMock(side_effect=RuntimeError)
        ):
            await transitions.on_plan_changed(db, org.id, "pro", "free")

    async def test_on_plan_changed_records_one_transition(self, db, org):
        with saas(), patch("src.core.ee_hooks.audit_event") as audit, patch.object(
            trial, "settle_on_plan_change", AsyncMock()
        ), patch.object(downgrade, "restore_after_upgrade", AsyncMock(return_value=([], 0))):
            await transitions.on_plan_changed(db, org.id, "free", "pro", reason="billing")
        audit.assert_called_once()
        kwargs = audit.call_args.kwargs
        assert kwargs["action"] == "billing.plan.transition" and kwargs["org_id"] == org.id
        assert kwargs["changes"] == {"plan": {"from": "free", "to": "pro"}}
        assert kwargs["details"] == {"reason": "billing", "trial": False}

    async def test_on_plan_changed_flags_a_running_trial(self, db, org):
        db.add(OrgTrial(org_id=org.id, plan="pro", started_at=NOW, ends_at=NOW + timedelta(days=14)))
        await db.commit()
        with saas(), patch("src.core.ee_hooks.audit_event") as audit, patch.object(
            trial, "settle_on_plan_change", AsyncMock()
        ):
            await transitions.on_plan_changed(db, org.id, "pro", "standard", reason="billing")
        assert audit.call_args.kwargs["details"] == {"reason": "billing", "trial": True}

    async def test_transition_audit_failure_never_raises(self, db, org):
        with saas(), patch("src.core.ee_hooks.audit_event", side_effect=RuntimeError), patch.object(
            trial, "settle_on_plan_change", AsyncMock()
        ) as settle, patch.object(downgrade, "restore_after_upgrade", AsyncMock(return_value=([], 0))):
            await transitions.on_plan_changed(db, org.id, "free", "pro")
        settle.assert_awaited_once()

    async def test_config_write_path_runs_the_reactions(self, db, org):
        from src.services.orgs.orgs import update_org_with_config_no_auth

        await set_plan(db, org.id, "pro")
        with patch("src.services.plans.transitions.on_plan_changed", AsyncMock()) as hook:
            await update_org_with_config_no_auth(MagicMock(), {"config_version": "2.0", "plan": "free"}, org.id, db)
        hook.assert_awaited_once_with(db, org.id, "pro", "free", reason="billing")


# ── downgrade details ────────────────────────────────────────────────────


class TestDowngradeRules:
    def test_public_course_cap(self):
        assert downgrade.public_course_cap("free") == 1
        assert downgrade.public_course_cap("pro") == 0
        assert downgrade.public_course_cap("unknown") == 1

    async def test_ranking_ties_prefer_published_then_recent(self, db, org):
        await add_course(db, org.id, 1, published=False, updated="2026-05-01")
        await add_course(db, org.id, 2, published=True, updated="2026-01-01")
        await add_course(db, org.id, 3, published=True, updated="2026-03-01")
        ranked = await downgrade.rank_public_courses(db, org.id)
        assert [c.id for c in ranked] == [3, 2, 1]

    async def test_no_cap_means_nothing_to_enforce(self, db, org):
        assert await downgrade.enforce_downgrade(db, org.id, "pro", "personal") is None
        assert await downgrade.restore_after_upgrade(db, org.id, "pro") == ([], 0)

    async def test_org_without_courses(self, db, org):
        record = await downgrade.enforce_downgrade(db, org.id, "pro")
        assert record.changes == {"courses": [], "kept_course": None, "drip_paused": []}
        state = downgrade.downgrade_state(record)
        assert state["courses_made_private"] == 0 and state["kept_course"] is None and not state["restored"]
        assert downgrade.downgrade_state(None) is None
        assert (await downgrade.latest_downgrade(db, org.id)).id == record.id

    async def test_drip_kept_on_plans_that_include_it(self, db, org):
        await add_course(db, org.id, 1, drip=True)
        assert await downgrade._pause_drip(db, org.id, "standard") == []

    async def test_restore_skips_deleted_foreign_and_capped(self, db, org, other_org):
        await add_course(db, org.id, 1)
        await add_course(db, other_org.id, 2)
        db.add(OrgDowngrade(org_id=org.id, from_plan="pro", to_plan="free", changes={
            "courses": [{"id": 99, "public": True}, {"id": 2, "public": True}, {"id": 1, "public": False}],
            "drip_paused": [99, 2],
        }))
        await db.commit()
        records, restored = await downgrade.restore_after_upgrade(db, org.id, "pro")
        assert len(records) == 1 and restored == 0
        # A plan with a public course cap restores no more than it allows.
        db.add(OrgDowngrade(org_id=org.id, from_plan="pro", to_plan="free", changes={"courses": [{"id": 1, "public": True}]}))
        await db.commit()
        _, restored = await downgrade.restore_after_upgrade(db, org.id, "free")
        assert restored == 0

    async def test_preview(self, db, org, admin_user):
        await add_course(db, org.id, 1, learners=2)
        await add_course(db, org.id, 2, drip=True)
        preview = await downgrade.preview_downgrade(db, org.id, "pro", "free")
        assert "paths" in preview["features"] and "courses" not in preview["features"]
        assert preview["courses"]["kept"]["id"] == 1
        assert [c["id"] for c in preview["courses"]["made_private"]] == [2]
        assert preview["courses"]["drip_paused"] == 1
        assert preview["members"] == {"count": 1, "limit": 10, "over": False}
        assert preview["admins"]["limit"] == 1
        up = await downgrade.preview_downgrade(db, org.id, "standard", "pro")
        assert up["courses"]["made_private"] == [] and up["courses"]["kept"] is None


# ── expiry job ───────────────────────────────────────────────────────────


class TestExpiry:
    async def test_expiry_moves_to_free_once(self, db, org, admin_user):
        await set_plan(db, org.id, "pro")
        await add_course(db, org.id, 1, learners=3)
        await add_course(db, org.id, 2)
        await trial.begin_trial(db, org.id, now=NOW - timedelta(days=15))
        with saas(), mail() as sent, quiet_notifications():
            assert await trial.expire_due_trials(db, NOW) == [org.id]
            assert await trial.expire_due_trials(db, NOW) == []
        assert await get_plan(db, org.id) == "free"
        assert (await trial.get_trial(db, org.id)).status == TrialStatus.EXPIRED
        record = (await db.execute(select(OrgDowngrade))).scalars().one()
        assert record.reason == "trial_expired"
        assert sent.call_args.args[0] == notify.TRIAL_ENDED

    async def test_not_due_yet(self, db, org):
        await set_plan(db, org.id, "pro")
        await trial.begin_trial(db, org.id, now=NOW)
        with saas():
            assert await trial.expire_due_trials(db, NOW + timedelta(days=13), org_id=org.id) == []

    @pytest.mark.parametrize("current,status,plan", [("standard", TrialStatus.CONVERTED, "standard"), ("free", TrialStatus.ENDED, None)])
    async def test_plan_changed_elsewhere_is_settled_without_a_move(self, db, org, current, status, plan):
        await set_plan(db, org.id, current)
        await trial.begin_trial(db, org.id, now=NOW - timedelta(days=15))
        with saas():
            assert await trial.expire_due_trials(db, NOW) == []
        t = await trial.get_trial(db, org.id)
        assert t.status == status and t.converted_plan == plan
        assert await get_plan(db, org.id) == current

    async def test_failed_move_is_retried_next_run(self, db, org):
        await set_plan(db, org.id, "pro")
        await trial.begin_trial(db, org.id, now=NOW - timedelta(days=15))
        with saas(), patch.object(transitions, "set_org_plan", AsyncMock(side_effect=RuntimeError)):
            assert await trial.expire_due_trials(db, NOW) == []
        # The rollback expired the loaded rows (the org fixture included).
        t = await trial.get_trial(db, 1)
        await db.refresh(t)
        assert t.status == TrialStatus.ACTIVE

    async def test_raced_move_still_settles(self, db, org):
        await set_plan(db, org.id, "pro")
        await trial.begin_trial(db, org.id, now=NOW - timedelta(days=15))
        with saas(), patch.object(transitions, "set_org_plan", AsyncMock(return_value=("free", False))):
            assert await trial.expire_due_trials(db, NOW) == []
        assert (await trial.get_trial(db, org.id)).status == TrialStatus.EXPIRED

    async def test_paying_for_the_trial_plan_prevents_the_move(self, db, org):
        await set_plan(db, org.id, "pro")
        await trial.begin_trial(db, org.id, now=NOW - timedelta(days=15))
        await trial.mark_converted(db, org.id, "pro")
        with saas():
            assert await trial.expire_due_trials(db, NOW) == []
        assert await get_plan(db, org.id) == "pro"


# ── trial emails ─────────────────────────────────────────────────────────


class TestTrialEmails:
    @pytest.mark.parametrize(
        "elapsed,stage",
        [(0, notify.TRIAL_WELCOME), (2, notify.TRIAL_WELCOME), (4, None), (6, notify.TRIAL_TIPS),
         (11.5, notify.TRIAL_ENDS_3D), (13.5, notify.TRIAL_ENDS_1D), (15, None)],
    )
    def test_due_stage_windows(self, elapsed, stage):
        t = OrgTrial(org_id=1, plan="pro", started_at=NOW, ends_at=NOW + timedelta(days=14))
        assert notify.due_trial_stage(t, NOW + timedelta(days=elapsed)) == stage

    async def test_stage_is_sent_once_and_respects_preferences(self, db, org, admin_user, regular_user):
        # A second admin who opted out of lifecycle mail, and a third whose
        # address bounced.
        for uid, email in ((3, "out@x.io"), (4, "bounced@x.io")):
            db.add(User(id=uid, username=f"u{uid}", first_name="", last_name="", email=email, password="x", user_uuid=f"user_{uid}", creation_date="", update_date=""))
            db.add(UserOrganization(user_id=uid, org_id=org.id, role_id=1, creation_date="", update_date=""))
        db.add(EmailPreference(user_id=3, lifecycle_opt_out=True))
        db.add(EmailPreference(user_id=4, suppressed=True))
        await db.commit()
        await trial.begin_trial(db, org.id, now=NOW)
        with mail() as sent, quiet_notifications():
            assert await notify.send_due_trial_emails(db, NOW + timedelta(hours=1)) == 1
            assert await notify.send_due_trial_emails(db, NOW + timedelta(hours=2)) == 0
        assert sent.call_count == 1
        args, kwargs = sent.call_args
        assert args[0] == notify.TRIAL_WELCOME and args[1] == "admin@test.com"
        assert args[3] == "https://acme.test/dash/courses"
        assert kwargs["plan_name"] == "Pro" and kwargs["days"] == 14
        assert kwargs["unsubscribe_url"].startswith("https://api.test/api/v1/emails/unsubscribe")
        rows = (await db.execute(select(NudgeSend))).scalars().all()
        assert [(r.nudge_id, r.status, r.provider_id) for r in rows] == [(notify.TRIAL_WELCOME, "sent", "msg_1")]

    async def test_a_dedupe_collision_does_not_stop_the_next_org(self, db, org, other_org, admin_user):
        db.add(UserOrganization(user_id=admin_user.id, org_id=other_org.id, role_id=1, creation_date="", update_date=""))
        await db.commit()
        await trial.begin_trial(db, org.id, now=NOW)
        await trial.begin_trial(db, other_org.id, now=NOW)
        with mail(), quiet_notifications():
            assert await notify.send_stage(db, org.id, notify.TRIAL_WELCOME) == 1
            # org's welcome collides in the ledger (rolls back); other_org still gets its own.
            assert await notify.send_due_trial_emails(db, NOW + timedelta(hours=1)) == 1

    async def test_three_days_left_also_notifies(self, db, org, admin_user):
        await trial.begin_trial(db, org.id, now=NOW)
        with mail() as sent, quiet_notifications() as emit:
            await notify.send_due_trial_emails(db, NOW + timedelta(days=11, hours=12))
        assert sent.call_args.args[0] == notify.TRIAL_ENDS_3D
        assert sent.call_args.kwargs["end_date"] == "29 November 2026"
        assert emit.call_args.args[1] == "trial_ending" and emit.call_args.kwargs["params"]["days"] == 3

    async def test_failed_provider_and_no_admins(self, db, org, admin_user, other_org):
        await trial.begin_trial(db, org.id, now=NOW)
        await trial.begin_trial(db, other_org.id, now=NOW - timedelta(days=4))  # no stage due
        with mail() as sent:
            sent.return_value = False
            assert await notify.send_due_trial_emails(db, NOW) == 0
        row = (await db.execute(select(NudgeSend))).scalars().one()
        assert row.status == "failed"
        assert await notify.send_stage(db, other_org.id, notify.TRIAL_TIPS) == 0

    async def test_the_demo_org_admins_are_never_mailed(self, db, org, admin_user):
        # Every demo visitor is an admin of the demo: its "admins" are strangers.
        assert [a.user_id for a in await notify.org_admins(db, org.id)] == [admin_user.id]
        org.is_demo = True
        db.add(org)
        await db.commit()
        assert await notify.org_admins(db, org.id) == []
        with mail() as sent:
            assert await notify.send_stage(db, org.id, notify.TRIAL_WELCOME) == 0
        sent.assert_not_called()

    async def test_one_failing_org_does_not_stop_the_run(self, db, org, admin_user):
        await trial.begin_trial(db, org.id, now=NOW)
        with patch.object(notify, "send_stage", AsyncMock(side_effect=RuntimeError)):
            assert await notify.send_due_trial_emails(db, NOW) == 0

    async def test_downgrade_notice_variants(self, db, org, admin_user):
        with mail() as sent, quiet_notifications() as emit:
            await notify.notify_downgraded(db, org.id, "pro", None, "billing")
            assert emit.call_args.kwargs["params"] == {"plan": "Pro", "count": 0}
            assert "paused until" in emit.call_args.kwargs["body"]
            record = OrgDowngrade(id=5, org_id=org.id, from_plan="pro", to_plan="free",
                                  changes={"courses": [{"id": 1}], "kept_course": {"name": "Intro"}})
            await notify.notify_downgraded(db, org.id, "pro", record, "trial_expired")
        assert sent.call_args.args[0] == notify.TRIAL_ENDED
        assert sent.call_args.kwargs["kept_course"] == "Intro"
        assert "trial ended" in emit.call_args.kwargs["title"]

    async def test_downgrade_email_failure_still_notifies(self, db, org, admin_user):
        with patch.object(notify, "send_stage", AsyncMock(side_effect=RuntimeError)), quiet_notifications() as emit:
            await notify.notify_downgraded(db, org.id, "pro", None, "billing")
        emit.assert_awaited_once()


# ── scheduler ────────────────────────────────────────────────────────────


class TestScheduler:
    async def test_run_once(self, db, org, admin_user):
        await set_plan(db, org.id, "pro")
        await trial.begin_trial(db, org.id, now=NOW - timedelta(days=20))
        with saas(), mail(), quiet_notifications():
            result = await scheduler.run_once(db, NOW)
        # The trial ended this run, so no trial-stage email is due; the move
        # itself sends the "you're on Free" notice.
        assert result == {"expired": [org.id], "emails_sent": 0}

    async def test_tick_claims_the_hour_and_never_raises(self):
        factory = MagicMock()
        factory.return_value.__aenter__ = AsyncMock(return_value=MagicMock())
        factory.return_value.__aexit__ = AsyncMock(return_value=False)
        with patch("src.core.events.database._async_session_factory", factory), patch.object(
            scheduler, "run_once", AsyncMock(return_value={"expired": [1], "emails_sent": 0})
        ) as run, patch("src.core.redis.get_redis_client", return_value=None):
            await scheduler.tick(NOW)
        run.assert_awaited_once()
        with patch.object(scheduler, "_claim", AsyncMock(return_value=False)), patch.object(scheduler, "run_once", AsyncMock()) as run:
            await scheduler.tick(NOW)
        run.assert_not_called()
        with patch.object(scheduler, "_claim", AsyncMock(side_effect=RuntimeError)):
            await scheduler.tick()
        lock = MagicMock()
        lock.set.return_value = True
        with patch("src.core.redis.get_redis_client", return_value=lock):
            assert await scheduler._claim(scheduler._slot(NOW)) is True
        assert scheduler._slot(NOW) == "learnhouse:trials:tick:2026-11-15T12"

    async def test_start_is_idle_under_tests_and_outside_saas(self, monkeypatch):
        scheduler.start_scheduler()
        assert scheduler._task is None
        monkeypatch.setenv("TESTING", "false")
        scheduler.start_scheduler()
        assert scheduler._task is None
        await scheduler.stop_scheduler()


# ── public course cap and runtime gates ──────────────────────────────────


class TestGates:
    async def test_public_course_cap_on_free(self, db, org, admin_user):
        from src.services.courses.courses import _enforce_public_course_cap

        await set_plan(db, org.id, "free")
        await add_course(db, org.id, 1)
        second = await add_course(db, org.id, 2, public=False)
        await _enforce_public_course_cap(second, db)  # self-hosted: no cap
        with saas():
            with pytest.raises(HTTPException) as exc:
                await _enforce_public_course_cap(second, db)
            assert exc.value.detail["code"] == "PUBLIC_COURSE_LIMIT"
            assert "1 public course." in exc.value.detail["message"]
            await set_plan(db, org.id, "pro")
            await _enforce_public_course_cap(second, db)

    async def test_update_course_refuses_a_second_public_course(self, db, org, admin_user):
        from src.db.courses.courses import CourseUpdate
        from src.services.courses.courses import update_course

        await set_plan(db, org.id, "free")
        await add_course(db, org.id, 1)
        await add_course(db, org.id, 2, public=False)
        with saas(), patch("src.services.courses.courses.check_resource_access", AsyncMock()), patch(
            "src.services.courses.courses.authorization_verify_based_on_org_admin_status", AsyncMock(return_value=True)
        ):
            with pytest.raises(HTTPException) as exc:
                await update_course(MagicMock(), CourseUpdate(public=True), "course_2", admin_user, db)
        assert exc.value.status_code == 403

    async def test_certificates_follow_the_plan(self, db, org):
        from src.services.courses.certifications import _certificates_in_plan

        await set_plan(db, org.id, "free")
        await add_course(db, org.id, 1)
        cert = Certifications(id=1, course_id=1, config={}, certification_uuid="c1", creation_date="", update_date="")
        assert await _certificates_in_plan(cert, db) is True
        with saas():
            assert await _certificates_in_plan(cert, db) is False
            await set_plan(db, org.id, "pro")
            assert await _certificates_in_plan(cert, db) is True
        assert await _certificates_in_plan(Certifications(id=2, course_id=99, config={}, certification_uuid="c2"), db) is False

    async def test_podcast_episodes_follow_the_plan(self, db, org):
        from src.services.podcasts.episodes import _podcasts_enabled

        assert await _podcasts_enabled(org.id, db) is True  # no config: nothing taken away
        await set_plan(db, org.id, "free")
        with saas():
            assert await _podcasts_enabled(org.id, db) is False
            await set_plan(db, org.id, "standard")
            assert await _podcasts_enabled(org.id, db) is True

    async def test_episode_list_404s_without_the_plan(self, db, org, admin_user):
        from src.db.podcasts.podcasts import Podcast
        from src.services.podcasts.episodes import get_episodes_by_podcast

        db.add(Podcast(id=1, name="Pod", description="", org_id=org.id, podcast_uuid="podcast_1", public=True, published=True))
        await db.commit()
        await set_plan(db, org.id, "free")
        with saas(), pytest.raises(HTTPException) as exc:
            await get_episodes_by_podcast(MagicMock(), 1, db, admin_user)
        assert exc.value.status_code == 404

    async def test_collab_needs_the_plan(self, db, org, admin_user):
        from src.services.courses.activities import collab

        await set_plan(db, org.id, "free")
        await add_course(db, org.id, 1)
        with saas(), patch.object(collab, "collab_enabled", return_value=True), patch.object(
            collab, "_activity_and_course", AsyncMock(return_value=(SimpleNamespace(), SimpleNamespace(org_id=org.id)))
        ), patch.object(collab, "is_collab_activity", return_value=True):
            with pytest.raises(HTTPException) as exc:
                await collab.get_collab_access(MagicMock(), "activity_1", admin_user, db)
        assert exc.value.status_code == 403

    def test_limit_detail_keeps_the_prefix(self):
        from src.security.features_utils.usage import _limit_detail

        detail = _limit_detail("members", 10)
        assert detail.startswith("Usage Limit has been reached for Members")
        assert "10 members" in detail and "upgrade" in detail
        assert "3 admin seats" in _limit_detail("admin_seats", 3)


# ── feature gate matrix ──────────────────────────────────────────────────


GATED = [f for f in FEATURE_PLAN_REQUIREMENTS if f in PLAN_FEATURE_CONFIGS["enterprise"]["features"]]


class TestGateMatrix:
    """For every plan and every plan-gated feature: the router gate (plan
    hierarchy), the resolved feature the UI reads and the plan config agree.
    Boards are the documented exception: the hierarchy lets Standard through
    the outer gate, and the boards routers' feature check (plan config) blocks
    it, which is what the UI shows."""

    @pytest.mark.parametrize("plan", PLAN_HIERARCHY)
    @pytest.mark.parametrize("feature", GATED)
    def test_api_and_ui_agree(self, plan, feature):
        from src.security.features_utils.resolve import resolve_feature

        with saas():
            resolved = resolve_feature(feature, {"config_version": "2.0", "plan": plan})
            hierarchy = plan_meets_requirement(plan, FEATURE_PLAN_REQUIREMENTS[feature])
        configured = PLAN_FEATURE_CONFIGS[plan]["features"][feature]["enabled"]
        assert resolved["available"] == configured, (plan, feature)
        if feature == "boards" and plan == "standard":
            assert hierarchy and not configured
            return
        assert hierarchy == configured, (plan, feature)

    def test_trial_plan_unlocks_every_feature_up_to_pro(self):
        for feature in GATED:
            if FEATURE_PLAN_REQUIREMENTS[feature] not in ("business", "enterprise"):
                assert PLAN_FEATURE_CONFIGS[trial.TRIAL_PLAN]["features"][feature]["enabled"], feature


# ── routers ──────────────────────────────────────────────────────────────


class TestRouters:
    @pytest.fixture
    def internal(self, db, monkeypatch):
        from fastapi import FastAPI

        from src.routers.orgs import org_plan

        monkeypatch.setenv("CLOUD_INTERNAL_KEY", "k")
        app = FastAPI()
        app.include_router(org_plan.internal_router, prefix="/ci")
        # The router module's own reference: another test reloads the database
        # module, which would leave a freshly imported name unmatched.
        app.dependency_overrides[org_plan.get_db_session] = lambda: db
        return app

    async def _call(self, app, method, url, **kw):
        from httpx import ASGITransport, AsyncClient

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
            return await getattr(c, method)(url, headers={"X-Internal-Key": "k"}, **kw)

    async def test_billing_write_converts_a_trial_on_the_same_plan(self, internal, db, org):
        await set_plan(db, org.id, "pro")
        await trial.begin_trial(db, org.id, now=NOW)
        res = await self._call(internal, "put", "/ci/update_org_plan", json={"org_id": org.id, "plan": "pro"})
        assert res.status_code == 200
        assert res.json()["trial_converted"] is True and res.json()["org_age_days"] == 0
        assert (await trial.get_trial(db, 1)).status == TrialStatus.CONVERTED

    def test_org_age(self):
        from src.routers.orgs.org_plan import _age_days

        assert _age_days(None) is None and _age_days("nope") is None
        assert _age_days("2000-01-01 00:00:00") > 9000

    async def test_run_and_fast_forward(self, internal, db, org, admin_user):
        res = await self._call(internal, "post", "/ci/trials/run")
        assert res.json() == {"expired": [], "emails_sent": 0}
        res = await self._call(internal, "post", "/ci/trials/1/fast_forward", json={"days": 1})
        assert res.status_code == 404
        await set_plan(db, org.id, "pro")
        await trial.begin_trial(db, org.id)
        with saas(), mail(), quiet_notifications():
            res = await self._call(internal, "post", "/ci/trials/1/fast_forward", json={"days": 15})
        body = res.json()
        assert body["trial"]["status"] == "expired" and body["job"]["expired"] == [1]

    async def test_trial_endpoint(self, db, org, admin_user):
        from fastapi import FastAPI
        from httpx import ASGITransport, AsyncClient

        from src.routers.orgs import plan_overview as po_router

        app = FastAPI()
        app.include_router(po_router.router, prefix="/o")
        app.dependency_overrides[po_router.get_db_session] = lambda: db
        app.dependency_overrides[po_router.get_current_user] = lambda: admin_user
        await trial.begin_trial(db, org.id, now=NOW)
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
            assert (await c.get("/o/1/trial")).json() == {"trial": None}
            with saas():
                body = (await c.get("/o/1/trial")).json()
        assert body["trial"]["plan"] == "pro" and body["trial"]["status"] == "active"


class TestPlanOverview:
    async def test_trial_status_preview_and_last_downgrade(self, db, org, admin_user):
        from src.services.orgs.plan_overview import get_plan_overview

        await set_plan(db, org.id, "pro")
        await add_course(db, org.id, 1)
        await trial.begin_trial(db, org.id)
        with saas(), patch("src.services.orgs.plan_overview.get_ee_hooks", return_value=None):
            data = await get_plan_overview(org.id, db)
            assert data["status"] == "trial" and data["billing"] == "none"
            assert data["trial"]["active"] is True
            assert data["downgrade_preview"]["courses"]["kept"]["id"] == 1
            states = {f["key"]: f["state"] for f in data["features"]}
            assert states["paths"] == "trial" and states["courses"] == "included"
            assert data["last_downgrade"] is None

            with mail(), quiet_notifications():
                await trial.expire_due_trials(db, datetime.now(timezone.utc) + timedelta(days=15))
            data = await get_plan_overview(org.id, db)
        assert data["status"] == "free" and data["trial"]["status"] == "expired"
        assert data["downgrade_preview"] is None
        assert data["last_downgrade"]["reason"] == "trial_expired"


class TestEmails:
    def test_plan_email_rendering(self):
        from src.services.users import emails

        with patch("src.services.email.pipeline.deliver_message", return_value=True) as send, patch(
            "src.services.email.templates.learning.reply_to_address", return_value="hi@lh.io"
        ):
            emails.send_plan_email("trial_ends_3d", "a@x.io", "Acme & Co", "https://a/plan", lang="fr",
                                   unsubscribe_url="https://u", plan_name="Pro", days=3, end_date="2026-11-29")
            kw = send.call_args.kwargs
            assert "Pro" in kw["subject"] and "&amp;" not in kw["subject"]
            assert kw["headers"]["List-Unsubscribe"] == "<https://u>" and kw["headers"]["Reply-To"] == "hi@lh.io"
            assert "Acme &amp; Co" in kw["body"]
            emails.send_plan_email("trial_ended", "a@x.io", "Acme", "https://a/plan", plan_name="Pro")
            assert "List-Unsubscribe" not in (send.call_args.kwargs["headers"] or {})
        with patch("src.services.email.pipeline.deliver_message", return_value=True) as send, patch(
            "src.services.email.templates.learning.reply_to_address", return_value=""
        ):
            emails.send_plan_email("plan_downgraded", "a@x.io", "Acme", "https://a/plan", plan_name="Pro")
            assert send.call_args.kwargs["headers"] is None

    def test_every_locale_has_the_plan_emails(self):
        import re

        from src.services.email.plan_translations import PLAN_EMAIL_TRANSLATIONS
        from src.services.email.translations import SUPPORTED_LANGUAGES

        english = PLAN_EMAIL_TRANSLATIONS["en"]
        for lang in SUPPORTED_LANGUAGES:
            assert set(PLAN_EMAIL_TRANSLATIONS[lang]) == set(english), lang
            for key, text in english.items():
                assert sorted(re.findall(r"\{(\w+)\}", PLAN_EMAIL_TRANSLATIONS[lang][key])) == sorted(re.findall(r"\{(\w+)\}", text)), (lang, key)

    def test_org_created_email_trial_variant(self):
        from src.services.users import emails

        with patch("src.services.email.pipeline.deliver_message", return_value=True) as send:
            emails.send_org_created_email("a@x.io", "Acme", "https://a/dash", trial_plan="pro", trial_days=14)
            assert "14 days" in send.call_args.kwargs["body"] and "Pro" in send.call_args.kwargs["body"]
            emails.send_org_created_email("a@x.io", "Acme", "https://a/dash")
            assert "14 days" not in send.call_args.kwargs["body"]


class TestPlanPicker:
    def test_mid_trial_picks_like_a_free_org(self):
        from src.services.onboarding import plans as picker

        out = picker.picker("pro", None, "pro")
        assert out["current_plan"] == "free" and out["trial_plan"] == "pro" and out["can_continue_free"]
        pro = next(p for p in out["plans"] if p["id"] == "pro")
        assert pro["trial"] and not pro["current"]
        assert "pro" in out["upgrades"]
        assert not any(p["trial"] for p in picker.picker("free", None)["plans"])

    async def test_router_passes_the_trial(self, db, org, admin_user):
        from fastapi import FastAPI
        from httpx import ASGITransport, AsyncClient

        from src.routers import onboarding as onb

        await set_plan(db, org.id, "pro")
        await trial.begin_trial(db, org.id)
        app = FastAPI()
        app.include_router(onb.router, prefix="/onb")
        app.dependency_overrides[onb.get_db_session] = lambda: db
        app.dependency_overrides[onb.get_current_user] = lambda: admin_user
        with saas(), patch("src.routers.onboarding.deployment_mode.get_deployment_mode", return_value="saas"):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
                res = await c.get(f"/onb/orgs/{org.id}/plans")
        assert res.status_code == 200, res.text
        assert res.json()["trial_plan"] == "pro"
