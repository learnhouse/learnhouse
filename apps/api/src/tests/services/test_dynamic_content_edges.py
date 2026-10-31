"""Edge cases for dynamic content: malformed input, limits, context helpers,
editor endpoints and the template router."""

from datetime import date
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException
from starlette.requests import Request

from src.db.editor_templates import EditorTemplateCreate, EditorTemplateUpdate
from src.routers import editor_templates as templates_router
from src.services.courses.activities import dynamic_content as dc
from src.services.courses.activities import dynamic_context as dx
from src.services.courses.activities.activities import (
    MAX_REACH_BLOCKS,
    get_dynamic_preview,
    get_dynamic_reach,
)
from src.services.courses.activities.dynamic_content import RenderContext, evaluate_rules
from src.services.courses.activities.dynamic_context import DynamicPreviewRequest, PreviewPersona
from src.tests.services.test_dynamic_content import (
    DYNAMIC_DOC,
    _add_group,
    _cond,
    _conditional,
    _ctx,
    _doc,
    _enroll,
    _p,
    _text,
)

DOC = {"type": "doc", "content": [_p(_text("hi"))]}


def _all(*conditions):
    return {"conditions": list(conditions)}


class TestMalformedRules:
    @pytest.mark.parametrize(
        "condition",
        [
            "not a dict",
            {"field": "user.role", "op": 3},
            _cond("user.role", "in", 5),
            _cond("user.role", "in", [1, 2]),
            _cond("user.role", "bogus", ["member"]),
            _cond("user.groups", "bogus", ["x"]),
            _cond("user.groups", "contains_any", None),
            _cond("progress.percent", "between", [1]),
            _cond("progress.percent", "between", ["a", 5]),
            _cond("progress.percent", "gte", True),
            _cond("progress.percent", "bogus", 5),
            _cond("date.today", "between", ["2026-01-01"]),
            _cond("date.today", "between", ["nope", "2026-12-31"]),
            _cond("date.today", "after", 20260101),
            _cond("date.today", "after", "not-a-date"),
            _cond("date.today", "bogus", "2026-01-01"),
            _cond("user.signed_in", "bogus"),
        ],
    )
    def test_hides(self, condition):
        assert evaluate_rules(_all(condition), _ctx()) is False

    def test_date_after(self):
        assert evaluate_rules(_all(_cond("date.today", "after", "2026-01-01")), _ctx()) is True

    def test_condition_budget(self):
        rules = _all(*[_cond("user.signed_in", "is_true")] * (dc.MAX_CONDITIONS + 1))
        assert evaluate_rules(rules, _ctx()) is False

    def test_zero_total_progress(self):
        ctx = _ctx(progress_total=0, progress_completed=0)
        assert ctx.progress_percent == 0 and ctx.course_completed is False

    def test_no_email_no_domain(self):
        assert _ctx(email="").email_domain == ""
        assert evaluate_rules(_all(_cond("user.email_domain", "in", ["acme.com"])), _ctx(email="")) is False


class TestVariables:
    def test_unknown_or_non_string(self):
        assert dc.resolve_variable(None, _ctx()) == ""
        assert dc.resolve_variable("user.password", _ctx(), fallback="x") == "x"
        assert dc.resolve_variable("user.first_name", _ctx(first_name=""), fallback=3) == ""
        assert dc.resolve_variable("user.full_name", _ctx(last_name="")) == "ada"

    def test_value_is_capped(self):
        assert len(dc.resolve_variable("user.first_name", _ctx(first_name="a" * 900))) == dc.MAX_VARIABLE_LENGTH

    def test_text_without_placeholders(self):
        assert dc.interpolate_text("plain", _ctx()) == "plain"


