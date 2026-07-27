"""Agent tool registry — public entrypoint.

`build_registry()` assembles every domain module's SPECS into a fresh
ToolRegistry. Domain modules are added incrementally; each exposes a
module-level `SPECS: list[ToolSpec]`.
"""

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
    from src.services.ai.tools import (  # noqa: PLC0415 — deferred, avoids import cycles
        activities,
        analytics,
        assignments,
        boards,
        chapters,
        communities,
        content_assets,
        content_blocks,
        content_edit,
        courses,
        library,
        org,
        playgrounds,
        resolve,
        roles,
        usergroups,
        users,
    )

    registry = ToolRegistry()
    for module in (
        courses,
        chapters,
        activities,
        content_blocks,
        content_assets,
        content_edit,
        assignments,
        library,
        communities,
        playgrounds,
        boards,
        users,
        usergroups,
        roles,
        org,
        analytics,
        resolve,
    ):
        registry.register_all(module.SPECS)
    return registry


def get_registry() -> ToolRegistry:
    """Process-wide singleton registry."""
    global _registry
    if _registry is None:
        _registry = build_registry()
    return _registry
