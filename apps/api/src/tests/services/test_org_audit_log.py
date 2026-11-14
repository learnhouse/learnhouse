"""Core helpers for the organization audit log (src/services/audit/org_log.py)
and the analytics events it also records (src/services/analytics)."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from src.services.audit import org_log


def test_account_event_goes_to_the_session_org_or_every_member_org():
    user = SimpleNamespace(id=3, user_uuid="user_3", username="maya")
    with patch.object(org_log, "audit_event") as audit, \
         patch("src.security.session_context.held_org_id", return_value=7):
        org_log.audit_account_event("req", "security.mfa.enabled", user, details={"a": 1})
    args, kwargs = audit.call_args
    assert args == ("req",) and kwargs["org_id"] == 7 and kwargs["member_orgs"] is True
    assert kwargs["actor"] is user and kwargs["target_id"] == "user_3" and kwargs["target_name"] == "maya"
    with patch.object(org_log, "audit_event") as audit, \
         patch("src.security.session_context.held_org_id", return_value=None):
        org_log.audit_account_event(None, "security.password.changed", user, actor=3, org_id=None)
    assert audit.call_args.kwargs["org_id"] is None and audit.call_args.kwargs["actor"] == 3


def test_snapshot():
    obj = SimpleNamespace(name="A", rights=SimpleNamespace(model_dump=lambda: {"x": 1}), meta={"k": 1})
    snap = org_log.snapshot(obj, ("name", "rights", "meta", "missing"))
    assert snap == {"name": "A", "rights": {"x": 1}, "meta": {"k": 1}, "missing": None}
    assert snap["meta"] is not obj.meta


async def test_labels(db, org, admin_user, admin_role, course):
    assert await org_log.user_label(db, admin_user.id) == ("user_admin", "Admin User")
    assert await org_log.user_label(db, None) == (None, None)
    assert await org_log.user_label(db, 999) == (None, None)
    assert await org_log.user_label(SimpleNamespace(get=AsyncMock(side_effect=RuntimeError)), 1) == (None, None)
    assert await org_log.role_name(db, admin_role.id) == admin_role.name
    assert await org_log.role_name(db, None) is None
    assert await org_log.role_name(db, 999) is None
    assert await org_log.role_name(SimpleNamespace(get=AsyncMock(side_effect=RuntimeError)), 1) is None
    assert await org_log.course_ref(db, course.course_uuid) == (org.id, course.name)
    assert await org_log.course_ref(db, "nope") == (None, None)
    assert await org_log.course_ref(SimpleNamespace(execute=AsyncMock(side_effect=RuntimeError)), "x") == (None, None)


async def test_user_label_without_full_name(db, org):
    from src.db.users import User

    db.add(User(id=41, username="solo", first_name="", last_name="", email="s@x.io", password="x",
                user_uuid="user_solo", creation_date="", update_date=""))
    await db.commit()
    assert await org_log.user_label(db, 41) == ("user_solo", "solo")


async def test_analytics_events_that_are_audited():
    from src.services.analytics import analytics

    with patch("src.core.ee_hooks.audit_event") as audit, \
         patch.object(analytics, "track_ee_analytics_event", AsyncMock()):
        await analytics.track("course_enrolled", 1, 5, properties={"course_uuid": "course_a", "source": "dashboard"})
        await analytics.track("user_joined_org", 1, 5, properties={"join_method": "open"})
        await analytics.track("payment_refunded", 1, 0)
        await analytics.track("page_view", 1, 5)
    enrolled, joined, refunded = (c.kwargs for c in audit.call_args_list)
    assert enrolled["action"] == "enrollment.created" and enrolled["target_id"] == "course_a"
    assert enrolled["details"] == {"learner_id": 5, "source": "dashboard"} and enrolled["fallback_actor"] == 5
    assert joined["action"] == "members.joined" and joined["target_id"] == 5 and joined["details"] == {"join_method": "open"}
    assert refunded["target_type"] is None and refunded["fallback_actor"] is None


def test_course_audit_value():
    from datetime import datetime

    from src.services.courses.courses import _audit_value

    assert _audit_value(SimpleNamespace(model_dump=lambda mode: {"m": mode})) == {"m": "json"}
    assert _audit_value("x") == "x" and _audit_value(None) is None
    assert _audit_value(datetime(2026, 1, 1)) == "2026-01-01 00:00:00"
