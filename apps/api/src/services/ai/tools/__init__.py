"""Agent tool registry: public entrypoint.

`build_registry()` assembles every domain module's SPECS into a fresh
ToolRegistry. Domain modules are added incrementally; each exposes a
module-level `SPECS: list[ToolSpec]`.
"""

from dataclasses import replace

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
    "ActionTier",
    "PendingProposal",
    "ToolContext",
    "ToolOutcome",
    "ToolSpec",
    "ToolRegistry",
    "build_registry",
    "make_synthetic_request",
    "run_tool",
]

_registry: ToolRegistry | None = None


def build_registry() -> ToolRegistry:
    """Assemble the full tool registry (fresh instance)."""
    from src.services.ai.tools import (  # noqa: PLC0415 (deferred, avoids import cycles)
        activities,
        analytics,
        assignments,
        boards,
        chapters,
        communities,
        content_assets,
        content_blocks,
        content_edit,
        course_admin,
        course_audit,
        course_copy,
        course_replace,
        course_stats,
        courses,
        discovery,
        fetch,
        learners,
        library,
        org,
        playgrounds,
        roles,
        usergroups,
        users,
    )

    registry = ToolRegistry()
    # Plan feature per domain module, enforced by run_tool and used to hide
    # tools the org cannot use. Courses, assignments, learners, users and the
    # library are on every plan.
    module_features = {
        communities: "communities",
        playgrounds: "playgrounds",
        boards: "boards",
        usergroups: "usergroups",
        roles: "roles",
        analytics: "analytics",
    }
    for module in (
        discovery,
        fetch,
        courses,
        chapters,
        activities,
        content_edit,
        content_blocks,
        content_assets,
        course_copy,
        course_replace,
        course_audit,
        course_admin,
        assignments,
        learners,
        course_stats,
        analytics,
        library,
        communities,
        playgrounds,
        boards,
        users,
        usergroups,
        roles,
        org,
    ):
        toolset = TOOLSET_OF_MODULE.get(module.__name__.rsplit(".", 1)[-1], "core")
        for spec in module.SPECS:
            registry.register(_finish_spec(spec, module_features.get(module), toolset))
    return registry


# Tool groups, by domain module. "core" (orientation, lookup and reading what
# you found) is always on, so any narrowed set can still find its way.
TOOLSET_OF_MODULE = {
    "discovery": "core",
    "fetch": "core",
    "courses": "courses",
    "chapters": "courses",
    "activities": "courses",
    "content_edit": "content",
    "content_blocks": "content",
    "content_assets": "content",
    "course_copy": "advanced",
    "course_replace": "advanced",
    "course_audit": "advanced",
    "course_admin": "advanced",
    "assignments": "teaching",
    "learners": "teaching",
    "course_stats": "teaching",
    "analytics": "teaching",
    "library": "library",
    "communities": "communities",
    "playgrounds": "playgrounds",
    "boards": "boards",
    "users": "people",
    "usergroups": "people",
    "roles": "people",
    "org": "org",
}
CORE_TOOLS = {"get_course", "get_activity_content"}
TOOLSETS = tuple(dict.fromkeys(TOOLSET_OF_MODULE.values()))


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
