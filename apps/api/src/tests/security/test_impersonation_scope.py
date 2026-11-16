"""Impersonation session scope: platform support access vs an org admin's
read-only "view as"."""

import time

import pytest

from src.security import impersonation as imp


def _token(scope=imp.SCOPE_PLATFORM, mode=imp.MODE_READ_ONLY, **kw):
    return imp.mint_impersonation_token(
        session_id="imp_x", jti="j1", impersonator_id=1, org_id=10, target_user_id=20,
        target_email="u20@example.com", mode=mode, kind=imp.KIND_USER, role_id=4,
        allow_messaging=kw.get("allow_messaging", False), expires_at=int(time.time()) + 600, scope=scope,
    )


def _ctx(**kw):
    status, payload = imp.decode_impersonation_token(_token(**kw))
    assert status == "ok"
    return imp.context_from_claims(payload)


class TestClaims:
    def test_scope_round_trips(self):
        assert _ctx().scope == imp.SCOPE_PLATFORM and not _ctx().org_scoped
        org = _ctx(scope=imp.SCOPE_ORG)
        assert org.scope == imp.SCOPE_ORG and org.org_scoped

    def test_tokens_without_a_scope_are_platform(self):
        status, payload = imp.decode_impersonation_token(_token())
        payload[imp.IMPERSONATION_CLAIM].pop("sc")
        assert imp.context_from_claims(payload).scope == imp.SCOPE_PLATFORM

    def test_unknown_scope_is_refused(self):
        status, payload = imp.decode_impersonation_token(_token())
        payload[imp.IMPERSONATION_CLAIM]["sc"] = "everything"
        assert imp.context_from_claims(payload) is None

    def test_org_scope_is_always_read_only(self):
        assert _ctx(scope=imp.SCOPE_ORG, mode=imp.MODE_FULL).read_only
        assert not _ctx(scope=imp.SCOPE_PLATFORM, mode=imp.MODE_FULL).read_only

    def test_audit_label(self):
        assert _ctx().audit_details()["by"] == imp.SUPPORT_LABEL
        assert _ctx(scope=imp.SCOPE_ORG).audit_details()["by"] == "admin_view"


class TestGate:
    @pytest.mark.parametrize(
        "path",
        [
            "/api/v1/messaging/conversations",
            "/api/v1/messaging/conversations/conv_1/messages",
            "/api/v1/usergroups/ug_1/messages",
            "/api/v1/emails/inbox",
            "/api/v1/notes",
            "/api/v1/notes/activity/activity_1",
            "/api/v1/ai/atlas/sessions",
            "/api/v1/ai/atlas/sessions/aichat_1/messages",
        ],
    )
    def test_private_reads_stay_private_in_a_view(self, path):
        assert imp.request_policy("GET", path, _ctx(scope=imp.SCOPE_ORG)) == imp.CODE_PRIVATE
        # Platform support in read-only mode may read them (it can't send).
        assert imp.request_policy("GET", path, _ctx()) is None

    @pytest.mark.parametrize(
        "path",
        ["/api/v1/courses/org_slug/org-10/page/1/limit/10", "/api/v1/communities/c_1/discussions", "/api/v1/trail/org/10/trail"],
    )
    def test_learner_pages_are_readable(self, path):
        assert imp.request_policy("GET", path, _ctx(scope=imp.SCOPE_ORG)) is None

    def test_every_write_is_refused(self):
        org = _ctx(scope=imp.SCOPE_ORG, mode=imp.MODE_FULL)
        for method in ("POST", "PUT", "PATCH", "DELETE"):
            assert imp.request_policy(method, "/api/v1/trail/add_course/course_1", org) == imp.CODE_READ_ONLY

    def test_ending_the_view_still_works(self):
        assert imp.request_policy("POST", "/api/v1/auth/impersonation/end", _ctx(scope=imp.SCOPE_ORG)) is None
