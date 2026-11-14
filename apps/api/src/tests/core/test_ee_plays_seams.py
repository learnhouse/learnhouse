"""Where core reaches Plays (an EE feature) through ``get_ee_module``.

Core never imports Plays directly: search, folders, the RBAC uuid lookups and
the demo ask ``src.core.ee_hooks.get_ee_module`` and carry on without Plays
when it answers None (community installs; this suite pins EE off). These
tests cover both answers, the "with EE" one through stand-in modules; the
real EE models are exercised in ee/tests/test_plays_core.py.
"""

from datetime import date
from types import SimpleNamespace
from typing import Optional
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from sqlalchemy import func, select
from sqlmodel import Field, SQLModel

from src.core import ee_hooks
from src.tests.services.test_demo_drift import (  # noqa: F401  (fixtures)
    demo_org,
    no_uploads,
    synced,
    visitor,
)

EPOCH_DAY = date(2026, 8, 9)


class _StandInPlayground(SQLModel, table=True):
    """Just the columns core touches; stands in for ee.db.playgrounds.Playground."""

    __tablename__ = "test_standin_playground"
    id: Optional[int] = Field(default=None, primary_key=True)
    org_id: int = 0
    playground_uuid: str = ""
    name: str = ""
    description: Optional[str] = None
    published: bool = False
    html_content: Optional[str] = None
    course_uuid: Optional[str] = None
    course_id: Optional[int] = None
    created_by: Optional[int] = None
    creation_date: str = ""
    update_date: str = ""


class _StandInReaction(SQLModel, table=True):
    __tablename__ = "test_standin_playground_reaction"
    id: Optional[int] = Field(default=None, primary_key=True)
    playground_id: int = 0
    user_id: int = 0
    emoji: str = ""
    reaction_uuid: str = ""
    creation_date: str = ""


PLAYS = SimpleNamespace(Playground=_StandInPlayground)
REACTIONS = SimpleNamespace(PlaygroundReaction=_StandInReaction)


def _with_ee(**modules):
    """Patch get_ee_module to answer with the given stand-ins by name."""
    table = {
        "ee.db.playgrounds": PLAYS,
        "ee.db.playground_reactions": REACTIONS,
        **modules,
    }
    return patch.object(ee_hooks, "get_ee_module", side_effect=lambda name: table.get(name))


# ─── get_ee_module ──────────────────────────────────────────────────────────


def test_get_ee_module_without_ee_is_none():
    assert ee_hooks.get_ee_module("ee.db.playgrounds") is None


def test_get_ee_module_with_ee_imports_or_answers_none(caplog):
    with patch.object(ee_hooks, "is_ee_available", return_value=True):
        assert ee_hooks.get_ee_module("json").dumps
        assert ee_hooks.get_ee_module("ee_module_that_does_not_exist") is None
    assert "Failed to import EE module" in caplog.text


# ─── RBAC and folders ────────────────────────────────────────────────────────


async def test_rbac_org_of_a_playground_with_ee():
    from src.security.rbac.utils import get_element_organization_id

    result = MagicMock()
    result.scalars.return_value.first.return_value = 25
    session = MagicMock(execute=AsyncMock(return_value=result))
    with _with_ee():
        assert await get_element_organization_id("playground_1", session) == 25


def test_rbac_resource_model_with_ee():
    from src.security.rbac.resource_access import _resource_model

    with _with_ee():
        assert _resource_model("playgrounds") == (_StandInPlayground, "playground_uuid")


def test_folder_registry_with_and_without_ee():
    from src.services.folders.folders import _resource_registry

    assert "playground_" not in _resource_registry()
    with _with_ee():
        assert _resource_registry()["playground_"] == ("playgrounds", _StandInPlayground, "playground_uuid")


# ─── search ──────────────────────────────────────────────────────────────────


async def test_search_asks_ee_for_playgrounds(db, org, anonymous_user, mock_request):
    from src.services.search.search import search_across_org

    found = SimpleNamespace(search_playgrounds=AsyncMock(return_value=([{"name": "Tide pools"}], 1)))
    with _with_ee(**{"ee.services.playgrounds.search": found}), patch(
        "src.services.search.search.search_courses", new_callable=AsyncMock, return_value=[]
    ):
        result = await search_across_org(mock_request, anonymous_user, "test-org", "tide", db)

    assert result.playgrounds == [{"name": "Tide pools"}] and result.total_playgrounds == 1
    kwargs = found.search_playgrounds.await_args.kwargs
    assert kwargs["only_public"] is True and kwargs["is_token"] is False


# ─── demo ────────────────────────────────────────────────────────────────────


async def test_demo_without_ee_seeds_no_plays(db, demo_org):  # noqa: F811 (imported fixtures)
    assert (await db.execute(select(func.count()).select_from(_StandInPlayground))).scalar_one() == 0


async def test_demo_with_ee_seeds_restores_and_sweeps_plays(db, no_uploads, monkeypatch):  # noqa: F811 (imported fixtures)
    from src.db.organizations import Organization
    from src.services.demo import sync as sync_module

    monkeypatch.setattr(sync_module, "_playground_models", lambda: PLAYS)
    with _with_ee():
        await sync_module.sync_demo(db, today=EPOCH_DAY)
        org = (await db.execute(select(Organization).where(Organization.is_demo.is_(True)))).scalars().first()
        plays = (await db.execute(select(_StandInPlayground).where(_StandInPlayground.org_id == org.id))).scalars().all()
        assert plays, "the bundle's plays are seeded with EE"
        seeded = plays[0]
        name = seeded.name

        # A visitor's rename is reverted, their own play and reaction removed.
        seeded.name = "Renamed"
        db.add(seeded)
        db.add(_StandInPlayground(org_id=org.id, name="Visitor's", playground_uuid="playground_visitor"))
        db.add(_StandInReaction(playground_id=seeded.id, user_id=1, emoji="👏", reaction_uuid="r1"))
        await db.commit()
        stats = await sync_module.sync_demo(db, today=EPOCH_DAY)

    await db.refresh(seeded)
    assert seeded.name == name
    uuids = {p.playground_uuid for p in (await db.execute(select(_StandInPlayground))).scalars().all()}
    assert "playground_visitor" not in uuids
    assert (await db.execute(select(func.count()).select_from(_StandInReaction))).scalar_one() == 0
    assert stats.drift_deleted >= 2


@pytest.fixture(autouse=True)
def _ee_stays_off(monkeypatch):
    # Belt and braces: whatever another test did, these run as a community install.
    monkeypatch.setenv("LEARNHOUSE_DISABLE_EE", "1")
