"""Tests for dynamic activity content: rules, variables, rendering, preview."""

from datetime import date, datetime
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException

from src.db.courses.activities import ActivityRead
from src.db.trail_runs import TrailRun
from src.db.trails import Trail
from src.db.usergroup_user import UserGroupUser
from src.db.usergroups import UserGroup
from src.services.courses.activities.access import redact_activity_for_reader
from src.services.courses.activities.activities import get_dynamic_preview
from src.services.courses.activities.dynamic_content import (
    RenderContext,
    evaluate_rules,
    has_dynamic_content,
    interpolate_text,
    render_document,
    strip_dynamic_content,
)
from src.services.courses.activities.dynamic_context import (
    DynamicPreviewRequest,
    PreviewPersona,
    build_render_context,
)


def _ctx(**overrides) -> RenderContext:
    base = dict(
        signed_in=True,
        first_name="ada",
        last_name="Lovelace",
        username="ada",
        role="member",
        group_uuids=frozenset({"usergroup_a"}),
        locale="fr-FR",
        org_name="Test Org",
        course_name="Engines",
        enrolled=True,
        days_enrolled=10,
        progress_completed=1,
        progress_total=4,
        completed_activity_uuids=frozenset({"activity_1"}),
        today=date(2026, 10, 31),
    )
    base.update(overrides)
    return RenderContext(**base)


def _cond(field, op, value=None):
    return {"field": field, "op": op, "value": value}


def _doc(*blocks):
    return {"type": "doc", "content": list(blocks)}


def _p(*inline):
    return {"type": "paragraph", "content": list(inline)}


def _text(text):
    return {"type": "text", "text": text}


def _conditional(rules, *blocks):
    return {"type": "conditionalBlock", "attrs": {"rules": rules}, "content": list(blocks)}


class TestEvaluateRules:
    def test_missing_rules_show_to_everyone(self):
        assert evaluate_rules(None, _ctx()) is True

    def test_empty_group_shows_to_everyone(self):
        assert evaluate_rules({"match": "all", "conditions": []}, _ctx()) is True

    @pytest.mark.parametrize(
        "condition,expected",
        [
            (_cond("user.groups", "contains_any", ["usergroup_a", "x"]), True),
            (_cond("user.groups", "contains_all", ["usergroup_a", "x"]), False),
            (_cond("user.groups", "contains_none", ["x"]), True),
            (_cond("user.role", "in", ["admin", "member"]), True),
            (_cond("user.role", "neq", "member"), False),
            (_cond("user.signed_in", "is_true"), True),
            (_cond("user.locale", "in", ["fr"]), True),
            (_cond("user.locale", "in", ["f"]), False),
            (_cond("course.enrolled", "is_false"), False),
            (_cond("enrollment.days", "gte", 7), True),
            (_cond("progress.percent", "gte", 25), True),
            (_cond("progress.percent", "between", [30, 100]), False),
            (_cond("progress.completed_activities", "contains_any", ["activity_1"]), True),
            (_cond("date.today", "on_or_after", "2026-10-31"), True),
            (_cond("date.today", "before", "2026-10-31"), False),
            (_cond("date.today", "between", ["2026-10-01", "2026-11-01"]), True),
        ],
    )
    def test_conditions(self, condition, expected):
        assert evaluate_rules({"match": "all", "conditions": [condition]}, _ctx()) is expected

    def test_any_and_negate(self):
        rules = {
            "match": "any",
            "conditions": [_cond("user.role", "eq", "admin"), _cond("progress.percent", "gte", 20)],
        }
        assert evaluate_rules(rules, _ctx()) is True
        assert evaluate_rules({**rules, "negate": True}, _ctx()) is False

    def test_nested_group(self):
        rules = {
            "match": "all",
            "conditions": [
                _cond("user.signed_in", "is_true"),
                {"match": "any", "conditions": [_cond("user.role", "eq", "admin")]},
            ],
        }
        assert evaluate_rules(rules, _ctx()) is False
        assert evaluate_rules(rules, _ctx(role="admin")) is True

    @pytest.mark.parametrize(
        "rules",
        [
            "user.role == 'admin'",
            {"match": "all", "conditions": [_cond("user.password", "eq", "x")]},
            {"match": "all", "conditions": [_cond("user.role", "exec", "x")]},
            {"match": "all", "conditions": [_cond("progress.percent", "gte", "50")]},
            {"match": "all", "conditions": "nope"},
        ],
    )
    def test_malformed_rules_hide(self, rules):
        assert evaluate_rules(rules, _ctx()) is False

    def test_depth_limit_hides(self):
        rules: dict = {"match": "all", "conditions": []}
        for _ in range(10):
            rules = {"match": "all", "conditions": [rules]}
        assert evaluate_rules(rules, _ctx()) is False

    def test_not_enrolled_has_no_enrollment_days(self):
        ctx = _ctx(enrolled=False, days_enrolled=None)
        assert evaluate_rules({"conditions": [_cond("enrollment.days", "gte", 0)]}, ctx) is False


