"""Agent tool registry: public entrypoint.

`build_registry()` assembles every tool module's SPECS into a fresh
ToolRegistry. Built-in modules are listed in `TOOL_MODULES` with the toolset
they belong to and the plan feature that gates them; each exposes a
module-level `SPECS: list[ToolSpec]`.

Tools can also come from outside this package, without editing it:

* `register_tool_module(ToolModule(...))` from code that runs before the
  registry is first built (the Enterprise Edition's hooks, a plugin's import);
* an installed package declaring an entry point in the ``learnhouse.ai_tools``
  group that loads a module with `SPECS` (and optionally `TOOLSET` and
  `FEATURE`) or a `ToolModule`;
* an EE hooks module defining `register_ai_tools(register)`, called with
  `register_tool_module`.

Every tool, wherever it comes from, runs through the same `run_tool`
pipeline, so membership, plan, scope, rights and approval checks apply to
extensions exactly as to built-in tools.
"""

import importlib
import logging
from dataclasses import dataclass, replace
from types import ModuleType
from typing import Iterable

from src.services.ai.tools.base import (
    ActionTier,
    PendingProposal,
    ToolContext,
    ToolOutcome,
    ToolSpec,
    make_synthetic_request,
)
from src.services.ai.tools.registry import ToolRegistry, run_tool

__all__ = [
    "TOOLSETS",
    "TOOL_MODULES",
    "ActionTier",
    "PendingProposal",
    "ToolContext",
    "ToolModule",
    "ToolOutcome",
    "ToolSpec",
    "ToolRegistry",
    "build_registry",
    "get_registry",
    "known_toolsets",
    "make_synthetic_request",
    "register_tool_module",
    "run_tool",
]

logger = logging.getLogger(__name__)

ENTRY_POINT_GROUP = "learnhouse.ai_tools"


@dataclass(frozen=True)
class ToolModule:
    """A group of tools and where they belong.

    `module` is a dotted import path, or a short name inside this package.
    `specs` may be given instead, for tools built at runtime."""

    module: str
    # Group MCP clients filter on (?toolsets=...). "core" is always listed.
    toolset: str
    # Plan feature gating every tool of the module, unless a spec sets its own.
    feature: str | None = None
    specs: tuple[ToolSpec, ...] | None = None

    @property
    def name(self) -> str:
        return self.module.rsplit(".", 1)[-1]

    def load_specs(self) -> list[ToolSpec]:
        if self.specs is not None:
            return list(self.specs)
        path = self.module if "." in self.module else f"{__name__}.{self.module}"
        return list(importlib.import_module(path).SPECS)


# Built-in tools, in listing order. "core" (orientation, lookup and reading
# what you found) is always on, so any narrowed set can still find its way.
# Courses, assignments, learners, users and the library are on every plan.
TOOL_MODULES: tuple[ToolModule, ...] = (
    ToolModule("discovery", "core"),
    ToolModule("fetch", "core"),
    ToolModule("courses", "courses"),
    ToolModule("chapters", "courses"),
    ToolModule("activities", "courses"),
    ToolModule("content_edit", "content"),
    ToolModule("content_blocks", "content"),
    ToolModule("content_assets", "content"),
    ToolModule("course_copy", "advanced"),
    ToolModule("course_replace", "advanced"),
    ToolModule("course_audit", "advanced"),
    ToolModule("course_admin", "advanced"),
    ToolModule("assignments", "teaching"),
    ToolModule("learners", "teaching"),
    ToolModule("course_stats", "teaching"),
    ToolModule("paths", "paths", "paths"),
    ToolModule("library", "library"),
    ToolModule("communities", "communities", "communities"),
    ToolModule("playgrounds", "playgrounds", "playgrounds"),
    ToolModule("boards", "boards", "boards"),
    ToolModule("users", "people"),
    ToolModule("usergroups", "people", "usergroups"),
    ToolModule("roles", "people", "roles"),
    ToolModule("org", "org"),
)

