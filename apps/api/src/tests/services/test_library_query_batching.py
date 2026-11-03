"""Library listings check every item they show without a query per item.

Runs against the real RBAC checker and an in-memory database, counting the
statements each listing sends.
"""

from contextlib import contextmanager
from datetime import datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException
from sqlalchemy import event
from sqlmodel import select

from src.db.folders.folder_content import FolderContent
from src.db.media.media import Media, MediaTypeEnum
from src.db.organization_config import OrganizationConfig
from src.db.resource_authors import (
    ResourceAuthor,
    ResourceAuthorshipEnum,
    ResourceAuthorshipStatusEnum,
)
from src.db.users import AnonymousUser
from src.security.features_utils.plan_check import get_org_plan
from src.security.rbac.resource_access import ResourceAccessChecker
from src.services.folders import folders as folders_service
from src.services.folders.folders import add_org_root_content, get_org_root_items
from src.services.orgs.org_config_lookup import get_session_org_config


def _now():
    return str(datetime.now())


@contextmanager
def _statements(db):
    seen: list[str] = []

    def _record(conn, cursor, statement, *args):
        seen.append(" ".join(statement.split()))

    engine = db.bind.sync_engine
    event.listen(engine, "before_cursor_execute", _record)
    try:
        yield seen
    finally:
        event.remove(engine, "before_cursor_execute", _record)


async def _private_root_media(db, org, uuids, author_id=None):
    for position, uuid in enumerate(uuids):
        db.add(Media(
            name=uuid, media_type=MediaTypeEnum.EMBED, public=False, org_id=org.id,
            media_uuid=uuid, url="https://example.com", creation_date=_now(), update_date=_now(),
        ))
        db.add(FolderContent(folder_id=None, resource_uuid=uuid, org_id=org.id, position=position))
        if author_id is not None:
            db.add(ResourceAuthor(
                resource_uuid=uuid, user_id=author_id,
                authorship=ResourceAuthorshipEnum.CREATOR,
                authorship_status=ResourceAuthorshipStatusEnum.ACTIVE,
                creation_date=_now(), update_date=_now(),
            ))
    await db.commit()


def _per_item(statements, fragment):
    return [s for s in statements if fragment in s]


@pytest.mark.asyncio
async def test_root_listing_checks_media_without_a_query_per_item(
    db, org, admin_user, mock_request
):
    uuids = [f"media_{i}" for i in range(6)]
    await _private_root_media(db, org, uuids)

    with _statements(db) as statements:
        items = await get_org_root_items(mock_request, str(org.id), admin_user, db)

    assert {i.resource_uuid for i in items} == set(uuids)
    assert [s for s in _per_item(statements, "WHERE media.media_uuid = ") if "media.name" in s] == []
    assert _per_item(statements, "WHERE resourceauthor.resource_uuid = ") == []
    # Admin status is resolved once for the org, not once per item.
    assert len(_per_item(statements, "SELECT media.org_id")) <= 1


@pytest.mark.asyncio
async def test_root_listing_settles_authorship_in_one_query(
    db, org, regular_user, mock_request
):
    authored = [f"media_mine_{i}" for i in range(3)]
    await _private_root_media(db, org, authored, author_id=regular_user.id)
    await _private_root_media(db, org, ["media_other"])

    with _statements(db) as statements:
        items = await get_org_root_items(mock_request, str(org.id), regular_user, db)

    # Private media with no UserGroup is open to org members, authored or not.
    assert {i.resource_uuid for i in items} == {*authored, "media_other"}
    assert _per_item(statements, "WHERE resourceauthor.resource_uuid = ") == []
    assert len(_per_item(statements, "FROM resourceauthor")) == 1


@pytest.mark.asyncio
async def test_prime_matches_the_per_item_authorship_rule(db, org, regular_user, mock_request):
    await _private_root_media(db, org, ["media_mine"], author_id=regular_user.id)
    await _private_root_media(db, org, ["media_other"])
    media = (await db.execute(select(Media))).scalars().all()

    checker = ResourceAccessChecker(mock_request, db, regular_user)
    await checker.prime(media, "media_uuid")
    # An authored row for a resource without an org is left to the per-item check.
    orphan = SimpleNamespace(media_uuid="media_orphan", org_id=None)
    db.add(ResourceAuthor(
        resource_uuid="media_orphan", user_id=regular_user.id,
        authorship=ResourceAuthorshipEnum.CREATOR,
        authorship_status=ResourceAuthorshipStatusEnum.ACTIVE,
        creation_date=_now(), update_date=_now(),
    ))
    await db.commit()
    await checker.prime([orphan], "media_uuid")

    assert checker._author_cache == {"media_mine": True, "media_other": False}
    assert checker._resource_cache["media_orphan"] is orphan

    fresh = ResourceAccessChecker(mock_request, db, regular_user)
    assert await fresh._is_resource_author("media_mine") is True
    assert await fresh._is_resource_author("media_other") is False


