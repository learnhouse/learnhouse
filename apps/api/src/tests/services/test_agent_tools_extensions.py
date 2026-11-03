"""Tools from outside the built-in modules (src/services/ai/tools/__init__.py):
registered modules, installed entry points and EE hooks, and how their
toolsets reach the MCP tool filter."""

from __future__ import annotations

from types import ModuleType, SimpleNamespace
from unittest.mock import patch

import pytest
from pydantic import BaseModel

from src.security.rbac import AccessAction
from src.services.ai import tools as tools_pkg
from src.services.ai.tools import ActionTier, ToolModule, ToolSpec
from src.services.mcp import server as srv

# The real lookups, kept before the autouse fixture stubs them out.
REAL_ENTRY_POINT_MODULES = tools_pkg._entry_point_modules
REAL_EE_MODULES = tools_pkg._ee_modules


class _Params(BaseModel):
    pass


async def _run(ctx, params):
    return {"ok": True}


def _spec(name, **kw):
    return ToolSpec(
        name=name, description=f"{name} tool", params_model=_Params, tier=ActionTier.READ,
        rights_bucket="courses", access_action=AccessAction.READ, execute=_run, **kw,
    )


@pytest.fixture(autouse=True)
def clean_extensions():
    saved = list(tools_pkg._extensions)
    tools_pkg._extensions.clear()
    tools_pkg._registry = None
    with (
        patch.object(tools_pkg, "_entry_point_modules", return_value=[]),
        patch.object(tools_pkg, "_ee_modules", return_value=[]),
    ):
        yield
    tools_pkg._extensions[:] = saved
    tools_pkg._registry = None


def test_built_in_modules_are_declared_once():
    names = [m.name for m in tools_pkg.TOOL_MODULES]
    assert len(names) == len(set(names))
    assert tools_pkg.TOOLSET_OF_MODULE["paths"] == "paths"
    assert "paths" in tools_pkg.TOOLSETS
    specs = {s.name: s for s in tools_pkg.build_registry().specs()}
    assert specs["create_path"].feature == "paths" and specs["create_path"].toolset == "paths"
    # A module's own spec fields win over the module defaults.
    assert specs["get_course"].toolset == "core"


def test_registered_module_joins_the_registry_and_its_toolset():
    tools_pkg.get_registry()
    tools_pkg.register_tool_module(
        ToolModule("acme.tools", "acme", feature="boards", specs=(_spec("acme_report"), _spec("acme_mine", feature="communities")))
    )
    # Registering resets the cached registry, so the next build includes it.
    assert tools_pkg._registry is None
    registry = tools_pkg.get_registry()
    spec = registry.get("acme_report")
    assert spec.toolset == "acme" and spec.feature == "boards" and spec.title == "Acme report"
    assert registry.get("acme_mine").feature == "communities"
    assert "acme" in tools_pkg.known_toolsets(registry)
    with pytest.raises(ValueError):
        tools_pkg.register_tool_module(ToolModule("acme.tools", "acme", specs=()))
    with pytest.raises(ValueError):
        tools_pkg.register_tool_module(ToolModule("paths", "paths"))


def test_toolset_filter_knows_extension_toolsets():
    query = SimpleNamespace(query_params={"toolsets": "acme,authoring"})
    assert srv.requested_toolsets(query, ("core", "acme", "courses")) == {"core", "acme", "courses"}
    # Without an explicit list, the registry's toolsets are used.
    tools_pkg.register_tool_module(ToolModule("acme.tools", "acme", specs=(_spec("acme_report"),)))
    assert "acme" in srv.requested_toolsets(SimpleNamespace(query_params={"toolsets": "acme"}))
    admin = srv.requested_toolsets(SimpleNamespace(query_params={"toolsets": "admin"}))
    assert admin == {"core", "people", "org"}


def test_extra_modules_and_broken_extensions(caplog):
    broken = ToolModule("acme.missing_module", "acme")
    registry = tools_pkg.build_registry(extra=[broken, ToolModule("acme.ok", "acme", specs=(_spec("acme_ok"),))])
    assert registry.get("acme_ok") is not None
    assert "could not load tool module acme.missing_module" in caplog.text
    # A built-in module that fails to load is a bug, not something to skip.
    with patch.object(tools_pkg, "TOOL_MODULES", (ToolModule("does_not_exist", "core"),)):
        with pytest.raises(ModuleNotFoundError):
            tools_pkg.build_registry()


def test_entry_points_load_modules_and_tool_modules(caplog):
    plugin = ModuleType("acme_plugin")
    plugin.SPECS = [_spec("acme_from_module")]
    plugin.TOOLSET = "acme"
    plugin.FEATURE = "playgrounds"
    bare = ModuleType("bare_plugin")
    bare.SPECS = [_spec("bare_tool")]

    def ep(name, value):
        def load():
            if isinstance(value, Exception):
                raise value
            return value

        return SimpleNamespace(name=name, load=load)

    points = [
        ep("acme", plugin),
        ep("bare", bare),
        ep("declared", ToolModule("acme.declared", "acme", specs=(_spec("acme_declared"),))),
        ep("bad", ImportError("missing dependency")),
        ep("wrong", object()),
    ]
    with patch("importlib.metadata.entry_points", return_value=points) as found:
        modules = REAL_ENTRY_POINT_MODULES()
    found.assert_called_once_with(group=tools_pkg.ENTRY_POINT_GROUP)
    by_module = {m.module: m for m in modules}
    assert by_module["acme_plugin"].toolset == "acme" and by_module["acme_plugin"].feature == "playgrounds"
    assert by_module["bare_plugin"].toolset == "bare" and by_module["bare_plugin"].feature is None
    assert "acme.declared" in by_module and len(modules) == 3
    assert "could not load tool entry point bad" in caplog.text
    assert "could not load tool entry point wrong" in caplog.text
    # Their tools join a build like any other.
    with patch.object(tools_pkg, "_entry_point_modules", return_value=modules):
        registry = tools_pkg.build_registry()
    assert registry.get("acme_from_module").feature == "playgrounds"
    assert registry.get("bare_tool").toolset == "bare"


def test_ee_hook_registers_tools(caplog):
    hooks = ModuleType("ee.hooks")
    hooks.register_ai_tools = lambda register: register(ToolModule("ee.tools", "enterprise", specs=(_spec("ee_tool"),)))
    with patch("src.core.ee_hooks.get_ee_hooks", return_value=hooks):
        assert [m.module for m in REAL_EE_MODULES()] == ["ee.tools"]

    def broken(register):
        raise RuntimeError("boom")

    hooks.register_ai_tools = broken
    with patch("src.core.ee_hooks.get_ee_hooks", return_value=hooks):
        assert REAL_EE_MODULES() == []
    assert "register_ai_tools failed" in caplog.text
    with patch("src.core.ee_hooks.get_ee_hooks", return_value=None):
        assert REAL_EE_MODULES() == []
    with patch("src.core.ee_hooks.get_ee_hooks", return_value=ModuleType("ee.hooks")):
        assert REAL_EE_MODULES() == []


def test_as_tool_module_rejects_other_objects():
    with pytest.raises(TypeError):
        tools_pkg._as_tool_module(object(), "x")
    module = ToolModule("x", "x", specs=())
    assert tools_pkg._as_tool_module(module, "x") is module
