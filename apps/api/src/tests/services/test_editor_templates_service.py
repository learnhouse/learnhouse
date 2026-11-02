"""Tests for src/services/editor_templates.py."""

import pytest
from fastapi import HTTPException

from src.db.editor_templates import (
    EditorTemplateCreate,
    EditorTemplateKind,
    EditorTemplateUpdate,
)
from src.services.editor_templates import (
    create_editor_template,
    delete_editor_template,
    list_editor_templates,
    update_editor_template,
)

DOC = {"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "hi"}]}]}


def _create(org, **overrides):
    data = dict(org_id=org.id, name="Welcome", content=DOC)
    data.update(overrides)
    return EditorTemplateCreate(**data)


class TestEditorTemplates:
    @pytest.mark.asyncio
    async def test_create_and_list(self, mock_request, db, org, admin_user):
        created = await create_editor_template(mock_request, _create(org), admin_user, db)
        await create_editor_template(
            mock_request, _create(org, name="Page", kind=EditorTemplateKind.PAGE), admin_user, db
        )
        assert created.template_uuid.startswith("template_")
        assert created.creator_id == admin_user.id

        all_templates = await list_editor_templates(mock_request, org.id, None, admin_user, db)
        pages = await list_editor_templates(mock_request, org.id, EditorTemplateKind.PAGE, admin_user, db)
        assert len(all_templates) == 2
        assert [t.name for t in pages] == ["Page"]

    @pytest.mark.asyncio
    async def test_learners_cannot_use_templates(self, mock_request, db, org, regular_user):
        with pytest.raises(HTTPException) as exc:
            await list_editor_templates(mock_request, org.id, None, regular_user, db)
        assert exc.value.status_code == 403
        with pytest.raises(HTTPException):
            await create_editor_template(mock_request, _create(org), regular_user, db)

    @pytest.mark.asyncio
    async def test_anonymous_rejected(self, mock_request, db, org, anonymous_user):
        with pytest.raises(HTTPException) as exc:
            await list_editor_templates(mock_request, org.id, None, anonymous_user, db)
        assert exc.value.status_code == 401

    @pytest.mark.asyncio
    async def test_other_org_rejected(self, mock_request, db, org, other_org, admin_user):
        with pytest.raises(HTTPException) as exc:
            await create_editor_template(mock_request, _create(other_org), admin_user, db)
        assert exc.value.status_code == 403

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "content",
        [{}, {"type": "doc", "content": []}, {"type": "paragraph", "content": [{"type": "text"}]}],
    )
    async def test_rejects_non_documents(self, mock_request, db, org, admin_user, content):
        with pytest.raises(HTTPException) as exc:
            await create_editor_template(mock_request, _create(org, content=content), admin_user, db)
        assert exc.value.status_code == 400

    @pytest.mark.asyncio
    async def test_update_and_delete(self, mock_request, db, org, admin_user):
        created = await create_editor_template(mock_request, _create(org), admin_user, db)
        updated = await update_editor_template(
            mock_request, created.template_uuid, EditorTemplateUpdate(name="Renamed"), admin_user, db
        )
        assert updated.name == "Renamed"
        await delete_editor_template(mock_request, created.template_uuid, admin_user, db)
        assert await list_editor_templates(mock_request, org.id, None, admin_user, db) == []
        with pytest.raises(HTTPException) as exc:
            await delete_editor_template(mock_request, created.template_uuid, admin_user, db)
        assert exc.value.status_code == 404