class TestDocumentWalk:
    def test_non_dict_documents(self):
        assert dc.render_document("x", _ctx())[0] == "x"
        assert dc.strip_dynamic_content(None) is None
        plain = _doc(_p(_text("x")))
        assert dc.strip_dynamic_content(plain) is plain

    def test_has_dynamic_in_lists_and_huge_docs(self):
        assert dc.has_dynamic_content([{"type": "dynamicVariable"}]) is True
        wide = {"type": "doc", "content": [{"type": "paragraph"}] * 100_001}
        assert dc.has_dynamic_content(wide) is True

    def test_keeps_odd_children_and_caps_depth(self):
        doc = _doc("stray", _conditional(None, _p(_text("ok"))))
        rendered, _ = dc.render_document(doc, _ctx())
        assert rendered["content"] == ["stray", _p(_text("ok"))]

        deep: dict = _p(_text("{{course.name}}"))
        for _ in range(dc.MAX_NODE_DEPTH + 5):
            deep = {"type": "blockquote", "content": [deep]}
        rendered, _ = dc.render_document(_doc(deep), _ctx())
        assert "paragraph" in str(rendered)

    def test_empty_teaser_and_text(self):
        block = _conditional(_all(_cond("user.signed_in", "is_false")), _p(_text("x")))
        block["attrs"]["hiddenMessage"] = "{{user.password_missing}}"
        assert dc._teaser("   ", _ctx()) is None
        assert dc._teaser("{{ user.first_name }}", _ctx(first_name="")) is None
        rendered, _ = dc.render_document(_doc(block), _ctx())
        assert rendered["content"][0]["type"] == "callout"
        rendered, _ = dc.render_document(_doc(_p(_text("{{user.last_name}}"))), _ctx(last_name=""))
        assert rendered["content"] == [{"type": "paragraph", "content": []}]

    def test_block_tree_depth_and_non_dicts(self):
        assert dc.conditional_blocks("x") == []
        deep: dict = _conditional(None, _p())
        for _ in range(dc.MAX_NODE_DEPTH + 2):
            deep = {"type": "blockquote", "content": [deep]}
        assert dc.conditional_blocks(_doc(deep)) == []

    def test_count_conditions(self):
        nested = _all(_cond("user.signed_in", "is_true"), _all(_cond("user.role", "in", ["admin"])))
        assert dc.count_conditions(nested) == 3
        assert dc.count_conditions(None) == 0
        assert dc.count_conditions({"conditions": "x"}) == 0
        assert dc.count_conditions(_all(*[_cond("user.signed_in", "is_true")] * 80)) == dc.MAX_CONDITIONS


class TestContextHelpers:
    def _request(self, headers=None, cookie=None):
        raw = [(k.lower().encode(), v.encode()) for k, v in (headers or {}).items()]
        if cookie:
            raw.append((b"cookie", f"i18next={cookie}".encode()))
        return Request({"type": "http", "headers": raw})

    def test_request_locale(self):
        assert dx.request_locale(None) == "en"
        assert dx.request_locale(self._request(cookie="fr")) == "fr"
        assert dx.request_locale(self._request({"Accept-Language": "de-DE,de;q=0.9"})) == "de-DE"
        assert dx.request_locale(self._request()) == "en"

    def test_role_and_dates(self):
        assert [dx._role_name(i) for i in (1, 2, 3, None)] == ["admin", "maintainer", "member", "anonymous"]
        assert dx._parse_date("2026-10-31 12:00:00.1") == date(2026, 10, 31)
        assert dx._parse_date("2026-10-31Tjunk") == date(2026, 10, 31)
        assert dx._parse_date("junk") is None
        assert dx._parse_date(None) is None

    def test_persona_without_course_activities(self):
        base = RenderContext(progress_total=0)
        ctx = dx.persona_context(base, PreviewPersona(progress_percent=50, bucket=7, email="a@b.com"), None)
        assert (ctx.progress_total, ctx.progress_percent, ctx.bucket, ctx.email_domain) == (100, 50, 7, "b.com")

    @pytest.mark.asyncio
    async def test_learner_contexts_empty(self, db, course):
        assert await dx._learner_contexts(RenderContext(), course, [], db) == {}

    @pytest.mark.asyncio
    async def test_render_for_reader_paths(self, mock_request, db, course, regular_user):
        assert await dx.render_for_reader(None, {"type": "doc"}, course=course, current_user=regular_user, db_session=db) == {"type": "doc"}
        rendered = await dx.render_for_reader(
            None, DYNAMIC_DOC, course=course, current_user=regular_user, db_session=db,
            activity_name="Lesson", context=_ctx(),
        )
        assert rendered["content"][0] == _p(_text("Hello ada"))


