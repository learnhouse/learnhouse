"""Fixes from the MCP security review that sit outside the tools themselves:
a refused role escalation must not linger on the session, landing links must
not hide a script scheme, and approval prompts name what a call grants."""

# Fixtures imported from the other tool tests are used as test arguments.
# ruff: noqa: F811

from __future__ import annotations

import pytest
from sqlmodel import select

from src.db.roles import Role
from src.services.ai.tools.targets import describe_target
from src.services.landing.schema import check_href
from src.tests.conftest import USER_RIGHTS
from src.tests.services.ai_tools.test_people_org import (  # noqa: F401
    _ctx,
    call,
    denied,
    environment,
    fake_redis,
    registry,
    setup,
)


async def test_refused_role_escalation_is_not_saved_by_a_later_commit(registry, db, org, regular_user, setup):
    # The learner may update roles, but holds no users.action_delete to hand out.
    rights = USER_RIGHTS.model_dump()
    rights["roles"]["action_update"] = True
    learner_role = (await db.execute(select(Role).where(Role.id == 4))).scalars().first()
    learner_role.rights = rights
    db.add(learner_role)
    await db.commit()

    out = await call(
        registry, "update_role", {"role_uuid": "role_reviewer", "rights": {"users": {"action_delete": True}}},
        _ctx(db, org, regular_user, approved=True),
    )
    assert "don't have this permission" in denied(out, "http_403")
    # An agent running more tools on the same session commits later.
    await db.commit()
    row = (await db.execute(select(Role).where(Role.role_uuid == "role_reviewer"))).scalars().first()
    await db.refresh(row)
    assert not (row.rights.get("users") or {}).get("action_delete")


@pytest.mark.parametrize(
    "link",
    ["javascript:alert(1)", " JavaScript:x", "java\tscript:x", "\x01javascript:x", "jav\nascript:x", "da\rta:text/html,x"],
)
def test_landing_links_cannot_hide_a_script_scheme(link):
    with pytest.raises(ValueError):
        check_href(link)


def test_landing_links_keep_ordinary_urls():
    assert [check_href(v) for v in ("https://example.com/a", "/courses", "mailto:hi@example.com", "#pricing")]


async def test_approval_target_names_the_role_being_granted(db, org, admin_user, setup):
    target = await describe_target(
        "set_member_role", {"member": admin_user.user_uuid, "role_uuid": "role_reviewer"}, "member", org.id, db,
    )
    assert target["kind"] == "user"
    assert target["related"] == {"role_reviewer": "Reviewer"}


@pytest.mark.parametrize("pattern", ["(a+)+$", "(x*)*", "([a-z]+){2,}", r"(\w+\s?)*$"])
def test_regex_answers_that_repeat_a_repeating_group_are_refused(pattern):
    from pydantic import ValidationError

    from src.services.ai.tools.assignments import ShortAnswerContent

    with pytest.raises(ValidationError, match="repeats a group"):
        ShortAnswerContent(type="short_answer", prompt="?", accepted_answers=[pattern], match_mode="regex")


@pytest.mark.parametrize("pattern", ["colou?r", "(cat|dog)s?", r"\d+(\.\d+)?", "(ab)+", "^hello world$"])
def test_ordinary_regex_answers_still_work(pattern):
    from src.services.ai.tools.assignments import ShortAnswerContent

    ShortAnswerContent(type="short_answer", prompt="?", accepted_answers=[pattern], match_mode="regex")


@pytest.mark.parametrize(
    "node, attrs",
    [
        ({"type": "blockUser", "attrs": {"user_id": 1}}, {"user_id": 2}),
        ({"type": "blockLibrary", "attrs": {"resourceUuid": "course_a", "display": "card"}}, {"resourceUuid": "course_b"}),
    ],
)
def test_what_reference_blocks_point_at_stays_as_the_editor_set_it(node, attrs):
    from src.services.ai.tools import doc_ops

    ed = doc_ops.Editor({"type": "doc", "content": [node]})
    with pytest.raises(doc_ops.DocError, match="cannot be changed here"):
        ed.set_attrs([0], attrs)
