"""Tests for the per-student audit router + dossier service + durable write path."""
from datetime import datetime, timezone
from unittest.mock import patch

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlmodel.ext.asyncio.session import AsyncSession
from sqlmodel import select

from src.core.events.database import get_db_session
from src.security.auth import get_current_user
from src.db.users import AnonymousUser, User
from src.db.user_organizations import UserOrganization
from src.db.user_audit_events import UserAuditEvent, UserAuditEventType
from src.db.trail_runs import TrailRun, StatusEnum
from src.db.courses.certifications import Certifications, CertificateUser
from src.routers.audit import router as audit_router


# ---------------------------------------------------------------------------
# App / client fixtures (real in-memory db)
# ---------------------------------------------------------------------------
@pytest.fixture
def app(db, admin_user):
    app = FastAPI()
    app.include_router(audit_router, prefix="/api/v1/audit")
    app.dependency_overrides[get_db_session] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: admin_user
    yield app
    app.dependency_overrides.clear()


@pytest.fixture
async def client(app):
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as c:
        yield c


def _bypass_plan():
    """Bypass the Enterprise plan gate so tests focus on RBAC + data."""
    return patch(
        "src.security.features_utils.plan_check._check_mode_bypass",
        return_value=True,
    )


@pytest.fixture
async def seed_activity(db: AsyncSession, org, course, regular_user):
    """Seed one connection, one enrollment and one certificate for the regular user."""
    db.add(UserAuditEvent(
        event_type=UserAuditEventType.LOGIN,
        user_id=regular_user.id,
        org_id=None,
        ip="10.0.0.1",
        user_agent="pytest-agent",
        audit_metadata={"method": "password"},
        created_at=datetime.now(timezone.utc),
    ))
    db.add(TrailRun(
        data={},
        status=StatusEnum.STATUS_IN_PROGRESS,
        trail_id=1,
        course_id=course.id,
        org_id=org.id,
        user_id=regular_user.id,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    ))
    cert = Certifications(
        course_id=course.id,
        certification_uuid="cert_test",
        config={},
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(cert)
    await db.commit()
    await db.refresh(cert)
    db.add(CertificateUser(
        user_id=regular_user.id,
        certification_id=cert.id,
        user_certification_uuid="usercert_test",
        created_at=str(datetime.now()),
        updated_at=str(datetime.now()),
    ))
    await db.commit()
    return regular_user


class TestUserDossier:
    async def test_admin_gets_full_dossier(self, client, regular_user, seed_activity):
        with _bypass_plan():
            resp = await client.get(f"/api/v1/audit/user/{regular_user.id}?org_id=1")
        assert resp.status_code == 200
        body = resp.json()
        assert body["user"]["id"] == regular_user.id
        # Connection event is surfaced with its IP.
        assert len(body["connections"]) == 1
        assert body["connections"][0]["ip"] == "10.0.0.1"
        # Enrollment + certificate rolled into the dossier + summary.
        assert body["summary"]["courses_enrolled"] == 1
        assert body["summary"]["certificates_earned"] == 1
        assert len(body["certificates"]) == 1

    async def test_regular_user_is_forbidden(self, app, client, regular_user):
        app.dependency_overrides[get_current_user] = lambda: regular_user
        with _bypass_plan():
            resp = await client.get(f"/api/v1/audit/user/{regular_user.id}?org_id=1")
        assert resp.status_code == 403

    async def test_anonymous_is_unauthorized(self, app, client, regular_user):
        app.dependency_overrides[get_current_user] = lambda: AnonymousUser()
        with _bypass_plan():
            resp = await client.get(f"/api/v1/audit/user/{regular_user.id}?org_id=1")
        assert resp.status_code == 401

    async def test_cross_org_target_is_404(self, db, client, other_org, user_role):
        """An admin of org 1 cannot read a user who only belongs to org 2."""
        outsider = User(
            id=99, username="outsider", first_name="Out", last_name="Sider",
            email="out@sider.com", password="x", user_uuid="user_outsider",
            creation_date=str(datetime.now()), update_date=str(datetime.now()),
        )
        db.add(outsider)
        await db.commit()
        db.add(UserOrganization(
            user_id=99, org_id=other_org.id, role_id=user_role.id,
            creation_date=str(datetime.now()), update_date=str(datetime.now()),
        ))
        await db.commit()
        with _bypass_plan():
            resp = await client.get("/api/v1/audit/user/99?org_id=1")
        assert resp.status_code == 404


class TestUsersSummary:
    async def test_summary_rows(self, client, regular_user, seed_activity):
        with _bypass_plan():
            resp = await client.get(
                f"/api/v1/audit/users/summary?org_id=1&user_ids={regular_user.id}"
            )
        assert resp.status_code == 200
        rows = resp.json()["data"]
        assert len(rows) == 1
        assert rows[0]["courses_enrolled"] == 1
        assert rows[0]["certificates_earned"] == 1

    async def test_summary_requires_user_ids(self, client):
        with _bypass_plan():
            resp = await client.get("/api/v1/audit/users/summary?org_id=1")
        assert resp.status_code == 400


class TestExport:
    async def test_export_json(self, client, regular_user, seed_activity):
        with _bypass_plan():
            resp = await client.get(
                f"/api/v1/audit/export?org_id=1&user_ids={regular_user.id}&format=json"
            )
        assert resp.status_code == 200
        assert len(resp.json()["data"]) == 1

    async def test_export_csv(self, client, regular_user, seed_activity):
        with _bypass_plan():
            resp = await client.get(
                f"/api/v1/audit/export?org_id=1&user_ids={regular_user.id}&format=csv"
            )
        assert resp.status_code == 200
        assert resp.headers["content-type"].startswith("text/csv")
        assert "connection" in resp.text  # the connection row is present

    async def test_export_rejects_bad_format(self, client, regular_user):
        with _bypass_plan():
            resp = await client.get(
                f"/api/v1/audit/export?org_id=1&user_ids={regular_user.id}&format=xml"
            )
        assert resp.status_code == 400


@pytest.fixture
async def seed_rich(db: AsyncSession, org, course, chapter, activity, regular_user):
    """Seed assignment (+ task submission), code submission and community activity."""
    from src.db.courses.assignments import (
        Assignment, AssignmentUserSubmission, AssignmentTaskSubmission,
        AssignmentUserSubmissionStatus, AssignmentTaskTypeEnum, GradingTypeEnum,
    )
    from src.db.code_submissions import CodeSubmission
    from src.db.communities.communities import Community
    from src.db.communities.discussions import Discussion
    from src.db.communities.discussion_comments import DiscussionComment

    assignment = Assignment(
        id=1, title="Final", description="d", due_date="2026-01-01",
        grading_type=GradingTypeEnum.NUMERIC, max_grade_value=100,
        assignment_uuid="assignment_test", org_id=org.id, course_id=course.id,
        chapter_id=chapter.id, activity_id=activity.id,
        creation_date=str(datetime.now()), update_date=str(datetime.now()),
    )
    db.add(assignment)
    await db.commit()
    db.add(AssignmentUserSubmission(
        assignmentusersubmission_uuid="aus_1",
        submission_status=AssignmentUserSubmissionStatus.GRADED, grade=88,
        overall_feedback="great", attempt_number=1, user_id=regular_user.id,
        assignment_id=assignment.id,
        creation_date=str(datetime.now()), update_date=str(datetime.now()),
    ))
    db.add(AssignmentTaskSubmission(
        assignment_task_submission_uuid="ats_1", task_submission={"a": 1}, grade=88,
        task_submission_grade_feedback="ok", manually_graded=False,
        assignment_type=AssignmentTaskTypeEnum.QUIZ, user_id=regular_user.id,
        activity_id=activity.id, course_id=course.id, chapter_id=chapter.id,
        assignment_task_id=1,
        creation_date=str(datetime.now()), update_date=str(datetime.now()),
    ))
    db.add(CodeSubmission(
        submission_uuid="cs_1", user_id=regular_user.id,
        activity_uuid=activity.activity_uuid, block_id="b1", language_id=71,
        source_code="print(1)", results={}, passed=True, total_tests=3, passed_tests=3,
        execution_time_ms=12,
    ))
    community = Community(
        id=1, name="C", description="d", org_id=org.id, community_uuid="comm_1",
        creation_date=str(datetime.now()), update_date=str(datetime.now()),
    )
    db.add(community)
    await db.commit()
    discussion = Discussion(
        id=1, title="Q?", content="c", community_id=community.id, org_id=org.id,
        author_id=regular_user.id, discussion_uuid="disc_1",
        creation_date=str(datetime.now()), update_date=str(datetime.now()),
    )
    db.add(discussion)
    await db.commit()
    db.add(DiscussionComment(
        content="answer", discussion_id=discussion.id, author_id=regular_user.id,
        comment_uuid="cmt_1",
        creation_date=str(datetime.now()), update_date=str(datetime.now()),
    ))
    await db.commit()
    return regular_user


class TestDossierRichSections:
    async def test_assignments_code_community_populated(self, client, regular_user, seed_rich):
        with _bypass_plan():
            resp = await client.get(f"/api/v1/audit/user/{regular_user.id}?org_id=1")
        assert resp.status_code == 200
        body = resp.json()
        assert len(body["assignments"]) == 1
        assert body["assignments"][0]["grade"] == 88
        assert len(body["assignments"][0]["tasks"]) == 1
        assert len(body["code_submissions"]) == 1
        assert body["community"]["discussions_count"] == 1
        assert body["community"]["comments_count"] == 1
        assert body["summary"]["avg_grade"] == 88


class TestBehaviorEnrichment:
    async def test_behavior_fetcher_runs_when_configured(self, client, regular_user, seed_activity):
        """A configured read client populates the behavior sections."""
        class _FakeResp:
            def raise_for_status(self): pass
            def json(self): return {"data": [{"total_seconds": 120}]}

        class _FakeClient:
            async def post(self, *a, **k): return _FakeResp()

        with _bypass_plan(), patch("src.routers.audit._get_read_client", return_value=_FakeClient()):
            resp = await client.get(f"/api/v1/audit/user/{regular_user.id}?org_id=1")
        assert resp.status_code == 200
        assert resp.json()["behavior"]["user_time_total"] == [{"total_seconds": 120}]


class TestParamValidation:
    async def test_invalid_days(self, client, regular_user):
        with _bypass_plan():
            resp = await client.get(f"/api/v1/audit/user/{regular_user.id}?org_id=1&days=abc")
        assert resp.status_code == 400

    async def test_too_many_users(self, client):
        ids = ",".join(str(i) for i in range(1, 502))
        with _bypass_plan():
            resp = await client.get(f"/api/v1/audit/users/summary?org_id=1&user_ids={ids}")
        assert resp.status_code == 400

    async def test_export_requires_org_members(self, client):
        with _bypass_plan():
            resp = await client.get("/api/v1/audit/export?org_id=1&user_ids=99999&format=json")
        assert resp.status_code == 404


class TestRequestContext:
    def test_extract_request_context(self):
        from src.services.audit.audit import extract_request_context

        class _Req:
            headers = {"user-agent": "UA/1.0"}
            client = type("C", (), {"host": "1.2.3.4"})()

        ip, ua = extract_request_context(_Req())
        assert ua == "UA/1.0"
        assert ip  # resolved to some value
        assert extract_request_context(None) == (None, None)


class TestRecordAuditEvent:
    async def test_record_writes_durable_row(self, engine, db):
        """record_audit_event commits an isolated row via the session factory."""
        from sqlalchemy.ext.asyncio import async_sessionmaker
        factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

        with patch("src.core.events.database._async_session_factory", factory):
            from src.services.audit.audit import record_audit_event
            await record_audit_event(
                event_type=UserAuditEventType.COURSE_ENROLLED,
                user_id=7,
                org_id=1,
                target_uuid="course_x",
                metadata={"course_name": "X"},
            )

        rows = (await db.execute(
            select(UserAuditEvent).where(UserAuditEvent.user_id == 7)
        )).scalars().all()
        assert len(rows) == 1
        assert rows[0].event_type == UserAuditEventType.COURSE_ENROLLED
        assert rows[0].target_uuid == "course_x"

    async def test_record_ignores_anonymous(self, engine, db):
        from sqlalchemy.ext.asyncio import async_sessionmaker
        factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
        with patch("src.core.events.database._async_session_factory", factory):
            from src.services.audit.audit import record_audit_event
            await record_audit_event(event_type=UserAuditEventType.LOGIN, user_id=0)
        rows = (await db.execute(select(UserAuditEvent))).scalars().all()
        assert len(rows) == 0

    async def test_record_swallows_errors(self):
        """A write failure is logged, never raised — auditing must not break the action."""
        def _boom():
            raise RuntimeError("db down")

        with patch("src.core.events.database._async_session_factory", _boom):
            from src.services.audit.audit import record_audit_event
            # Must not raise despite the factory blowing up.
            await record_audit_event(event_type=UserAuditEventType.LOGIN, user_id=5)


class TestExtractContextFallbacks:
    def test_falls_back_when_client_ip_raises(self):
        from src.services.audit.audit import extract_request_context

        class _Req:
            headers = {"user-agent": "UA"}
            client = type("C", (), {"host": "9.9.9.9"})()

        with patch("src.services.security.rate_limiting.get_client_ip", side_effect=ValueError):
            ip, ua = extract_request_context(_Req())
        assert ip == "9.9.9.9"
        assert ua == "UA"

    def test_user_agent_exception_falls_back_to_none(self):
        from src.services.audit.audit import extract_request_context

        class _BadHeaders:
            def get(self, *a, **k):
                raise RuntimeError("boom")

        class _Req:
            headers = _BadHeaders()
            client = None

        ip, ua = extract_request_context(_Req())
        assert ua is None