class TestEditorEndpointEdges:
    @pytest.mark.asyncio
    async def test_unknown_activity_and_oversize(self, mock_request, db, activity, admin_user):
        with patch("src.services.courses.activities.activities.check_resource_access", new_callable=AsyncMock):
            with pytest.raises(HTTPException) as missing:
                await get_dynamic_reach(mock_request, "activity_nope", None, admin_user, db)
            with patch("src.services.courses.activities.activities.MAX_PREVIEW_CONTENT_BYTES", 10):
                with pytest.raises(HTTPException) as big:
                    await get_dynamic_reach(mock_request, activity.activity_uuid, DOC, admin_user, db)
            empty = await get_dynamic_reach(mock_request, activity.activity_uuid, DOC, admin_user, db)
            many = _doc(*[_conditional(None, _p())] * (MAX_REACH_BLOCKS + 1))
            with pytest.raises(HTTPException) as too_many:
                await get_dynamic_reach(mock_request, activity.activity_uuid, many, admin_user, db)
            with patch("src.services.courses.activities.activities.MAX_REACH_WORK", -1):
                with pytest.raises(HTTPException) as too_much:
                    await get_dynamic_reach(mock_request, activity.activity_uuid, DYNAMIC_DOC, admin_user, db)
        assert (missing.value.status_code, big.value.status_code, too_many.value.status_code) == (404, 413, 413)
        assert too_much.value.status_code == 413
        assert (empty.learners, empty.blocks) == (0, [])

    @pytest.mark.asyncio
    async def test_real_learner_email_is_masked(self, mock_request, db, org, course, activity, admin_user, regular_user):
        await _add_group(db, org, regular_user)
        await _enroll(db, org, course, regular_user)
        doc = _doc(_p(_text("{{user.email}}")), _conditional(_all(_cond("user.email_domain", "in", ["test.com"])), _p(_text("domain ok"))))
        with patch("src.services.courses.activities.activities.check_resource_access", new_callable=AsyncMock):
            preview = await get_dynamic_preview(
                mock_request, activity.activity_uuid,
                DynamicPreviewRequest(content=doc, persona=PreviewPersona(user_uuid=regular_user.user_uuid, today=date(2027, 1, 1))),
                admin_user, db,
            )
        assert preview.content["content"] == [_p(_text("***@test.com")), _p(_text("domain ok"))]


def _template(org, **overrides):
    data = dict(org_id=org.id, name="T", content=DOC)
    data.update(overrides)
    return EditorTemplateCreate(**data)


class TestTemplateEdges:
    @pytest.mark.asyncio
    async def test_router_round_trip(self, mock_request, db, org, admin_user):
        created = await templates_router.api_create_editor_template(mock_request, _template(org), admin_user, db)
        listed = await templates_router.api_list_editor_templates(mock_request, org.id, None, admin_user, db)
        updated = await templates_router.api_update_editor_template(
            mock_request, created.template_uuid,
            EditorTemplateUpdate(description="  d  ", content={"type": "doc", "content": [_p(_text("new"))]}),
            admin_user, db,
        )
        await templates_router.api_delete_editor_template(mock_request, created.template_uuid, admin_user, db)
        assert [t.name for t in listed] == ["T"]
        assert updated.description == "d" and "new" in str(updated.content)

    @pytest.mark.asyncio
    async def test_limits(self, mock_request, db, org, admin_user):
        from src.services import editor_templates as svc

        with patch.object(svc, "MAX_TEMPLATE_BYTES", 10):
            with pytest.raises(HTTPException) as big:
                await svc.create_editor_template(mock_request, _template(org), admin_user, db)
        with patch.object(svc, "MAX_TEMPLATES_PER_ORG", 0):
            with pytest.raises(HTTPException) as full:
                await svc.create_editor_template(mock_request, _template(org), admin_user, db)
        assert (big.value.status_code, full.value.status_code) == (413, 400)

    @pytest.mark.asyncio
    async def test_other_authors_need_course_update(self, mock_request, db, org, admin_user, regular_user):
        from src.services import editor_templates as svc

        created = await svc.create_editor_template(mock_request, _template(org), admin_user, db)
        with patch.object(svc, "_require_author", new_callable=AsyncMock):
            with pytest.raises(HTTPException) as denied:
                await svc.delete_editor_template(mock_request, created.template_uuid, regular_user, db)
        assert denied.value.status_code == 403


