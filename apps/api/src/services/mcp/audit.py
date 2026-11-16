"""A record of every change an AI app makes.

MCP calls all arrive as `POST /mcp`, so the HTTP audit middleware cannot tell
a course deletion from a page edit. Each tool call that is not a plain read
is recorded here instead: always in the API log, and in the organization's
audit log when it has one (an Enterprise feature).
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

from src.security.mcp_auth import MCPPrincipal
from src.services.ai.tools.base import ToolSpec

logger = logging.getLogger("learnhouse.mcp.audit")

_MAX_PAYLOAD = 8 * 1024
_tasks: set = set()


def _payload(arguments: dict[str, Any]) -> dict[str, Any]:
    try:
        size = len(json.dumps(arguments, default=str))
    except (TypeError, ValueError):
        return {"_omitted": "unserializable"}
    if size > _MAX_PAYLOAD:
        # Keep the ids, drop the bulk (page content, html).
        return {
            k: v for k, v in arguments.items() if k.endswith("_uuid") or isinstance(v, (bool, int))
        } | {"_omitted": "too_large", "_bytes": size}
    return arguments


def record(
    principal: MCPPrincipal,
    org_id: int,
    spec: ToolSpec,
    arguments: dict[str, Any],
    status: str,
    code: str | None = None,
    approval: str | None = None,
) -> None:
    """Log one call. Never raises and never delays the call.

    `approval` says how a person approved it ("link apr_...", "form"), so the
    log shows who said yes to what."""
    user = principal.user
    logger.info(
        "mcp tool=%s status=%s code=%s org=%s actor=%s via=%s connection=%s approval=%s",
        spec.name,
        status,
        code or "",
        org_id,
        getattr(user, "user_uuid", "?"),
        principal.client_name or principal.kind,
        principal.connection_id,
        approval or "",
    )
    if status != "executed":
        return
    try:
        task = asyncio.get_running_loop().create_task(
            _to_org_log(principal, org_id, spec, arguments, approval)
        )
    except RuntimeError:
        return
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)


async def _to_org_log(
    principal: MCPPrincipal, org_id: int, spec: ToolSpec, arguments: dict[str, Any], approval: str | None = None
) -> None:
    """Hand the call to the audit log (EE): the typed events the tool's
    services recorded get the app and approval merged in, or one entry is
    written for the tool. Actor is the member behind the connection; via is
    ``mcp``."""
    from src.core.ee_hooks import audit_agent_action, is_ee_available

    if not is_ee_available():
        return
    try:
        from src.security.auth import resolve_acting_user_id

        target = arguments.get(spec.target_param) if spec.target_param else None
        audit_agent_action(
            via="mcp",
            user_id=resolve_acting_user_id(principal.user),
            org_id=org_id,
            tool=spec.name,
            target_kind=spec.target_kind,
            target_id=target,
            title=spec.title,
            args=_payload(arguments),
            details={
                "app": principal.client_name or principal.kind,
                **({"approval": approval} if approval else {}),
            },
        )
    except Exception:
        logger.exception("mcp audit: could not write to the organization's audit log")