class TestVariables:
    def test_interpolates_known_paths(self):
        assert interpolate_text("Hi {{ user.first_name | capitalize }}!", _ctx()) == "Hi Ada!"
        assert interpolate_text("{{progress.percent}}% of {{course.name}}", _ctx()) == "25% of Engines"

    def test_default_filter(self):
        assert interpolate_text('Hi {{ user.first_name | default: "there" }}', _ctx(first_name="")) == "Hi there"

    def test_unknown_paths_stay(self):
        assert interpolate_text("{{ user.password }} {{x}}", _ctx()) == "{{ user.password }} {{x}}"

    def test_values_are_text_not_markup(self):
        doc, _ = render_document(
            _doc(_p({"type": "dynamicVariable", "attrs": {"path": "user.first_name"}})),
            _ctx(first_name="<img src=x onerror=alert(1)>"),
        )
        node = doc["content"][0]["content"][0]
        assert node == {"type": "text", "text": "<img src=x onerror=alert(1)>"}

    def test_variable_node_keeps_marks_and_drops_when_empty(self):
        bold = [{"type": "bold"}]
        doc, stats = render_document(
            _doc(_p(
                {"type": "dynamicVariable", "attrs": {"path": "user.last_name", "format": "upper"}, "marks": bold},
                {"type": "dynamicVariable", "attrs": {"path": "enrollment.days"}},
            )),
            _ctx(days_enrolled=None),
        )
        assert doc["content"][0]["content"] == [{"type": "text", "text": "LOVELACE", "marks": bold}]
        assert stats.variables == 2


class TestRenderDocument:
    def test_unwraps_visible_and_drops_hidden(self):
        doc = _doc(
            _p(_text("intro")),
            _conditional({"conditions": [_cond("user.role", "eq", "member")]}, _p(_text("members"))),
            _conditional({"conditions": [_cond("user.role", "eq", "admin")]}, _p(_text("secret"))),
        )
        rendered, stats = render_document(doc, _ctx())
        assert rendered["content"] == [_p(_text("intro")), _p(_text("members"))]
        assert "secret" not in str(rendered)
        assert "rules" not in str(rendered)
        assert (stats.shown_blocks, stats.hidden_blocks) == (1, 1)

    def test_hidden_only_child_leaves_valid_container(self):
        doc = _doc(_conditional({"conditions": [_cond("user.signed_in", "is_false")]}, _p(_text("x"))))
        rendered, _ = render_document(doc, _ctx())
        assert rendered == {"type": "doc", "content": [{"type": "paragraph"}]}

    def test_does_not_mutate_input(self):
        doc = _doc(_p(_text("Hi {{user.first_name}}")))
        render_document(doc, _ctx())
        assert doc["content"][0]["content"][0]["text"] == "Hi {{user.first_name}}"

    def test_has_dynamic_content(self):
        assert has_dynamic_content(_doc(_p(_text("plain")))) is False
        assert has_dynamic_content(_doc(_p(_text("{{course.name}}")))) is True
        assert has_dynamic_content(_doc(_conditional(None, _p()))) is True

    def test_strip_keeps_only_shared_content(self):
        doc = _doc(
            _p(_text("shared"), {"type": "dynamicVariable", "attrs": {"path": "user.first_name"}}),
            _conditional({"negate": True, "conditions": []}, _p(_text("secret"))),
        )
        stripped = strip_dynamic_content(doc)
        assert stripped["content"] == [_p(_text("shared"))]


