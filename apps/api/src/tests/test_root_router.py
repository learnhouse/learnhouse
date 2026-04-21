"""Tests for the root API router composition."""

import importlib
import sys
from types import ModuleType
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import APIRouter


def _module(name: str, **attrs):
    module = ModuleType(name)
    module.__dict__.update(attrs)
    return module


def _named_router(name: str) -> APIRouter:
    router = APIRouter()
    setattr(router, "_router_name", name)
    return router


def _dependency(name: str):
    async def dependency(*_args, **_kwargs):
        return True

    dependency.__name__ = name
    return dependency


def _plan_factory(factory_name: str):
    def factory(*args, **kwargs):
        required_plan = args[0] if args else kwargs.get("required_plan", "plan")
        feature_name = args[1] if len(args) > 1 else kwargs.get("feature_name", "feature")
        dep_name = (
            f"{factory_name}_{str(required_plan).lower()}_"
            f"{str(feature_name).lower().replace(' ', '_')}"
        )
        return _dependency(dep_name)

    return factory


def _install_stub_modules(monkeypatch: pytest.MonkeyPatch) -> None:
    def install(name: str, **attrs):
        monkeypatch.setitem(sys.modules, name, _module(name, **attrs))

    def install_router_module(name: str, router_name: str, **attrs):
        install(name, router=_named_router(router_name), **attrs)

    def install_package(name: str, **attrs):
        module = _module(name, **attrs)
        module.__path__ = []  # type: ignore[attr-defined]
        monkeypatch.setitem(sys.modules, name, module)
        return module

    install_package("src.routers")
    install_package("src.routers.ai")
    install_package("src.routers.boards")
    install_package("src.routers.orgs")
    install_package("src.routers.courses")
    install_package("src.routers.courses.activities")
    install_package("src.routers.communities")
    install_package("src.routers.podcasts")
    install_package("src.routers.playgrounds")
    install_package("src.routers.integrations")
    install_package("src.services")
    install_package("src.services.dev")
    install_package("src.security")
    install_package("src.security.features_utils")
    install_package("src.core")

    for name in [
        "admin",
        "analytics",
        "code_execution",
        "code_submissions",
        "health",
        "instance",
        "plans",
        "usergroups",
        "dev",
        "trail",
        "users",
        "auth",
        "orgs",
        "roles",
        "search",
        "stream",
        "api_tokens",
        "webhooks",
    ]:
        install_router_module(f"src.routers.{name}", f"src.routers.{name}")

    install_router_module("src.routers.utils", "src.routers.utils")

    install_router_module(
        "src.routers.integrations.zapier", "src.routers.integrations.zapier"
    )
    sys.modules["src.routers.integrations"].zapier = sys.modules[
        "src.routers.integrations.zapier"
    ]

    install_router_module("src.routers.ai.ai", "src.routers.ai.ai")
    install_router_module("src.routers.ai.magicblocks", "src.routers.ai.magicblocks")
    install_router_module(
        "src.routers.ai.courseplanning", "src.routers.ai.courseplanning"
    )
    install_router_module("src.routers.ai.rag", "src.routers.ai.rag")
    sys.modules["src.routers.ai"].ai = sys.modules["src.routers.ai.ai"]
    sys.modules["src.routers.ai"].magicblocks = sys.modules[
        "src.routers.ai.magicblocks"
    ]
    sys.modules["src.routers.ai"].courseplanning = sys.modules[
        "src.routers.ai.courseplanning"
    ]
    sys.modules["src.routers.ai"].rag = sys.modules["src.routers.ai.rag"]

    install_router_module("src.routers.boards.boards", "src.routers.boards.boards")
    install_router_module(
        "src.routers.boards.boards_playground",
        "src.routers.boards.boards_playground",
    )
    sys.modules["src.routers.boards"].boards = sys.modules["src.routers.boards.boards"]
    sys.modules["src.routers.boards"].boards_playground = sys.modules[
        "src.routers.boards.boards_playground"
    ]
    sys.modules["src.routers.boards.boards"].internal_router = _named_router(
        "src.routers.boards.boards.internal_router"
    )

    install_router_module("src.routers.orgs.ai_credits", "src.routers.orgs.ai_credits")
    install_router_module(
        "src.routers.orgs.custom_domains",
        "src.routers.orgs.custom_domains",
        public_router=_named_router("src.routers.orgs.custom_domains.public_router"),
        internal_router=_named_router("src.routers.orgs.custom_domains.internal_router"),
    )
    install_router_module(
        "src.routers.orgs.packs",
        "src.routers.orgs.packs",
        internal_router=_named_router("src.routers.orgs.packs.internal_router"),
    )
    sys.modules["src.routers.orgs"].ai_credits = sys.modules[
        "src.routers.orgs.ai_credits"
    ]
    sys.modules["src.routers.orgs"].custom_domains = sys.modules[
        "src.routers.orgs.custom_domains"
    ]
    sys.modules["src.routers.orgs"].packs = sys.modules["src.routers.orgs.packs"]

    install_router_module("src.routers.courses.chapters", "src.routers.courses.chapters")
    install_router_module(
        "src.routers.courses.collections", "src.routers.courses.collections"
    )
    install_router_module("src.routers.courses.courses", "src.routers.courses.courses")
    install_router_module(
        "src.routers.courses.assignments", "src.routers.courses.assignments"
    )
    install_router_module(
        "src.routers.courses.certifications", "src.routers.courses.certifications"
    )
    install_router_module("src.routers.courses.migration", "src.routers.courses.migration")
    install_router_module(
        "src.routers.courses.activities.activities",
        "src.routers.courses.activities.activities",
    )
    install_router_module(
        "src.routers.courses.activities.blocks",
        "src.routers.courses.activities.blocks",
    )
    sys.modules["src.routers.courses"].chapters = sys.modules[
        "src.routers.courses.chapters"
    ]
    sys.modules["src.routers.courses"].collections = sys.modules[
        "src.routers.courses.collections"
    ]
    sys.modules["src.routers.courses"].courses = sys.modules["src.routers.courses.courses"]
    sys.modules["src.routers.courses"].assignments = sys.modules[
        "src.routers.courses.assignments"
    ]
    sys.modules["src.routers.courses"].certifications = sys.modules[
        "src.routers.courses.certifications"
    ]
    sys.modules["src.routers.courses"].migration = sys.modules[
        "src.routers.courses.migration"
    ]
    sys.modules["src.routers.courses.activities"].activities = sys.modules[
        "src.routers.courses.activities.activities"
    ]
    sys.modules["src.routers.courses.activities"].blocks = sys.modules[
        "src.routers.courses.activities.blocks"
    ]

    install_router_module(
        "src.routers.communities.communities", "src.routers.communities.communities"
    )
    install_router_module(
        "src.routers.communities.discussions", "src.routers.communities.discussions"
    )
    sys.modules["src.routers.communities"].communities = sys.modules[
        "src.routers.communities.communities"
    ]
    sys.modules["src.routers.communities"].discussions = sys.modules[
        "src.routers.communities.discussions"
    ]

    install_router_module("src.routers.podcasts.podcasts", "src.routers.podcasts.podcasts")
    install_router_module("src.routers.podcasts.episodes", "src.routers.podcasts.episodes")
    sys.modules["src.routers.podcasts"].podcasts = sys.modules[
        "src.routers.podcasts.podcasts"
    ]
    sys.modules["src.routers.podcasts"].episodes = sys.modules[
        "src.routers.podcasts.episodes"
    ]

    install_router_module(
        "src.routers.playgrounds.playgrounds", "src.routers.playgrounds.playgrounds"
    )
    install_router_module(
        "src.routers.playgrounds.playgrounds_generator",
        "src.routers.playgrounds.playgrounds_generator",
    )
    sys.modules["src.routers.playgrounds"].playgrounds = sys.modules[
        "src.routers.playgrounds.playgrounds"
    ]
    sys.modules["src.routers.playgrounds"].playgrounds_generator = sys.modules[
        "src.routers.playgrounds.playgrounds_generator"
    ]

    install(
        "src.core.ee_hooks",
        register_ee_routers=lambda _router: None,
    )
    install(
        "src.services.dev.dev",
        isDevModeEnabledOrRaise=_dependency("isDevModeEnabledOrRaise"),
    )
    install("src.security.auth", get_current_user=object())

    async def require_non_api_token_user(user):
        return user

    async def get_authenticated_non_api_token_user(request=None, db_session=None):
        return object()

    install(
        "src.security.api_token_utils",
        require_non_api_token_user=require_non_api_token_user,
        get_authenticated_non_api_token_user=get_authenticated_non_api_token_user,
    )

    plan_module = _module(
        "src.security.features_utils.plan_check",
        require_plan=_plan_factory("require_plan"),
        require_plan_for_boards=_plan_factory("require_plan_for_boards"),
        require_plan_for_certifications=_plan_factory("require_plan_for_certifications"),
        require_plan_for_community=_plan_factory("require_plan_for_community"),
        require_plan_for_usergroups=_plan_factory("require_plan_for_usergroups"),
        require_plan_for_playgrounds=_plan_factory("require_plan_for_playgrounds"),
    )
    monkeypatch.setitem(sys.modules, "src.security.features_utils.plan_check", plan_module)


