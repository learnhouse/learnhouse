"""Edge branches in small routers: the custom-domain allow/deny check, the
playground generator's course context, the feedback relay's attachment
handling, local content path vetting and Zapier token rights."""

from io import BytesIO
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException, UploadFile
from starlette.datastructures import Headers

from src.routers import local_content, monitoring
from src.routers.integrations.zapier import _require_token_right
from src.routers.orgs.custom_domains import api_check_domain
from src.routers.playgrounds.playgrounds_generator import _get_course_context


# ─── custom domains ──────────────────────────────────────────────────────────


async def test_domain_check_allows_registered_domains(db, mock_request):
    with patch("src.routers.orgs.custom_domains.resolve_org_by_domain", new=AsyncMock(return_value={"org_id": 1})) as resolve:
        assert await api_check_domain(mock_request, "school.example.com", db) == {"ok": True}
    resolve.assert_awaited_once_with(db, "school.example.com")


async def test_domain_check_denies_unknown_domains(db, mock_request):
    with patch("src.routers.orgs.custom_domains.resolve_org_by_domain", new=AsyncMock(return_value=None)):
        with pytest.raises(HTTPException) as exc:
            await api_check_domain(mock_request, "nope.example.com", db)
    assert exc.value.status_code == 404
    assert exc.value.detail == "not allowed"


# ─── playground generator ────────────────────────────────────────────────────


async def test_course_context_skipped_when_the_editor_cannot_read_the_course(db, org, course, admin_user, mock_request):
    """A linked course the caller cannot read is not an error: generate without it."""
    with patch("src.services.ai.rag.access.build_rag_access_scope", new=AsyncMock(side_effect=HTTPException(status_code=403))), \
         patch("src.services.ai.rag.query_service.query_course_rag", new_callable=AsyncMock) as rag:
        context, course_id = await _get_course_context(mock_request, admin_user, course.course_uuid, org.id, db, "make a quiz")
    assert (context, course_id) == (None, course.id)
    rag.assert_not_awaited()


# ─── monitoring feedback relay ───────────────────────────────────────────────


def _upload(name, data, content_type="text/plain"):
    return UploadFile(file=BytesIO(data), filename=name, headers=Headers({"content-type": content_type}))


async def test_feedback_trims_message_and_filters_attachments(mock_request):
    """Overlong messages are cut, nameless and empty uploads dropped, and big ones truncated."""
    active = MagicMock()
    active.is_active.return_value = True
    scope = MagicMock()
    scope_cm = MagicMock()
    scope_cm.__enter__.return_value = scope
    scope_cm.__exit__.return_value = False

    attachments = [_upload(None, b"ignored"), _upload("empty.txt", b""), _upload("big.log", b"0123456789")]
    with patch.object(monitoring, "check_rate_limit", return_value=(True, 0, 0)), \
         patch.object(monitoring, "get_client_ip", return_value="203.0.113.7"), \
         patch.object(monitoring, "_MAX_ATTACHMENT_BYTES", 4), \
         patch.object(monitoring.sentry_sdk, "get_client", return_value=active), \
         patch.object(monitoring.sentry_sdk, "new_scope", return_value=scope_cm), \
         patch.object(monitoring.sentry_sdk, "capture_event") as capture:
        await monitoring.submit_feedback(
            mock_request,
            message="x" * (monitoring._MAX_MESSAGE_LENGTH + 50),
            name=None,
            email=None,
            associated_event_id="evt_123",
            attachments=attachments,
        )

    scope.add_attachment.assert_called_once_with(bytes=b"0123", filename="big.log", content_type="text/plain")
    feedback = capture.call_args.args[0]["contexts"]["feedback"]
    assert len(feedback["message"]) == monitoring._MAX_MESSAGE_LENGTH
    assert feedback["associated_event_id"] == "evt_123"
    assert "name" not in feedback and "contact_email" not in feedback


# ─── local content / zapier ──────────────────────────────────────────────────


def test_backslash_rooted_paths_are_refused():
    """A Windows-style leading backslash becomes an absolute path once normalized."""
    assert local_content._normalize_content_relpath("\\etc\\passwd") is None
    assert local_content._normalize_content_relpath("orgs\\logo.png") == "orgs/logo.png"


def test_zapier_reads_rights_from_a_model():
    """Token rights may arrive as a model rather than a dict."""
    allowed = SimpleNamespace(rights=SimpleNamespace(users=SimpleNamespace(action_read=True)))
    denied = SimpleNamespace(rights=SimpleNamespace(users=SimpleNamespace(action_read=False)))
    assert _require_token_right(allowed, "users") is None
    with pytest.raises(HTTPException) as exc:
        _require_token_right(denied, "users")
    assert exc.value.status_code == 403