class TestActivityRoutes:
    @pytest.mark.asyncio
    async def test_routes_delegate(self, mock_request, db, activity, admin_user):
        from src.routers.courses.activities import activities as routes

        with patch("src.services.courses.activities.activities.check_resource_access", new_callable=AsyncMock):
            preview = await routes.api_get_dynamic_preview(mock_request, activity.activity_uuid, DynamicPreviewRequest(content=DOC), admin_user, db)
            reach = await routes.api_get_dynamic_reach(mock_request, activity.activity_uuid, routes.DynamicReachRequest(content=DOC), admin_user, db)
            learners = await routes.api_list_dynamic_learners(mock_request, activity.activity_uuid, "", admin_user, db)
        assert preview.content == DOC and reach.blocks == [] and learners == []


class TestAudienceEdges:
    def test_audience_cost_and_depth(self):
        rules = _all({"field": "audience", "op": "is", "value": "audience_a"})
        assert dc.count_conditions(rules) == dc.MAX_CONDITIONS
        deep: dict = {"field": "audience", "op": "is", "value": "audience_deep"}
        for _ in range(dc.MAX_NODE_DEPTH + 2):
            deep = {"conditions": [deep]}
        assert dc.referenced_audiences(deep) == set()


class TestFailClosed:
    @pytest.mark.parametrize(
        "inner",
        [
            {"field": "audience", "op": "is", "value": "audience_missing"},
            _cond("user.password", "eq", "x"),
            _cond("progress.percent", "between", ["a", 5]),
            _cond("date.today", "between", ["2026-01-01", "nope"]),
            _cond("progress.percent", "bogus", 5),
            _cond("date.today", "bogus", "2026-01-01"),
        ],
    )
    def test_negation_cannot_reveal_unresolvable_rules(self, inner):
        negated = {"negate": True, "conditions": [inner]}
        is_not = {"conditions": [{"field": "audience", "op": "is_not", "value": "audience_x"}]}
        assert evaluate_rules(negated, _ctx(audiences={"audience_x": {"conditions": [inner]}})) is False
        assert evaluate_rules(is_not, _ctx(audiences={"audience_x": {"conditions": [inner]}})) is False

    def test_over_budget_audience_is_not_shown(self):
        big = {"conditions": [_cond("user.signed_in", "is_true")] * (dc.MAX_CONDITIONS + 1)}
        rules = {"conditions": [{"field": "audience", "op": "is_not", "value": "audience_big"}]}
        assert evaluate_rules(rules, _ctx(audiences={"audience_big": big})) is False

    def test_missing_values_still_negate(self):
        # Not enrolled is a real answer: "not after a week" includes them.
        rules = {"negate": True, "conditions": [_cond("enrollment.days", "gte", 7)]}
        assert evaluate_rules(rules, _ctx(enrolled=False, days_enrolled=None)) is True


class TestAudiencePermissions:
    @pytest.mark.asyncio
    async def test_creator_without_course_wide_rights_cannot_change_it(self, mock_request, db, org, regular_user):
        from src.db.editor_audiences import EditorAudienceCreate, EditorAudienceUpdate
        from src.services import editor_audiences as svc

        with patch.object(svc, "_require_author", new_callable=AsyncMock):
            created = await svc.create_editor_audience(
                mock_request, EditorAudienceCreate(org_id=org.id, name="Mine", rules={"conditions": []}), regular_user, db
            )
            with pytest.raises(HTTPException) as update:
                await svc.update_editor_audience(mock_request, created.audience_uuid, EditorAudienceUpdate(name="x"), regular_user, db)
            with pytest.raises(HTTPException) as delete:
                await svc.delete_editor_audience(mock_request, created.audience_uuid, regular_user, db)
        assert (update.value.status_code, delete.value.status_code) == (403, 403)
