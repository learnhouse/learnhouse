"""AI grading through the assignment tools: the private rubric and mode on
update_assignment, what get_assignment shows teachers, and each submission's
AI grade state in list_submissions."""

# ruff: noqa: F811

from datetime import datetime

from src.db.courses.assignment_ai_grades import AssignmentAIGrade
from src.db.courses.assignments import AIGradingModeEnum, Assignment
from src.db.user_organizations import UserOrganization
from src.db.users import User
from src.services.ai.tools import assignments
from src.tests.services.ai_tools.test_grading import (  # noqa: F401
    _hand_in,
    call,
    ctx_for,
    ok,
    quiet_services,
    registry,
)

NOW = str(datetime.now())
RUBRIC = "Full credit: names the resolver and the root servers. Half: one of them."


async def test_rubric_and_mode_are_private_settings(registry, db, org, admin_user, regular_user, assignment):
    out = ok(await call(registry, ctx_for(db, org, admin_user), "update_assignment", {
        "assignment_uuid": "assignment_test", "ai_grading_instructions": RUBRIC, "ai_grading_mode": "suggest",
    }))
    assert out["ai_grading"]["mode"] == "suggest" and out["ai_grading"]["has_rubric"] is True
    assert "private" in out["ai_grading"]["note"]
    assert "AI grading rubric" in out["summary"] and "AI grading mode" in out["summary"]
    row = await db.get(Assignment, assignment.id)
    await db.refresh(row)
    assert row.ai_grading_instructions == RUBRIC and row.ai_grading_mode == AIGradingModeEnum.SUGGEST
    assert RUBRIC not in (row.description or "")

    ok(await call(registry, ctx_for(db, org, admin_user), "update_assignment", {
        "assignment_uuid": "assignment_test", "ai_grading_mode": "auto",
    }))
    await db.refresh(row)
    assert row.ai_grading_mode == AIGradingModeEnum.AUTO

    # Teachers read it back; learners never get the rubric.
    seen = ok(await call(registry, ctx_for(db, org, admin_user), "get_assignment", {"assignment_uuid": "assignment_test"}))
    assert seen["ai_grading"] == {"mode": "auto", "rubric": RUBRIC}
    learner = await call(registry, ctx_for(db, org, regular_user), "get_assignment", {"assignment_uuid": "assignment_test"})
    if learner.status == "executed":
        assert "ai_grading" not in learner.result and RUBRIC not in repr(learner.result)

    cleared = ok(await call(registry, ctx_for(db, org, admin_user), "update_assignment", {
        "assignment_uuid": "assignment_test", "ai_grading_instructions": "",
    }))
    assert cleared["ai_grading"]["has_rubric"] is False and cleared["ai_grading"]["mode"] == "auto"

    plain = ok(await call(registry, ctx_for(db, org, admin_user), "update_assignment", {
        "assignment_uuid": "assignment_test", "title": "Renamed",
    }))
    assert "ai_grading" not in plain


async def test_bad_mode_is_refused(registry, db, org, admin_user, assignment):
    out = await call(registry, ctx_for(db, org, admin_user), "update_assignment", {
        "assignment_uuid": "assignment_test", "ai_grading_mode": "sometimes",
    })
    assert out.denied_code == "invalid_args"


def test_update_summaries_name_ai_grading():
    spec = next(s for s in assignments.SPECS if s.name == "update_assignment")
    P = assignments.UpdateAssignmentParams
    assert spec.summarize(P(assignment_uuid="a", ai_grading_instructions=RUBRIC)) == "Set the AI grading rubric"
    assert spec.summarize(P(assignment_uuid="a", ai_grading_instructions=" ")) == "Remove the AI grading rubric"
    assert spec.summarize(P(assignment_uuid="a", ai_grading_mode="auto")) == "AI grading: Auto"
    assert spec.summarize(
        P(assignment_uuid="a", ai_grading_instructions=RUBRIC, ai_grading_mode="suggest")
    ) == "Set the AI grading rubric; AI grading: Suggest"
    assert spec.summarize(P(assignment_uuid="a", title="T", ai_grading_mode="off")) == (
        "Update assignment: title, AI grading mode"
    )
    assert "never in description" in spec.description


async def test_list_submissions_shows_ai_grade_state(registry, db, org, admin_user, regular_user, assignment):
    others = []
    for i, email in ((21, "a@x.test"), (22, "b@x.test"), (23, "c@x.test"), (24, "d@x.test")):
        db.add(User(id=i, username=f"l{i}", first_name="L", last_name=str(i), email=email, password="x",
                    user_uuid=f"user_l{i}", creation_date=NOW, update_date=NOW))
        others.append(i)
    await db.commit()
    for i in others:
        db.add(UserOrganization(user_id=i, org_id=org.id, role_id=4, creation_date=NOW, update_date=NOW))
        await _hand_in(db, assignment, i, uuid=f"aus_{i}")
    for i, status in ((21, "DRAFT"), (22, "APPLIED"), (23, "FAILED"), (24, "DISCARDED")):
        db.add(AssignmentAIGrade(assignment_ai_grade_uuid=f"aig_{i}", assignment_id=assignment.id, user_id=i,
                                 org_id=org.id, status=status, creation_date=NOW, update_date=NOW))
    await db.commit()
    await _hand_in(db, assignment, regular_user.id, uuid="aus_none")

    out = ok(await call(registry, ctx_for(db, org, admin_user), "list_submissions", {"assignment_uuid": "assignment_test"}))
    by_user = {item["member"]["uuid"]: item["ai_grade"] for item in out["items"]}
    assert by_user == {
        "user_l21": "draft", "user_l22": "applied", "user_l23": "failed", "user_l24": "none", "user_regular": "none",
    }

    # A learner sees only their own row, without the teacher-only AI state.
    mine = await call(registry, ctx_for(db, org, regular_user), "list_submissions", {"assignment_uuid": "assignment_test"})
    if mine.status == "executed":
        assert all("ai_grade" not in item for item in mine.result["items"])
