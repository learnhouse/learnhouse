"""Error mapping and credit refunds in src/routers/courses/migration.py.

The migration service raises bare ValueError; the router maps "not found" to
404 and everything else to 400 so user mistakes never surface as 500s. The
suggest endpoint reserves an AI credit up front and must hand it back on any
failure, even when the refund itself fails. The handlers are called directly
with an authorized admin, and Redis (the owner claim) is disabled.
"""

from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest
from fastapi import HTTPException

from src.routers.courses import migration as mig
from src.services.courses.migration.models import (
    CreateFromMigrationRequest,
    MigrationTreeStructure,
    SuggestStructureRequest,
)


@pytest.fixture
def no_redis():
    with patch.object(mig, "get_redis_client", return_value=None):
        yield


@pytest.fixture
def ai_gates():
    """Rate limit and credit reservation pass; refunds are observed."""
    refund = MagicMock()
    with patch.object(mig, "enforce_ai_rate_limit"), patch.object(
        mig, "reserve_ai_credit", new=AsyncMock()
    ), patch.object(mig, "refund_ai_credit", new=refund):
        yield refund


class TestValueErrorMapping:
    @pytest.mark.parametrize(
        "message, status",
        [
            ("Migration package not found: abc", 404),
            ("Invalid file type: exe", 400),
            ("Too many files", 400),
        ],
        ids=["not-found", "invalid", "other"],
    )
    def test_messages_map_to_client_errors(self, message, status):
        exc = mig._migration_value_error_to_http(ValueError(message))
        assert exc.status_code == status
        assert exc.detail == message


class TestUpload:
    async def test_service_value_error_is_a_400(
        self, db, org, admin_role, admin_user, no_redis, mock_request
    ):
        with patch.object(
            mig,
            "upload_migration_files",
            new=AsyncMock(side_effect=ValueError("Invalid file type: .exe")),
        ):
            with pytest.raises(HTTPException) as exc:
                await mig.api_upload_migration_files(
                    mock_request, org.id, [], None, admin_user, db
                )

        assert exc.value.status_code == 400
        assert exc.value.detail == "Invalid file type: .exe"
        assert isinstance(exc.value.__cause__, ValueError)


class TestSuggestRefunds:
    def _body(self) -> SuggestStructureRequest:
        return SuggestStructureRequest(
            temp_id=str(uuid4()), course_name="Course", description="d"
        )

    async def test_unexpected_error_refunds_and_propagates(
        self, db, org, admin_role, admin_user, no_redis, mock_request, ai_gates
    ):
        with patch.object(
            mig, "suggest_structure", new=AsyncMock(side_effect=RuntimeError("llm down"))
        ):
            with pytest.raises(RuntimeError, match="llm down"):
                await mig.api_suggest_structure(
                    mock_request, org.id, self._body(), admin_user, db
                )

        ai_gates.assert_called_once_with(org.id)

    async def test_failing_refund_does_not_mask_the_original_error(
        self, db, org, admin_role, admin_user, no_redis, mock_request, ai_gates
    ):
        ai_gates.side_effect = RuntimeError("redis gone")
        with patch.object(
            mig,
            "suggest_structure",
            new=AsyncMock(side_effect=ValueError("Migration package not found: x")),
        ):
            with pytest.raises(HTTPException) as exc:
                await mig.api_suggest_structure(
                    mock_request, org.id, self._body(), admin_user, db
                )

        assert exc.value.status_code == 404
        ai_gates.assert_called_once_with(org.id)


class TestCreate:
    def _body(self) -> CreateFromMigrationRequest:
        return CreateFromMigrationRequest(
            temp_id=str(uuid4()),
            structure=MigrationTreeStructure(course_name="C", chapters=[]),
        )

    async def test_authorized_create_returns_service_result(
        self, db, org, admin_role, admin_user, no_redis, mock_request
    ):
        body = self._body()
        result = MagicMock(course_uuid="course_new")
        with patch.object(
            mig, "create_course_from_migration", new=AsyncMock(return_value=result)
        ) as create:
            got = await mig.api_create_from_migration(
                mock_request, org.id, body, admin_user, db
            )

        assert got is result
        create.assert_awaited_once_with(
            org_id=org.id,
            current_user=admin_user,
            db_session=db,
            temp_id=body.temp_id,
            structure=body.structure,
        )

    async def test_service_value_error_is_a_400(
        self, db, org, admin_role, admin_user, no_redis, mock_request
    ):
        with patch.object(
            mig,
            "create_course_from_migration",
            new=AsyncMock(side_effect=ValueError("Invalid structure: no chapters")),
        ):
            with pytest.raises(HTTPException) as exc:
                await mig.api_create_from_migration(
                    mock_request, org.id, self._body(), admin_user, db
                )

        assert exc.value.status_code == 400
        assert exc.value.detail == "Invalid structure: no chapters"