@pytest.mark.asyncio
async def test_prime_skips_authorship_for_anonymous_callers(db, org, mock_request):
    checker = ResourceAccessChecker(mock_request, db, AnonymousUser())
    resource = SimpleNamespace(media_uuid="media_x", org_id=org.id)

    with _statements(db) as statements:
        await checker.prime([resource], "media_uuid")

    assert statements == []
    assert checker._resource_cache == {"media_x": resource}
    assert checker._author_cache == {}


@pytest.mark.asyncio
async def test_admin_status_is_resolved_once_per_org(db, org, admin_user, mock_request):
    checker = ResourceAccessChecker(mock_request, db, admin_user)
    await checker.prime(
        [SimpleNamespace(media_uuid=u, org_id=org.id) for u in ("media_a", "media_b")],
        "media_uuid",
    )

    with patch(
        "src.security.rbac.resource_access.authorization_verify_based_on_org_admin_status",
        new_callable=AsyncMock, return_value=True,
    ) as verify:
        assert await checker._is_admin_or_maintainer("media_a") is True
        assert await checker._is_admin_or_maintainer("media_b") is True
        # Unknown to the cache: no org to share the answer with.
        assert await checker._is_admin_or_maintainer("media_unloaded") is True

    assert verify.await_count == 2
    assert checker._org_admin_cache == {org.id: True}


@pytest.mark.asyncio
async def test_add_to_root_resolves_only_the_placed_item(db, org, admin_user, mock_request):
    await _private_root_media(db, org, ["media_a", "media_b", "media_c"])
    db.add(Media(
        name="new", media_type=MediaTypeEnum.EMBED, public=True, org_id=org.id,
        media_uuid="media_new", url="https://example.com", creation_date=_now(), update_date=_now(),
    ))
    await db.commit()

    real_resolve = folders_service._resolve_items
    with patch.object(
        folders_service, "_resolve_items", side_effect=real_resolve
    ) as resolve:
        item = await add_org_root_content(mock_request, org.id, "media_new", admin_user, db)
        # Placing it again reuses the existing placement.
        again = await add_org_root_content(mock_request, org.id, "media_new", admin_user, db)

    assert item.resource_uuid == "media_new"
    assert again.resource_uuid == "media_new"
    assert [len(call.args[1]) for call in resolve.call_args_list] == [1, 1]
    placements = (await db.execute(
        FolderContent.__table__.select().where(FolderContent.resource_uuid == "media_new")
    )).all()
    assert len(placements) == 1


@pytest.mark.asyncio
async def test_add_to_root_returns_none_when_the_item_is_hidden(db, org, admin_user, mock_request):
    with patch.object(folders_service, "_resolve_items", new_callable=AsyncMock, return_value=[]), \
         patch.object(folders_service, "check_resource_access", new_callable=AsyncMock), \
         patch.object(folders_service, "require_org_create_permission", new_callable=AsyncMock), \
         patch.object(folders_service, "_authors_item", new_callable=AsyncMock, return_value=True), \
         patch.object(folders_service, "_require_resource_in_org", new_callable=AsyncMock):
        assert await add_org_root_content(mock_request, org.id, "media_gone", admin_user, db) is None


@pytest.mark.asyncio
async def test_org_plan_reuses_the_config_the_request_already_loaded(db, org):
    db.add(OrganizationConfig(
        org_id=org.id, config={"config_version": "2.0", "plan": "pro"},
        creation_date=_now(), update_date=_now(),
    ))
    await db.commit()
    await get_session_org_config(db, org.id)

    with _statements(db) as statements:
        plan = await get_org_plan(org.id, db)

    assert plan == "pro"
    assert statements == []


@pytest.mark.asyncio
async def test_org_plan_without_config_is_404(db, org):
    with pytest.raises(HTTPException) as exc:
        await get_org_plan(org.id, db)
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_folder_listing_checks_subfolders_without_a_query_per_folder(
    db, org, regular_user, mock_request
):
    from src.db.folders.folders import Folder
    from src.services.folders.folders import get_folder

    db.add(Folder(
        id=100, name="parent", public=False, org_id=org.id, folder_uuid="folder_parent",
        creation_date=_now(), update_date=_now(),
    ))
    for i in range(4):
        db.add(Folder(
            id=101 + i, name=f"child {i}", public=False, org_id=org.id,
            folder_uuid=f"folder_child_{i}", parent_folder_id=100,
            creation_date=_now(), update_date=_now(),
        ))
    await db.commit()

    with _statements(db) as statements:
        folder = await get_folder(mock_request, "folder_parent", regular_user, db)

    assert {f.folder_uuid for f in folder.subfolders} == {f"folder_child_{i}" for i in range(4)}
    # The opened folder is looked up by uuid (by the service, then its own
    # access check); its sub-folders are not, one at a time.
    by_uuid = _per_item(statements, "FROM folder WHERE folder.folder_uuid = ")
    assert len([s for s in by_uuid if "folder.name" in s]) <= 2
    assert len(_per_item(statements, "WHERE resourceauthor.resource_uuid = ")) <= 1
