"""Tests for the per-student audit router + dossier service + durable write path."""
from datetime import datetime, timezone
from unittest.mock import patch, AsyncMock

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
        Assignment, AssignmentTask, AssignmentUserSubmission, AssignmentTaskSubmission,
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
    # A real task row: the question bank is what makes the stored answer readable.
    task = AssignmentTask(
        id=1, title="Chapter 1 quiz", description="d", hint="",
        assignment_type=AssignmentTaskTypeEnum.QUIZ, max_grade_value=100,
        contents={"questions": [{
            "questionUUID": "question_1",
            "questionText": "What is 2 + 2?",
            "options": [
                {"optionUUID": "option_a", "text": "Three",
                 "assigned_right_answer": False},
                {"optionUUID": "option_b", "text": "Four",
                 "assigned_right_answer": True},
            ],
        }]},
        assignment_task_uuid="assignmenttask_1", assignment_id=assignment.id,
        org_id=org.id, course_id=course.id, chapter_id=chapter.id,
        activity_id=activity.id,
        creation_date=str(datetime.now()), update_date=str(datetime.now()),
    )
    db.add(task)
    await db.commit()
    db.add(AssignmentUserSubmission(
        assignmentusersubmission_uuid="aus_1",
        submission_status=AssignmentUserSubmissionStatus.GRADED, grade=88,
        overall_feedback="great", attempt_number=1, user_id=regular_user.id,
        assignment_id=assignment.id,
        creation_date=str(datetime.now()), update_date=str(datetime.now()),
    ))
    db.add(AssignmentTaskSubmission(
        assignment_task_submission_uuid="ats_1",
        task_submission={"questions": [], "submissions": [
            {"questionUUID": "question_1", "optionUUID": "option_a", "answer": False},
            {"questionUUID": "question_1", "optionUUID": "option_b", "answer": True},
        ]},
        grade=88,
        task_submission_grade_feedback="ok", manually_graded=False,
        assignment_type=AssignmentTaskTypeEnum.QUIZ, user_id=regular_user.id,
        activity_id=activity.id, course_id=course.id, chapter_id=chapter.id,
        assignment_task_id=task.id,
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

    async def test_assignment_carries_readable_answers(self, client, regular_user, seed_rich):
        """The stored blob of UUIDs comes back as question text and chosen options."""
        with _bypass_plan():
            resp = await client.get(f"/api/v1/audit/user/{regular_user.id}?org_id=1")
        a = resp.json()["assignments"][0]
        # The max is summed from the tasks — it is not stored on the assignment, which
        # is why the UI used to hardcode "/100".
        assert a["max_grade_value"] == 100
        assert a["grade_display"] == "88/100"
        assert a["course_name"] and a["activity_name"]
        assert a["tasks_total"] == 1 and a["tasks_submitted"] == 1

        tk = a["tasks"][0]
        assert tk["title"] == "Chapter 1 quiz"
        assert tk["type_label"] == "Quiz"
        assert tk["max_grade"] == 100
        answer = tk["answer"]
        assert answer["kind"] == "quiz"
        assert answer["correct_count"] == 1 and answer["total_count"] == 1
        item = answer["items"][0]
        assert item["prompt"] == "What is 2 + 2?"
        assert item["answer_text"] == "B. Four"
        assert item["correct"] is True
        assert item["options"][0]["letter"] == "A"
        assert item["options"][1]["selected"] is True
        # Raw payload withheld by default, but attested.
        assert "raw_answer" not in tk
        assert tk["answer_digest"].startswith("sha256:")

    async def test_include_raw_returns_original_submission(self, client, regular_user, seed_rich):
        with _bypass_plan():
            resp = await client.get(
                f"/api/v1/audit/user/{regular_user.id}?org_id=1&include_raw=true"
            )
        tk = resp.json()["assignments"][0]["tasks"][0]
        assert tk["raw_answer"]["submissions"][1] == {
            "questionUUID": "question_1", "optionUUID": "option_b", "answer": True,
        }

    async def test_task_submissions_scoped_by_assignment_task_id(
        self, db, client, regular_user, seed_rich, org
    ):
        """A second org's tasks must not leak in through the parent-assignment lookup.

        Regression guard: submissions used to be matched on (course_id, activity_id)
        with no org filter at all, so any assignment sharing an activity id swapped in
        another org's answers.
        """
        from src.db.organizations import Organization
        from src.db.courses.courses import Course
        from src.db.courses.assignments import (
            Assignment, AssignmentTask, AssignmentTaskSubmission,
            AssignmentTaskTypeEnum, GradingTypeEnum,
        )

        other_org = Organization(
            name="Other", description="", email="o@o.com", slug="other",
            logo_image="", thumbnail_image="", org_uuid="org_other",
            creation_date=str(datetime.now()), update_date=str(datetime.now()),
        )
        db.add(other_org)
        await db.commit()
        other_course = Course(
            name="Other course", description="", public=False, published=False,
            open_to_contributors=False, course_uuid="course_other",
            org_id=other_org.id,
            creation_date=str(datetime.now()), update_date=str(datetime.now()),
        )
        db.add(other_course)
        await db.commit()
        other_assignment = Assignment(
            title="Other org final", description="", due_date="2026-01-01",
            grading_type=GradingTypeEnum.NUMERIC, max_grade_value=100,
            assignment_uuid="assignment_other", org_id=other_org.id,
            course_id=other_course.id, chapter_id=1, activity_id=1,
            creation_date=str(datetime.now()), update_date=str(datetime.now()),
        )
        db.add(other_assignment)
        await db.commit()
        other_task = AssignmentTask(
            title="Other org task", description="", hint="",
            assignment_type=AssignmentTaskTypeEnum.QUIZ, max_grade_value=100,
            contents={"questions": [{
                "questionUUID": "q_other", "questionText": "Other org secret question?",
                "options": [{"optionUUID": "o_other", "text": "Leaked",
                             "assigned_right_answer": True}],
            }]},
            assignment_task_uuid="assignmenttask_other",
            assignment_id=other_assignment.id, org_id=other_org.id,
            course_id=other_course.id, chapter_id=1, activity_id=1,
            creation_date=str(datetime.now()), update_date=str(datetime.now()),
        )
        db.add(other_task)
        await db.commit()
        db.add(AssignmentTaskSubmission(
            assignment_task_submission_uuid="ats_other",
            task_submission={"submissions": [
                {"questionUUID": "q_other", "optionUUID": "o_other", "answer": True},
            ]},
            grade=100, task_submission_grade_feedback="", manually_graded=False,
            assignment_type=AssignmentTaskTypeEnum.QUIZ, user_id=regular_user.id,
            activity_id=1, course_id=other_course.id, chapter_id=1,
            assignment_task_id=other_task.id,
            creation_date=str(datetime.now()), update_date=str(datetime.now()),
        ))
        await db.commit()

        with _bypass_plan():
            resp = await client.get(f"/api/v1/audit/user/{regular_user.id}?org_id={org.id}")
        assert resp.status_code == 200
        body = resp.text
        for leaked in ("Other org final", "Other org task", "Other org secret question?", "Leaked"):
            assert leaked not in body
        assert len(resp.json()["assignments"][0]["tasks"]) == 1

    async def test_unsubmitted_task_appears_as_gap(self, db, client, regular_user, seed_rich, course, chapter, activity, org):
        """A task the student never attempted is an audit fact, not an omission."""
        from src.db.courses.assignments import AssignmentTask, AssignmentTaskTypeEnum

        db.add(AssignmentTask(
            title="Essay", description="", hint="",
            assignment_type=AssignmentTaskTypeEnum.FILE_SUBMISSION, max_grade_value=50,
            contents={}, assignment_task_uuid="assignmenttask_2", assignment_id=1,
            org_id=org.id, course_id=course.id, chapter_id=chapter.id,
            activity_id=activity.id,
            creation_date=str(datetime.now()), update_date=str(datetime.now()),
        ))
        await db.commit()

        with _bypass_plan():
            resp = await client.get(f"/api/v1/audit/user/{regular_user.id}?org_id=1")
        a = resp.json()["assignments"][0]
        assert a["tasks_total"] == 2 and a["tasks_submitted"] == 1
        assert a["max_grade_value"] == 150
        gap = a["tasks"][1]
        assert gap["submitted"] is False
        assert gap["answer"] is None
        assert gap["type_label"] == "File upload"

    async def test_code_submission_resolves_activity_name(self, client, regular_user, seed_rich, activity):
        with _bypass_plan():
            resp = await client.get(f"/api/v1/audit/user/{regular_user.id}?org_id=1")
        cs = resp.json()["code_submissions"][0]
        assert cs["activity_name"] == activity.name
        assert cs["language"] == "Python 3"
        assert cs["tests_summary"] == "3/3"

    async def test_comment_carries_parent_discussion_title(self, client, regular_user, seed_rich):
        with _bypass_plan():
            resp = await client.get(f"/api/v1/audit/user/{regular_user.id}?org_id=1")
        comment = resp.json()["community"]["comments"][0]
        assert comment["discussion_title"] == "Q?"
        assert comment["community_name"] == "C"

    async def test_certificate_exposes_credential_id(self, client, regular_user, seed_activity):
        with _bypass_plan():
            resp = await client.get(f"/api/v1/audit/user/{regular_user.id}?org_id=1")
        assert resp.json()["certificates"][0]["credential_id"] == "usercert_test"

    async def test_connection_event_is_humanized(self, db, client, regular_user):
        db.add(UserAuditEvent(
            event_type=UserAuditEventType.LOGIN,
            user_id=regular_user.id, org_id=None, ip="10.0.0.1",
            user_agent=(
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            ),
            audit_metadata={"method": "password"},
            created_at=datetime.now(timezone.utc),
        ))
        await db.commit()

        with _bypass_plan():
            resp = await client.get(f"/api/v1/audit/user/{regular_user.id}?org_id=1")
        c = resp.json()["connections"][0]
        assert c["event_label"] == "Signed in"
        assert c["device"] == "Chrome on macOS"
        assert c["method"] == "password"

    async def test_malformed_task_contents_does_not_break_dossier(self, db, client, regular_user, seed_rich):
        """Years-old schemaless JSON must degrade to raw fields, never 500."""
        from src.db.courses.assignments import AssignmentTask

        task = (await db.execute(select(AssignmentTask).where(AssignmentTask.id == 1))).scalars().first()
        task.contents = {"questions": "not-a-list"}
        db.add(task)
        await db.commit()

        with _bypass_plan():
            resp = await client.get(f"/api/v1/audit/user/{regular_user.id}?org_id=1")
        assert resp.status_code == 200
        answer = resp.json()["assignments"][0]["tasks"][0]["answer"]
        # The snapshot in the submission is empty here, so there is nothing to render
        # from — but the payload still describes itself instead of erroring.
        assert answer["kind"] in ("quiz", "raw")


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


class TestPlanAndTargetGuards:
    async def test_plan_gate_blocks_low_plan(self, client, regular_user):
        """SaaS mode + insufficient plan → 403."""
        with patch("src.security.features_utils.plan_check._check_mode_bypass", return_value=None), \
             patch("src.routers.audit.get_org_plan", new_callable=AsyncMock, return_value="free"), \
             patch("src.routers.audit.plan_meets_requirement", return_value=False):
            resp = await client.get(f"/api/v1/audit/user/{regular_user.id}?org_id=1")
        assert resp.status_code == 403

    async def test_plan_gate_allows_enterprise(self, client, regular_user, seed_activity):
        with patch("src.security.features_utils.plan_check._check_mode_bypass", return_value=None), \
             patch("src.routers.audit.get_org_plan", new_callable=AsyncMock, return_value="enterprise"), \
             patch("src.routers.audit.plan_meets_requirement", return_value=True):
            resp = await client.get(f"/api/v1/audit/user/{regular_user.id}?org_id=1")
        assert resp.status_code == 200

    async def test_superadmin_target_bypasses_membership(self, client, regular_user):
        """A superadmin target passes the in-org check without a membership row."""
        with _bypass_plan(), patch("src.routers.audit.is_user_superadmin", new_callable=AsyncMock, return_value=True):
            resp = await client.get(f"/api/v1/audit/user/{regular_user.id}?org_id=1")
        assert resp.status_code == 200

    async def test_valid_days_param(self, client, regular_user, seed_activity):
        with _bypass_plan():
            resp = await client.get(f"/api/v1/audit/user/{regular_user.id}?org_id=1&days=30")
        assert resp.status_code == 200

    async def test_invalid_user_ids_non_int(self, client):
        with _bypass_plan():
            resp = await client.get("/api/v1/audit/users/summary?org_id=1&user_ids=abc")
        assert resp.status_code == 400

    async def test_dossier_404_when_empty(self, client, regular_user):
        with _bypass_plan(), patch("src.routers.audit.build_user_dossier", new_callable=AsyncMock, return_value={}):
            resp = await client.get(f"/api/v1/audit/user/{regular_user.id}?org_id=1")
        assert resp.status_code == 404


class TestBehaviorFetcherEdgeCases:
    async def test_query_failure_yields_empty_section(self, client, regular_user, seed_activity):
        """A failing Tinybird query degrades that section to [] instead of erroring."""
        class _BoomClient:
            async def post(self, *a, **k):
                raise RuntimeError("tinybird down")

        with _bypass_plan(), patch("src.routers.audit._get_read_client", return_value=_BoomClient()):
            resp = await client.get(f"/api/v1/audit/user/{regular_user.id}?org_id=1")
        assert resp.status_code == 200
        assert resp.json()["behavior"]["user_time_total"] == []

    def test_build_user_sql_rejects_non_int(self):
        from src.routers.audit import _build_user_sql
        import pytest as _pytest
        from fastapi import HTTPException
        with _pytest.raises(HTTPException):
            _build_user_sql("SELECT {user_id}", 1, "not-int", 30)  # type: ignore[arg-type]


class TestExportCsvRows:
    async def test_csv_includes_all_sections(self, client, regular_user, seed_rich):
        with _bypass_plan():
            resp = await client.get(
                f"/api/v1/audit/export?org_id=1&user_ids={regular_user.id}&format=csv"
            )
        assert resp.status_code == 200
        text = resp.text
        for section in ("assignment", "code", "discussion", "comment"):
            assert section in text

    async def test_csv_header_matches_columns(self, client, regular_user, seed_rich):
        from src.routers.audit import _CSV_COLUMNS

        with _bypass_plan():
            resp = await client.get(
                f"/api/v1/audit/export?org_id=1&user_ids={regular_user.id}&format=csv"
            )
        assert resp.text.splitlines()[0] == ",".join(_CSV_COLUMNS)

    async def test_csv_carries_questions_and_answers(self, client, regular_user, seed_rich, activity):
        with _bypass_plan():
            resp = await client.get(
                f"/api/v1/audit/export?org_id=1&user_ids={regular_user.id}&format=csv"
            )
        text = resp.text
        assert "assignment_task" in text and "assignment_answer" in text
        assert "What is 2 + 2?" in text
        assert "B. Four" in text
        # The code row names the activity instead of printing its uuid.
        assert activity.name in text
        assert activity.activity_uuid not in text

    async def test_csv_escapes_formula_injection_in_answers(self, db, client, regular_user, seed_rich):
        """Question and answer columns carry free-form text — the likeliest vector."""
        from src.db.courses.assignments import AssignmentTask

        task = (await db.execute(
            select(AssignmentTask).where(AssignmentTask.id == 1)
        )).scalars().first()
        task.contents = {"questions": [{
            "questionUUID": "question_1",
            "questionText": "=cmd|'/c calc'!A1",
            "options": [{"optionUUID": "option_b", "text": "Four",
                         "assigned_right_answer": True}],
        }]}
        db.add(task)
        await db.commit()

        with _bypass_plan():
            resp = await client.get(
                f"/api/v1/audit/export?org_id=1&user_ids={regular_user.id}&format=csv"
            )
        assert "=cmd|" in resp.text          # the question text made it through
        assert ",=cmd|" not in resp.text     # ...but never as a live formula
        assert "'=cmd|" in resp.text

    def test_behavior_sections_reach_the_csv(self):
        """The Tinybird sections are part of the record too, resolved to names."""
        from src.routers.audit import _dossier_to_csv_rows

        rows = list(_dossier_to_csv_rows({
            "user": {"id": 1, "username": "u", "email": "u@e.com"},
            "behavior": {
                "user_time_by_course": [
                    {"course_name": "Algebra", "total_seconds": 90},
                    {"course_uuid": "course_unresolved", "total_seconds": 5},
                ],
                "user_searches": [{"query": "pythagoras", "count": 3}],
            },
        }))
        assert [r["section"] for r in rows] == [
            "behavior_course", "behavior_course", "behavior_search",
        ]
        assert rows[0]["course"] == "Algebra"
        assert rows[0]["detail"] == "90s"
        # Falls back to the uuid only when the name could not be resolved.
        assert rows[1]["course"] == "course_unresolved"
        assert rows[2]["question"] == "pythagoras"
        assert rows[2]["detail"] == 3

    async def test_every_row_uses_declared_columns(self, seed_rich, db, org, regular_user):
        """csv.DictWriter raises on an unknown key — catch a typo'd kwarg here."""
        from src.routers.audit import _CSV_COLUMNS, _dossier_to_csv_rows
        from src.services.audit.dossier import build_user_dossier

        dossier = await build_user_dossier(db, regular_user.id, org.id)
        rows = list(_dossier_to_csv_rows(dossier))
        assert rows
        for row in rows:
            assert set(row.keys()) <= set(_CSV_COLUMNS)


class TestDossierServiceUnits:
    async def test_dossier_unknown_user_returns_empty(self, db, org):
        from src.services.audit.dossier import build_user_dossier
        assert await build_user_dossier(db, 999999, org.id) == {}

    def test_user_agent_parsing(self):
        from src.services.audit.dossier import _parse_user_agent

        assert _parse_user_agent(None) == {"browser": None, "os": None, "device": None}
        # Edge and Opera both claim to be Chrome, and everything claims to be Safari,
        # so the ladder order is the whole test.
        assert _parse_user_agent("Mozilla/5.0 (Windows NT 10.0) Chrome/1 Edg/1")["device"] == "Edge on Windows"
        assert _parse_user_agent("Mozilla/5.0 (Linux; Android 14) Chrome/1")["device"] == "Chrome on Android"
        assert _parse_user_agent("Mozilla/5.0 (iPhone) Safari/1")["device"] == "Safari on iOS"
        assert _parse_user_agent("curl/8.0")["device"] is None
        assert _parse_user_agent("Firefox/1")["device"] == "Firefox"

    async def test_orphan_submission_survives_a_deleted_task(
        self, db, org, course, chapter, activity, regular_user
    ):
        """Deleting a task must not erase the answers already recorded against it."""
        from src.db.courses.assignments import (
            Assignment, AssignmentTask, AssignmentTaskSubmission, AssignmentUserSubmission,
            AssignmentUserSubmissionStatus, AssignmentTaskTypeEnum, GradingTypeEnum,
        )
        from src.services.audit.dossier import _assignments

        assignment = Assignment(
            title="Final", description="d", due_date="2026-01-01",
            grading_type=GradingTypeEnum.NUMERIC, max_grade_value=100,
            assignment_uuid="assignment_orphan", org_id=org.id, course_id=course.id,
            chapter_id=chapter.id, activity_id=activity.id,
            creation_date=str(datetime.now()), update_date=str(datetime.now()),
        )
        db.add(assignment)
        await db.commit()
        # A live task keeps the assignment non-empty; the orphan points at an id that
        # no AssignmentTask row has.
        db.add(AssignmentTask(
            title="Live task", description="", hint="",
            assignment_type=AssignmentTaskTypeEnum.QUIZ, max_grade_value=10,
            contents={}, assignment_task_uuid="assignmenttask_live",
            assignment_id=assignment.id, org_id=org.id, course_id=course.id,
            chapter_id=chapter.id, activity_id=activity.id,
            creation_date=str(datetime.now()), update_date=str(datetime.now()),
        ))
        db.add(AssignmentUserSubmission(
            assignmentusersubmission_uuid="aus_orphan",
            submission_status=AssignmentUserSubmissionStatus.GRADED, grade=5,
            overall_feedback="", attempt_number=1, user_id=regular_user.id,
            assignment_id=assignment.id,
            creation_date=str(datetime.now()), update_date=str(datetime.now()),
        ))
        db.add(AssignmentTaskSubmission(
            assignment_task_submission_uuid="ats_orphan",
            task_submission={"answer": "written before the task was deleted"},
            grade=5, task_submission_grade_feedback="", manually_graded=False,
            assignment_type=AssignmentTaskTypeEnum.SHORT_ANSWER, user_id=regular_user.id,
            activity_id=activity.id, course_id=course.id, chapter_id=chapter.id,
            assignment_task_id=987654,
            creation_date=str(datetime.now()), update_date=str(datetime.now()),
        ))
        await db.commit()

        rows = await _assignments(db, regular_user.id, org.id)
        tasks = rows[0]["tasks"]
        assert len(tasks) == 2
        orphan = tasks[1]
        assert orphan["title"] is None and orphan["submitted"] is True
        assert orphan["type_label"] == "Short answer"
        assert "written before the task was deleted" in str(orphan["answer"])

    async def test_comment_on_another_orgs_discussion_is_dropped(
        self, db, org, other_org, regular_user
    ):
        from src.db.communities.communities import Community
        from src.db.communities.discussions import Discussion
        from src.db.communities.discussion_comments import DiscussionComment
        from src.services.audit.dossier import _community

        community = Community(
            name="C", description="d", org_id=other_org.id, community_uuid="comm_other",
            creation_date=str(datetime.now()), update_date=str(datetime.now()),
        )
        db.add(community)
        await db.commit()
        foreign = Discussion(
            title="Elsewhere", content=None, community_id=community.id,
            org_id=other_org.id, author_id=regular_user.id, discussion_uuid="disc_other",
            creation_date=str(datetime.now()), update_date=str(datetime.now()),
        )
        db.add(foreign)
        await db.commit()
        db.add(DiscussionComment(
            content="hidden", discussion_id=foreign.id, author_id=regular_user.id,
            comment_uuid="cmt_other",
            creation_date=str(datetime.now()), update_date=str(datetime.now()),
        ))
        await db.commit()

        out = await _community(db, regular_user.id, org.id)
        assert out["comments"] == [] and out["discussions"] == []

    async def test_discussion_without_content_has_no_excerpt(
        self, db, org, regular_user
    ):
        from src.db.communities.communities import Community
        from src.db.communities.discussions import Discussion
        from src.services.audit.dossier import _community

        community = Community(
            name="C", description="d", org_id=org.id, community_uuid="comm_empty",
            creation_date=str(datetime.now()), update_date=str(datetime.now()),
        )
        db.add(community)
        await db.commit()
        db.add(Discussion(
            title="No body", content=None, community_id=community.id, org_id=org.id,
            author_id=regular_user.id, discussion_uuid="disc_empty",
            creation_date=str(datetime.now()), update_date=str(datetime.now()),
        ))
        await db.commit()

        out = await _community(db, regular_user.id, org.id)
        assert out["discussions"][0]["excerpt"] is None

    async def test_behavior_enrichment_failure_degrades_to_raw_rows(self, db):
        """Analytics is best-effort; it must not take the Postgres dossier with it."""
        from src.services.audit import dossier as dossier_module

        behavior = {"user_time_by_course": [{"course_uuid": "course_test"}]}
        with patch.object(
            dossier_module, "enrich_with_metadata", side_effect=RuntimeError("boom")
        ):
            out = await dossier_module._enrich_behavior(behavior, db)
        assert out["user_time_by_course"] == [{"course_uuid": "course_test"}]

    async def test_behavior_view_events_are_labelled(self, db):
        from src.services.audit.dossier import _enrich_behavior

        out = await _enrich_behavior({"user_views": [
            {"event_name": "course_view"}, {"event_name": "something_else"}, "junk",
        ]}, db)
        assert out["user_views"][0]["label"] == "Course views"
        assert out["user_views"][1]["label"] == "Something else"

    async def test_empty_behavior_is_returned_untouched(self, db):
        from src.services.audit.dossier import _enrich_behavior
        assert await _enrich_behavior({}, db) == {}

    async def test_behavior_fetcher_exception_swallowed(self, db, org, regular_user):
        from src.services.audit.dossier import build_user_dossier

        async def _boom(*a, **k):
            raise RuntimeError("boom")

        dossier = await build_user_dossier(db, regular_user.id, org.id, behavior_fetcher=_boom)
        assert dossier["behavior"] == {}

    async def test_summary_empty_ids(self, db, org):
        from src.services.audit.dossier import build_users_summary
        assert await build_users_summary(db, [], org.id) == []

    async def test_summary_counts_completed_and_skips_unknown(self, db, org, course, regular_user):
        from src.services.audit.dossier import build_users_summary
        db.add(TrailRun(
            data={}, status=StatusEnum.STATUS_COMPLETED, trail_id=1, course_id=course.id,
            org_id=org.id, user_id=regular_user.id,
            creation_date=str(datetime.now()), update_date=str(datetime.now()),
        ))
        await db.commit()
        # 999999 has no User row → skipped (continue branch).
        rows = await build_users_summary(db, [regular_user.id, 999999], org.id)
        assert len(rows) == 1
        assert rows[0]["courses_completed"] == 1


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
