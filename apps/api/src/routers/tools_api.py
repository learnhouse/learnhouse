"""Tools API: every agent tool as a plain HTTP endpoint for org API tokens.

``POST /api/v1/tools/{tool_name}`` runs one tool of the shared registry (the
same tools the MCP server and Atlas use) with the JSON body as its arguments,
through the same ``run_tool`` pipeline: plan feature, the token's own rights
buckets, resource RBAC, the services' checks, and approval for the calls that
need a person's yes. So a feature that has tools (plays, boards, live
sessions, payments, companies, ...) is reachable from scripts and no-code
tools without a second, hand-written REST surface, and is documented in the
organization's API token OpenAPI spec (tags ``tools/<toolset>``).

Approvals work as on MCP for API tokens: the first call answers 409 with an
``approval_id`` and an ``approval_url`` the member who created the token opens
in LearnHouse; repeating the exact call with the ``X-Approval-Id`` header then
runs it, once.

Only API tokens use these routes. People signed in use the dashboard, Atlas
or the MCP server, which carry their own session rules.
"""

import logging
from typing import Any, Optional

from fastapi import APIRouter, Body, Depends, Header, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlmodel.ext.asyncio.session import AsyncSession

from src.core.events.database import get_db_session
from src.db.users import APITokenUser
from src.security.auth import get_current_user
from src.services.ai.tools import ActionTier, ToolSpec, get_registry, run_tool

logger = logging.getLogger(__name__)

TAG_PREFIX = "tools/"
APPROVAL_HEADER = "X-Approval-Id"

# Denial codes from run_tool, as HTTP statuses.
_STATUS = {
    "unknown_tool": 404,
    "invalid_args": 422,
    "feature_unavailable": 403,
    "plan_limit": 403,
    "missing_right": 403,
    "rbac_denied": 403,
    "preflight_denied": 403,
    "not_for_api_tokens": 403,
    "insufficient_scope": 403,
    "org_mismatch": 403,
    "tier_not_allowed": 403,
    "approval_required": 409,
    "approval_pending": 409,
    "approval_expired": 409,
    "approval_mismatch": 409,
    "approval_unavailable": 503,
    "mcp_disabled": 403,
    "internal_error": 500,
}


def _status_for(code: str | None) -> int:
    if not code:
        return 400
    if code.startswith("http_"):
        try:
            return int(code[5:])
        except ValueError:
            return 400
    return _STATUS.get(code, 400)


def _error(code: str, message: str, **extra: Any) -> JSONResponse:
    body = {"error": {"code": code, "message": message, **{k: v for k, v in extra.items() if v is not None}}}
    return JSONResponse(status_code=_status_for(code), content=body)


def _describe(spec: ToolSpec) -> str:
    lines = [spec.description, ""]
    lines.append(f"Tier: {spec.tier.value}. Toolset: {spec.toolset or 'core'}.")
    if spec.rights_bucket:
        action = getattr(spec.access_action, "value", spec.access_action)
        lines.append(f"Token right needed: {spec.rights_bucket}.action_{action}.")
    if spec.feature:
        lines.append(f"Plan feature: {spec.feature}.")
    if spec.may_need_approval:
        lines.append(
            "May need the token creator's approval: the first call answers 409 with approval_id and "
            f"approval_url; once approved, repeat the same call with the {APPROVAL_HEADER} header."
        )
    return "\n".join(lines)


def _require_token(current_user: Any) -> APITokenUser:
    if not isinstance(current_user, APITokenUser):
        raise HTTPException(
            status_code=403,
            detail="The tools API is for API tokens. Signed-in members use the dashboard, Atlas or the MCP server.",
        )
    return current_user


async def _org_and_config(db_session: AsyncSession, org_id: int):
    from src.services.mcp import server as srv

    org, config = await srv.load_org_and_config(db_session, org_id)
    if org is None:
        raise HTTPException(status_code=404, detail="Organization not found")
    return org, config


def _principal(token: APITokenUser):
    from src.security.mcp_auth import MCPPrincipal
    from src.services.mcp import oauth

    return MCPPrincipal(
        user=token,
        org_id=token.org_id,
        scopes=frozenset(oauth.SUPPORTED_SCOPES),
        kind="api_token",
        client_name=token.token_name or "API token",
    )