DYNAMIC_DOC = _doc(
    _p(_text("Hello {{ user.first_name }}")),
    _conditional({"conditions": [_cond("user.groups", "contains_any", ["usergroup_vip"])]}, _p(_text("vip only"))),
)


async def _add_group(db, org, user, uuid="usergroup_vip"):
    group = UserGroup(
        name="VIP", description="", org_id=org.id, usergroup_uuid=uuid,
        creation_date=str(datetime.now()), update_date=str(datetime.now()),
    )
    db.add(group)
    await db.commit()
    await db.refresh(group)
    db.add(UserGroupUser(usergroup_id=group.id, user_id=user.id, org_id=org.id))
    await db.commit()
    return group


class TestReaderRedaction:
    async def _read(self, mock_request, db, course, activity, user):
        activity.content = DYNAMIC_DOC
        read = ActivityRead.model_validate(activity)
        with patch(
            "src.services.courses.activities.access.check_ee_activity_paid_access",
            new_callable=AsyncMock, return_value=True,
        ):
            return await redact_activity_for_reader(mock_request, read, activity, course, user, db)

    @pytest.mark.asyncio
    async def test_learner_gets_rendered_content(self, mock_request, db, org, course, activity, regular_user):
        with patch(
            "src.services.courses.activities.access.can_edit_course",
            new_callable=AsyncMock, return_value=False,
        ):
            read = await self._read(mock_request, db, course, activity, regular_user)
        assert read.content["content"] == [_p(_text("Hello Regular"))]

    @pytest.mark.asyncio
    async def test_group_member_sees_group_block(self, mock_request, db, org, course, activity, regular_user):
        await _add_group(db, org, regular_user)
        with patch(
            "src.services.courses.activities.access.can_edit_course",
            new_callable=AsyncMock, return_value=False,
        ):
            read = await self._read(mock_request, db, course, activity, regular_user)
        assert _p(_text("vip only")) in read.content["content"]

    @pytest.mark.asyncio
    async def test_editor_gets_raw_document(self, mock_request, db, org, course, activity, regular_user):
        with patch(
            "src.services.courses.activities.access.can_edit_course",
            new_callable=AsyncMock, return_value=True,
        ):
            read = await self._read(mock_request, db, course, activity, regular_user)
        assert read.content == DYNAMIC_DOC

    @pytest.mark.asyncio
    async def test_anonymous_gets_no_name(self, mock_request, db, org, course, activity, anonymous_user):
        with patch(
            "src.services.courses.activities.access.can_edit_course",
            new_callable=AsyncMock, return_value=False,
        ):
            read = await self._read(mock_request, db, course, activity, anonymous_user)
        assert read.content["content"] == [_p(_text("Hello "))]


class TestRenderContext:
    @pytest.mark.asyncio
    async def test_enrollment_progress_and_groups(self, mock_request, db, org, course, activity, regular_user):
        await _add_group(db, org, regular_user)
        trail = Trail(
            org_id=org.id, user_id=regular_user.id, trail_uuid="trail_x",
            creation_date=str(datetime.now()), update_date=str(datetime.now()),
        )
        db.add(trail)
        await db.commit()
        await db.refresh(trail)
        db.add(TrailRun(
            trail_id=trail.id, course_id=course.id, org_id=org.id, user_id=regular_user.id,
            creation_date=str(datetime.now()), update_date=str(datetime.now()),
        ))
        await db.commit()

        ctx = await build_render_context(mock_request, regular_user, course, db)
        assert ctx.signed_in and ctx.enrolled
        assert ctx.days_enrolled == 0
        assert ctx.group_uuids == frozenset({"usergroup_vip"})
        assert ctx.org_name == "Test Org"
        assert ctx.progress_total == 1