@pytest.fixture
def root_router(monkeypatch):
    _install_stub_modules(monkeypatch)
    monkeypatch.delitem(sys.modules, "src.router", raising=False)

    include_calls = []
    original_include_router = APIRouter.include_router

    def include_spy(self, router, *args, **kwargs):
        include_calls.append(
            {
                "router_name": getattr(router, "_router_name", router.__class__.__name__),
                "prefix": kwargs.get("prefix"),
                "tags": kwargs.get("tags"),
                "dependencies": kwargs.get("dependencies", []),
            }
        )
        return original_include_router(self, router, *args, **kwargs)

    with patch.object(APIRouter, "include_router", new=include_spy):
        module = importlib.import_module("src.router")

    module._include_calls = include_calls
    return module


def _dependency_names(call_record):
    return [
        getattr(dep.dependency, "__name__", repr(dep.dependency))
        for dep in call_record["dependencies"]
    ]


class TestRootRouter:
    def test_root_router_wires_key_routes_and_dependencies(self, root_router):
        assert root_router.v1_router.prefix == "/api/v1"

        calls = root_router._include_calls
        assert len(calls) >= 30

        users = next(call for call in calls if call["router_name"] == "src.routers.users")
        assert users["prefix"] == "/users"
        assert users["tags"] == ["users"]
        assert _dependency_names(users) == ["get_non_api_token_user"]

        usergroups = next(
            call for call in calls if call["router_name"] == "src.routers.usergroups"
        )
        assert usergroups["prefix"] == "/usergroups"
        assert usergroups["tags"] == ["usergroups"]
        # F-2: usergroups now requires an authenticated, non-API-token user
        # in addition to the plan gate. Before the fix, anonymous callers
        # could bypass auth if the plan check happened to allow them.
        assert _dependency_names(usergroups) == [
            "get_authenticated_non_api_token_user",
            "require_plan_for_usergroups_standard_user_groups",
        ]

        api_tokens = next(
            call for call in calls if call["router_name"] == "src.routers.api_tokens"
        )
        assert api_tokens["prefix"] == "/orgs"
        assert api_tokens["tags"] == ["api-tokens"]
        # F-2: api_tokens uses the stricter auth dep that also rejects anon.
        assert _dependency_names(api_tokens) == [
            "get_authenticated_non_api_token_user",
            "require_plan_pro_api_access",
        ]

        custom_domains_public = next(
            call
            for call in calls
            if call["router_name"] == "src.routers.orgs.custom_domains.public_router"
            and call["prefix"] == "/orgs"
            and call["tags"] == ["custom-domains"]
            and not call["dependencies"]
        )
        assert custom_domains_public["prefix"] == "/orgs"

        custom_domains_internal = next(
            call
            for call in calls
            if call["router_name"] == "src.routers.orgs.custom_domains.internal_router"
        )
        assert custom_domains_internal["prefix"] == "/internal"
        assert custom_domains_internal["tags"] == ["custom-domains-internal"]

        packs_internal = next(
            call for call in calls if call["router_name"] == "src.routers.orgs.packs.internal_router"
        )
        assert packs_internal["prefix"] == "/internal/packs"
        assert packs_internal["tags"] == ["packs-internal"]

        boards = next(call for call in calls if call["router_name"] == "src.routers.boards.boards")
        assert boards["prefix"] == "/boards"
        assert boards["tags"] == ["boards"]
        # boards has some public-ish endpoints (board preview) so it keeps the
        # permissive dep; the strict dep is applied on boards_playground below.
        assert _dependency_names(boards) == [
            "get_non_api_token_user",
            "require_plan_for_boards_pro_boards",
        ]

        boards_internal = next(
            call
            for call in calls
            if call["router_name"] == "src.routers.boards.boards.internal_router"
            and call["tags"] == ["boards-internal"]
        )
        assert boards_internal["prefix"] == "/boards"

        dev = next(call for call in calls if call["router_name"] == "src.routers.dev")
        assert dev["prefix"] == "/dev"
        assert _dependency_names(dev) == [
            "isDevModeEnabledOrRaise",
            "get_non_api_token_user",
        ]

        health = next(call for call in calls if call["router_name"] == "src.routers.health")
        assert health["prefix"] == "/health"
        assert health["tags"] == ["health"]
        assert _dependency_names(health) == ["get_non_api_token_user"]

    async def test_get_non_api_token_user_delegates(self, root_router):
        with patch.object(
            root_router,
            "require_non_api_token_user",
            new=AsyncMock(return_value="delegated-user"),
        ) as mock_require:
            result = await root_router.get_non_api_token_user("user")

        mock_require.assert_awaited_once_with("user")
        assert result == "delegated-user"