async def call_tool(
    spec: ToolSpec,
    arguments: dict[str, Any],
    token: APITokenUser,
    db_session: AsyncSession,
    approval_id: Optional[str] = None,
) -> JSONResponse:
    """Run one tool for an API token and shape the answer as HTTP."""
    from src.security.org_scope import org_scope
    from src.services.ai.tools.base import ToolOutcome
    from src.services.ai.tools.registry import resolve_names
    from src.services.mcp import approvals, audit
    from src.services.mcp import server as srv
    from src.services.mcp.handlers import _approval_summary, _describe as describe_target

    registry = get_registry()
    org, config = await _org_and_config(db_session, token.org_id)
    org_id = org.id
    principal = _principal(token)
    if not srv.spec_visible(spec, principal, config, org_id, None):
        return _error("unknown_tool", f"{spec.name} is not available to this token (plan, feature or token rights).")

    ctx = srv.tool_context(principal, org, db_session)
    with org_scope(org_id):
        named = await resolve_names(spec, arguments, ctx)
    if isinstance(named, ToolOutcome):
        return _error(named.denied_code or "denied", named.reason or "Denied")
    call, resolved = named

    approver = token.created_by_user_id or None
    if approval_id:
        if approver is None:
            return _error("approval_unavailable", "This API token has no member to approve its calls.")
        try:
            status = approvals.consume(
                str(approval_id), grant=principal.connection_id, user_id=approver,
                org_id=org_id, tool=spec.name, arguments=call,
            )
        except approvals.ApprovalUnavailable:
            return _error("approval_unavailable", "Approvals are unavailable right now")
        if status != "approved":
            code = {"pending": "approval_pending", "declined": "approval_expired"}.get(status, f"approval_{status}")
            if code not in _STATUS:
                code = "approval_expired"
            return _error(code, f"That approval is {status}.")
        ctx.approved = True

    try:
        outcome = await run_tool(registry, spec.name, call, ctx)
        if outcome.status == "executed":
            await db_session.commit()
        else:
            await db_session.rollback()
    except Exception:
        await db_session.rollback()
        logger.exception("tools-api: tool %s crashed", spec.name)
        audit.record(principal, org_id, spec, call, "crashed", "internal_error")
        return _error("internal_error", "The tool failed unexpectedly")

    if outcome.status != "executed" and outcome.denied_code == "approval_required":
        if approver is None:
            return _error("approval_unavailable", "This call needs a person's approval and the token has no member to ask.")
        target = await describe_target(spec, call, org_id, db_session)
        summary = _approval_summary(spec, call, target)
        try:
            request = approvals.create(
                grant=principal.connection_id, user_id=approver, org_id=org_id, tool=spec.name,
                arguments=call, summary=summary, client_name=principal.client_name, target=target,
            )
        except approvals.ApprovalUnavailable:
            return _error("approval_unavailable", "Approvals are unavailable right now")
        audit.record(principal, org_id, spec, call, "approval_requested")
        return _error(
            "approval_required",
            f"Needs the approval of the member who created this token: {summary}. They open approval_url, "
            f"then repeat this exact call with the {APPROVAL_HEADER} header.",
            summary=summary,
            approval_id=request.id,
            approval_url=approvals.approval_url(request.id),
            expires_in_seconds=approvals.APPROVAL_TTL,
        )

    if spec.tier is not ActionTier.READ:
        audit.record(
            principal, org_id, spec, call, outcome.status, outcome.denied_code,
            approval=f"link {approval_id}" if ctx.approved else None,
        )
    if outcome.status == "executed":
        result = outcome.result
        if resolved and isinstance(result, dict):
            result.setdefault("resolved", resolved)
        from src.services.ai.tools.base import jsonable

        return JSONResponse(status_code=200, content=jsonable(result if isinstance(result, dict) else {"result": result}))
    return _error(outcome.denied_code or "denied", outcome.reason or "Denied")


def _make_endpoint(spec: ToolSpec):
    model = spec.params_model

    async def endpoint(
        request: Request,
        body: Optional[model] = Body(None),  # type: ignore[valid-type]
        approval_id: Optional[str] = Header(None, alias=APPROVAL_HEADER, max_length=64),
        current_user=Depends(get_current_user),
        db_session: AsyncSession = Depends(get_db_session),
    ):
        token = _require_token(current_user)
        arguments = body.model_dump(mode="json", exclude_unset=True) if body is not None else {}
        return await call_tool(spec, arguments, token, db_session, approval_id)

    endpoint.__name__ = f"tool_{spec.name}"
    return endpoint


class ToolListing(BaseModel):
    name: str
    title: Optional[str] = None
    description: str
    toolset: str
    tier: str
    needs_approval: bool
    rights_bucket: Optional[str] = None
    input_schema: dict


router = APIRouter()


@router.get(
    "",
    summary="List the tools this API token can call",
    description=(
        "Every tool of the agent registry this token may call: name, toolset, tier, whether a call "
        "may need the token creator's approval, and the JSON schema of its body. Call one with "
        "POST /api/v1/tools/{name}."
    ),
    response_model=list[ToolListing],
)
async def api_list_tools(
    toolset: Optional[str] = None,
    current_user=Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
) -> list[ToolListing]:
    from src.services.mcp import server as srv

    token = _require_token(current_user)
    org, config = await _org_and_config(db_session, token.org_id)
    principal = _principal(token)
    out = []
    for spec in get_registry().specs():
        if toolset and (spec.toolset or "core") != toolset:
            continue
        if not srv.spec_visible(spec, principal, config, org.id, None):
            continue
        out.append(
            ToolListing(
                name=spec.name,
                title=spec.title,
                description=spec.description,
                toolset=spec.toolset or "core",
                tier=spec.tier.value,
                needs_approval=spec.may_need_approval,
                rights_bucket=spec.rights_bucket,
                input_schema=spec.params_model.model_json_schema(),
            )
        )
    return out


def register_tool_routes(target: APIRouter, prefix: str = "/tools") -> int:
    """Add one documented POST route per token-callable tool, plus the
    listing. Returns how many tool routes were added."""
    target.include_router(router, prefix=prefix, tags=["tools"])
    added = 0
    for spec in get_registry().specs():
        if not spec.api_tokens:
            continue
        target.add_api_route(
            f"{prefix}/{spec.name}",
            _make_endpoint(spec),
            methods=["POST"],
            tags=[f"{TAG_PREFIX}{spec.toolset or 'core'}"],
            summary=spec.title or spec.name,
            description=_describe(spec),
            operation_id=f"tool_{spec.name}",
            responses={
                403: {"description": "The token lacks the right, or the plan lacks the feature"},
                404: {"description": "Unknown tool or object, or not available to this token"},
                409: {"description": "Needs the token creator's approval (approval_id, approval_url)"},
                422: {"description": "Invalid arguments"},
            },
        )
        added += 1
    return added