class TestDynamicPreview:
    @pytest.mark.asyncio
    async def test_persona_controls_render(self, mock_request, db, org, course, activity, admin_user):
        activity.content = DYNAMIC_DOC
        db.add(activity)
        await db.commit()
        with patch(
            "src.services.courses.activities.activities.check_resource_access",
            new_callable=AsyncMock,
        ):
            vip = await get_dynamic_preview(
                mock_request, activity.activity_uuid,
                DynamicPreviewRequest(persona=PreviewPersona(usergroup_uuids=["usergroup_vip"], first_name="Grace")),
                admin_user, db,
            )
            anon = await get_dynamic_preview(
                mock_request, activity.activity_uuid,
                DynamicPreviewRequest(persona=PreviewPersona(signed_in=False, role="anonymous")),
                admin_user, db,
            )
        assert vip.content["content"] == [_p(_text("Hello Grace")), _p(_text("vip only"))]
        assert (vip.shown_blocks, vip.hidden_blocks) == (1, 0)
        assert anon.content["content"] == [_p(_text("Hello "))]
        assert anon.hidden_blocks == 1

    @pytest.mark.asyncio
    async def test_previews_unsaved_content(self, mock_request, db, org, course, activity, admin_user):
        with patch(
            "src.services.courses.activities.activities.check_resource_access",
            new_callable=AsyncMock,
        ):
            result = await get_dynamic_preview(
                mock_request, activity.activity_uuid,
                DynamicPreviewRequest(content=_doc(_p(_text("{{ course.name | upper }}")))),
                admin_user, db,
            )
        assert result.content["content"] == [_p(_text("TEST COURSE"))]

    @pytest.mark.asyncio
    async def test_requires_edit_rights(self, mock_request, db, org, course, activity, regular_user):
        with patch(
            "src.services.courses.activities.activities.check_resource_access",
            new_callable=AsyncMock, side_effect=HTTPException(status_code=403),
        ):
            with pytest.raises(HTTPException) as exc:
                await get_dynamic_preview(
                    mock_request, activity.activity_uuid, DynamicPreviewRequest(), regular_user, db,
                )
        assert exc.value.status_code == 403


class TestMoreFields:
    @pytest.mark.parametrize(
        "condition,expected",
        [
            (_cond("user.email_domain", "in", ["acme.com"]), True),
            (_cond("user.email_domain", "in", ["@ACME.com"]), True),
            (_cond("user.email_domain", "in", ["cme.com"]), False),
            (_cond("user.email_domain", "not_in", ["acme.com"]), False),
            (_cond("user.account_days", "gte", 30), True),
            (_cond("user.bucket", "lt", 50), True),
            (_cond("progress.completed_count", "eq", 1), True),
            (_cond("course.completed", "is_false"), True),
        ],
    )
    def test_conditions(self, condition, expected):
        ctx = _ctx(email="ada@eu.acme.com", account_days=40, bucket=12)
        assert evaluate_rules({"conditions": [condition]}, ctx) is expected

    def test_missing_bucket_hides(self):
        assert evaluate_rules({"conditions": [_cond("user.bucket", "lt", 50)]}, _ctx()) is False

    def test_course_completed(self):
        ctx = _ctx(progress_completed=4, progress_total=4)
        assert evaluate_rules({"conditions": [_cond("course.completed", "is_true")]}, ctx) is True

    def test_new_variables(self):
        ctx = _ctx(group_names=("VIP", "Beta"), enrolled_on=date(2026, 10, 21), email="ada@acme.com")
        text = "{{user.groups}}|{{progress.remaining}}|{{enrollment.date}}|{{user.email}}"
        assert interpolate_text(text, ctx) == "Beta, VIP|3|2026-10-21|ada@acme.com"

    def test_bucket_is_stable_and_spread(self):
        from src.services.courses.activities.dynamic_context import bucket_for

        assert bucket_for(1, "user_a") == bucket_for(1, "user_a")
        buckets = {bucket_for(1, f"user_{i}") for i in range(200)}
        assert len(buckets) > 50 and all(0 <= b < 100 for b in buckets)