TOOLSET_OF_MODULE = {m.name: m.toolset for m in TOOL_MODULES}
# Built-in toolsets; known_toolsets() adds the ones extensions bring.
TOOLSETS = tuple(dict.fromkeys(m.toolset for m in TOOL_MODULES))
# Reading tools that live in a domain module but belong in "core".
CORE_TOOLS = {"get_course", "get_activity_content"}

_extensions: list[ToolModule] = []
_registry: ToolRegistry | None = None


def register_tool_module(module: ToolModule) -> None:
    """Add tools from outside this package. Call it before the registry is
    first built (see get_registry); a later call resets the registry so the
    next build includes them."""
    global _registry
    if any(m.module == module.module for m in (*TOOL_MODULES, *_extensions)):
        raise ValueError(f"tool module already registered: {module.module}")
    _extensions.append(module)
    _registry = None


def _entry_point_modules() -> list[ToolModule]:
    from importlib.metadata import entry_points

    found: list[ToolModule] = []
    for ep in entry_points(group=ENTRY_POINT_GROUP):
        try:
            found.append(_as_tool_module(ep.load(), ep.name))
        except Exception:
            # A broken plugin must not take the built-in tools down with it.
            logger.exception("agent-tools: could not load tool entry point %s", ep.name)
    return found


def _as_tool_module(loaded: object, name: str) -> ToolModule:
    if isinstance(loaded, ToolModule):
        return loaded
    if isinstance(loaded, ModuleType):
        return ToolModule(
            module=loaded.__name__,
            toolset=getattr(loaded, "TOOLSET", name),
            feature=getattr(loaded, "FEATURE", None),
            specs=tuple(loaded.SPECS),
        )
    raise TypeError(f"entry point {name} must load a module with SPECS or a ToolModule")


def _ee_modules() -> list[ToolModule]:
    from src.core.ee_hooks import get_ee_hooks

    hooks = get_ee_hooks()
    hook = getattr(hooks, "register_ai_tools", None) if hooks else None
    if hook is None:
        return []
    found: list[ToolModule] = []
    try:
        hook(found.append)
    except Exception:
        logger.exception("agent-tools: EE register_ai_tools failed")
    return found


def build_registry(extra: Iterable[ToolModule] | None = None) -> ToolRegistry:
    """Assemble the full tool registry (fresh instance): built-in modules,
    then registered extensions, EE and installed plugins, then `extra`."""
    registry = ToolRegistry()
    modules = [*TOOL_MODULES, *_extensions, *_ee_modules(), *_entry_point_modules(), *(extra or ())]
    for module in modules:
        try:
            specs = module.load_specs()
        except Exception:
            if module in TOOL_MODULES:
                raise
            logger.exception("agent-tools: could not load tool module %s", module.module)
            continue
        for spec in specs:
            # Plan feature per module, enforced by run_tool and used to hide
            # tools the org cannot use.
            registry.register(_finish_spec(spec, module.feature, module.toolset))
    return registry


def known_toolsets(registry: ToolRegistry | None = None) -> tuple[str, ...]:
    """Every toolset name in the registry, built-in ones first."""
    registry = registry or get_registry()
    names = [*TOOLSETS, *(s.toolset for s in registry.specs() if s.toolset)]
    return tuple(dict.fromkeys(names))


def _finish_spec(spec: ToolSpec, feature: str | None, toolset: str) -> ToolSpec:
    """Fill the descriptive fields a domain module left unset."""
    changes: dict = {}
    if spec.toolset is None:
        changes["toolset"] = "core" if spec.name in CORE_TOOLS else toolset
    if spec.feature is None and feature:
        changes["feature"] = feature
    if spec.title is None:
        changes["title"] = spec.name.replace("_", " ").capitalize()
    return replace(spec, **changes) if changes else spec


def get_registry() -> ToolRegistry:
    """Process-wide singleton registry."""
    global _registry
    if _registry is None:
        _registry = build_registry()
    return _registry