class TestTeaser:
    def test_hidden_block_leaves_its_message_only(self):
        block = _conditional({"conditions": [_cond("enrollment.days", "gte", 30)]}, _p(_text("secret")))
        block["attrs"]["hiddenMessage"] = "Unlocks after a month, {{user.first_name}}."
        rendered, stats = render_document(_doc(block), _ctx())
        assert rendered["content"] == [{
            "type": "callout",
            "attrs": {"type": "info"},
            "content": [_p(_text("Unlocks after a month, ada."))],
        }]
        assert "secret" not in str(rendered) and stats.hidden_blocks == 1

    def test_search_index_drops_teaser(self):
        block = _conditional({"negate": True, "conditions": []}, _p(_text("secret")))
        block["attrs"]["hiddenMessage"] = "Later"
        assert strip_dynamic_content(_doc(_p(_text("x")), block))["content"] == [_p(_text("x"))]


class TestReach:
    def test_counts_nested_blocks_in_document_order(self):
        from src.services.courses.activities.dynamic_content import conditional_reach

        doc = _doc(
            _conditional(
                {"conditions": [_cond("user.signed_in", "is_true")]},
                _conditional({"conditions": [_cond("progress.percent", "gte", 50)]}, _p()),
            ),
            _conditional({"conditions": [_cond("user.role", "in", ["admin"])]}, _p()),
        )
        contexts = [
            _ctx(),
            _ctx(progress_completed=3),
            _ctx(role="admin", progress_completed=4),
            _ctx(signed_in=False, role="anonymous", progress_completed=4),
        ]
        assert conditional_reach(doc, contexts) == [3, 2, 1]


async def _enroll(db, org, course, user):
    trail = Trail(
        org_id=org.id, user_id=user.id, trail_uuid=f"trail_{user.id}",
        creation_date=str(datetime.now()), update_date=str(datetime.now()),
    )
    db.add(trail)
    await db.commit()
    await db.refresh(trail)
    db.add(TrailRun(
        trail_id=trail.id, course_id=course.id, org_id=org.id, user_id=user.id,
        creation_date=str(datetime.now()), update_date=str(datetime.now()),
    ))
    await db.commit()


class TestEditorEndpoints:
    @pytest.mark.asyncio
    async def test_reach_and_real_learner_preview(self, mock_request, db, org, course, activity, admin_user, regular_user):
        from src.services.courses.activities.activities import get_dynamic_reach, list_dynamic_learners

        await _add_group(db, org, regular_user)
        await _enroll(db, org, course, regular_user)
        await _enroll(db, org, course, admin_user)
        with patch(
            "src.services.courses.activities.activities.check_resource_access",
            new_callable=AsyncMock,
        ):
            reach = await get_dynamic_reach(mock_request, activity.activity_uuid, DYNAMIC_DOC, admin_user, db)
            learners = await list_dynamic_learners(mock_request, activity.activity_uuid, "reg", admin_user, db)
            preview = await get_dynamic_preview(
                mock_request, activity.activity_uuid,
                DynamicPreviewRequest(content=DYNAMIC_DOC, persona=PreviewPersona(user_uuid=regular_user.user_uuid)),
                admin_user, db,
            )
            with pytest.raises(HTTPException) as exc:
                await get_dynamic_preview(
                    mock_request, activity.activity_uuid,
                    DynamicPreviewRequest(persona=PreviewPersona(user_uuid="user_nobody")),
                    admin_user, db,
                )
        assert (reach.learners, reach.blocks) == (2, [1])
        assert [lr.username for lr in learners] == ["regular"]
        assert preview.content["content"] == [_p(_text("Hello Regular")), _p(_text("vip only"))]
        assert exc.value.status_code == 404
