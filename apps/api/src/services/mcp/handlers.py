"""Request handlers for the MCP server (wired in server.py)."""

from __future__ import annotations

import logging
from typing import Any

import mcp_types as types
from fastapi import HTTPException
from mcp.shared.exceptions import MCPError
from pydantic import ValidationError

from src.core.events.database import _async_session_factory
from src.security.mcp_auth import MCPPrincipal, principal_from_request
from src.services.ai.tools.base import ActionTier, ToolOutcome, ToolSpec
from src.security.org_scope import org_scope
from src.services.ai.tools.registry import ToolRegistry, resolve_names, run_tool
from src.services.mcp import approvals, audit
from src.services.mcp import server as srv
from src.services.mcp.prompts import prompt_allowed, prompt_listing, render_prompt

logger = logging.getLogger(__name__)

_INVALID_PARAMS = -32602
_RESOURCE_NOT_FOUND = -32002

_APPROVE_KEY = "approve"


def _principal(ctx: Any) -> MCPPrincipal | None:
    return principal_from_request(getattr(ctx, "request", None))


def _rate_limited(principal: MCPPrincipal) -> bool:
    from src.services.security.rate_limiting import check_rate_limit

    # Per member and org, not per connection: connecting more apps must not
    # multiply the budget.
    who = f"{principal.kind}:{getattr(principal.user, 'id', 0)}:{principal.org_id}"
    try:
        allowed, _count, _reset = check_rate_limit(f"mcp_calls:{who}", srv.CALLS_PER_MINUTE, 60)
    except Exception:
        return False  # Redis trouble must not take MCP down.
    return not allowed


async def _apply_org_policy(principal: MCPPrincipal, org_id: int, db_session) -> str | None:
    """The org's 2FA and sign-in method rules, evaluated as if the member
    were still holding the session they consented with."""
    if principal.kind != "oauth":
        return None
    from src.security.org_auth import enforce_org_mfa
    from src.security.session_context import SessionProvenance, set_session_provenance

    set_session_provenance(SessionProvenance(amr=principal.auth_method, org_id=org_id))
    try:
        await enforce_org_mfa(principal.user.id, org_id, db_session)
    except HTTPException as e:
        detail = e.detail if isinstance(e.detail, str) else (e.detail or {}).get("message")
        return detail or "The organization's sign-in rules block this connection"
    return None


def _approval_summary(
    spec: ToolSpec, arguments: dict[str, Any], target: dict[str, Any] | None = None
) -> str:
    target = target or {}
    name = target.get("name")
    try:
        params = spec.params_model.model_validate(arguments)
        if spec.summarize:
            summary = spec.summarize(params)
            if name and target.get("uuid"):
                summary = summary.replace(str(target["uuid"]), f'"{name}"')
            for uuid, other in (target.get("related") or {}).items():
                if other not in summary:
                    summary = summary.replace(uuid, f'"{other}" ({uuid})')
            return summary
    except (ValidationError, Exception):
        pass
    action = spec.title or spec.name
    return f'{action} "{name}"' if name else action


async def _describe(spec: ToolSpec, arguments: dict[str, Any], org_id: int, db_session) -> dict[str, Any]:
    from src.services.ai.tools.targets import describe_target

    return await describe_target(spec.name, arguments, spec.target_param, org_id, db_session)


def _approval_form(spec: ToolSpec, summary: str, state: str) -> types.InputRequiredResult:
    destructive = spec.tier is ActionTier.DESTRUCTIVE
    return types.InputRequiredResult(
        input_requests={
            _APPROVE_KEY: types.ElicitRequest(
                params=types.ElicitRequestFormParams(
                    message=f"Approve in LearnHouse: {summary}",
                    requested_schema={
                        "type": "object",
                        "properties": {
                            "approve": {
                                "type": "boolean",
                                "title": "Yes, go ahead",
                                "description": "This cannot be undone." if destructive else summary,
                            }
                        },
                        "required": ["approve"],
                    },
                )
            )
        },
        request_state=state,
    )


def _link_only(spec: ToolSpec) -> bool:
    """Deletions and admin changes are approved through the link only: a
    form answer could come from the app itself, not the person."""
    return spec.tier is ActionTier.DESTRUCTIVE or spec.required_access == "admin"


def _approver_id(principal: MCPPrincipal) -> int | None:
    """The member whose yes counts: the one connected, or for an API token
    the member who created it."""
    if principal.kind == "api_token":
        return getattr(principal.user, "created_by_user_id", 0) or None
    return principal.user.id


def _client_can_elicit(ctx: Any) -> bool:
    if not srv.is_modern(getattr(ctx, "protocol_version", None)):
        return False
    session = getattr(ctx, "session", None)
    caps = getattr(session, "client_capabilities", None) if session else None
    return bool(caps and getattr(caps, "elicitation", None) is not None)


_CONSUME_ERRORS = {
    "pending": ("approval_pending", "The user has not approved this yet."),
    "declined": ("cancelled", "The user declined; nothing was changed."),
    "used": ("approval_expired", "That approval was already used."),
    "missing": ("approval_expired", "That approval expired or does not exist."),
    "mismatch": ("approval_mismatch", "That approval was given for a different call."),
}


class Handlers:
    def __init__(self, registry: ToolRegistry):
        self.registry = registry

    # ─── tools ────────────────────────────────────────────────────────────

    async def list_tools(self, ctx: Any, params: Any) -> types.ListToolsResult:
        principal = _principal(ctx)
        if principal is None or _rate_limited(principal):
            return types.ListToolsResult(tools=[])
        toolsets = srv.requested_toolsets(getattr(ctx, "request", None))
        async with _async_session_factory() as db_session:
            org, config = await srv.load_org_and_config(db_session, principal.org_id)
            if org is None or not srv.mcp_allowed(config):
                return types.ListToolsResult(tools=[])
            role_rights = await srv.member_role_rights(principal, org.id, db_session)
        tools = [
            srv.tool_definition(spec)
            for spec in self.registry.specs()
            if srv.spec_visible(spec, principal, config, org.id, toolsets, role_rights)
        ]
        return types.ListToolsResult(tools=tools)

    async def _approval(
        self, ctx: Any, params: types.CallToolRequestParams, principal: MCPPrincipal,
        spec: ToolSpec, arguments: dict[str, Any], call: dict[str, Any],
    ) -> tuple[bool, types.CallToolResult | None, bool]:
        """(approved, refusal, prefer_link): whether a person approved this
        exact call, the error to return instead, and whether a form was
        dismissed so the next ask should be a link."""
        approver = _approver_id(principal)
        approval_id = arguments.get("approval_id")
        if approval_id and approver is not None:
            status = approvals.consume(
                str(approval_id), grant=principal.connection_id, user_id=approver,
                org_id=principal.org_id, tool=spec.name, arguments=call,
            )
            if status == "approved":
                return True, None, False
            code, message = _CONSUME_ERRORS.get(status, ("approval_expired", "Approval not usable."))
            return False, srv.error_result(code, message), False
        state = getattr(params, "request_state", None)
        if state and principal.kind == "oauth" and not _link_only(spec):
            answer = (params.input_responses or {}).get(_APPROVE_KEY)
            action = answer.action if isinstance(answer, types.ElicitResult) else None
            if action == "accept" and (answer.content or {}).get("approve") is True:
                if not approvals.redeem_form_state(
                    state, grant=principal.connection_id, user_id=approver,
                    org_id=principal.org_id, tool=spec.name, arguments=call,
                ):
                    return False, srv.error_result("approval_expired", "That approval expired or was already used."), False
                return True, None, False
            if action in ("accept", "decline"):
                return False, srv.error_result("cancelled", "The user did not approve; nothing was changed."), False
            # Dismissed without an answer. Headless and scripted clients do
            # this for every form, so the retry asks through a link instead.
            return False, None, True
        return False, None, False

    async def call_tool(
        self, ctx: Any, params: types.CallToolRequestParams
    ) -> types.CallToolResult | types.InputRequiredResult:
        principal = _principal(ctx)
        if principal is None:
            return srv.error_result("unauthenticated", "Sign in to use LearnHouse tools")
        spec = self.registry.get(params.name)
        if spec is None:
            return srv.error_result("unknown_tool", f"Unknown tool: {params.name}")
        arguments = dict(params.arguments or {})
        call = approvals.call_args(arguments)

        if _rate_limited(principal):
            audit.record(principal, principal.org_id, spec, call, "refused", "rate_limited")
            return srv.error_result("rate_limited", "Too many calls in the last minute")

        async with _async_session_factory() as db_session:
            org, config = await srv.load_org_and_config(db_session, principal.org_id)
            if org is None:
                return srv.error_result("org_not_found", "The connected organization no longer exists")
            # A rollback expires ORM rows; keep the id as a plain value.
            org_id = org.id
            if not srv.mcp_allowed(config):
                return srv.error_result("mcp_disabled", "AI app connections are turned off for this organization")
            blocked = await _apply_org_policy(principal, org.id, db_session)
            if blocked:
                audit.record(principal, org_id, spec, call, "refused", "org_policy")
                return srv.error_result("org_policy", blocked)
            # A tool hidden from this connection cannot be called either.
            role_rights = await srv.member_role_rights(principal, org.id, db_session)
            if not srv.spec_visible(spec, principal, config, org.id, None, role_rights):
                audit.record(principal, org_id, spec, call, "refused", "unknown_tool")
                return srv.error_result("unknown_tool", f"{params.name} is not available to this connection")

            # Names given where an id goes become ids first, so the approval
            # below is asked and bound for the object actually meant.
            tool_ctx = srv.tool_context(principal, org, db_session)
            with org_scope(org_id):
                named = await resolve_names(spec, call, tool_ctx)
            if isinstance(named, ToolOutcome):
                return srv.error_result(named.denied_code or "denied", named.reason or "Denied")
            call, resolved = named

            try:
                approved, refusal, prefer_link = await self._approval(ctx, params, principal, spec, arguments, call)
            except approvals.ApprovalUnavailable:
                return srv.error_result("approval_unavailable", "Approvals are unavailable right now")
            if refusal is not None:
                audit.record(principal, org_id, spec, call, "refused", refusal.structured_content["error"]["code"])
                return refusal

            tool_ctx.approved = approved
            try:
                outcome = await run_tool(self.registry, spec.name, call, tool_ctx)
                if outcome.status == "executed":
                    await db_session.commit()
                else:
                    await db_session.rollback()
            except Exception:
                await db_session.rollback()
                logger.exception("mcp: tool %s crashed", spec.name)
                audit.record(principal, org_id, spec, call, "crashed", "internal_error")
                return srv.error_result("internal_error", "The tool failed unexpectedly")

            if outcome.status != "executed" and outcome.denied_code == "approval_required":
                # Every other check passed: only now name the target and ask.
                audit.record(principal, org_id, spec, call, "approval_requested")
                return await self._ask_approval(
                    ctx, principal, org_id, spec, call, db_session, prefer_link=prefer_link
                )

        if spec.tier is not ActionTier.READ:
            channel = None
            if approved:
                channel = f"link {arguments.get('approval_id')}" if arguments.get("approval_id") else "form"
            audit.record(principal, org_id, spec, call, outcome.status, outcome.denied_code, approval=channel)
        if outcome.status == "executed":
            if resolved and isinstance(outcome.result, dict):
                outcome.result.setdefault("resolved", resolved)
            return srv.success_result(outcome.result)
        return srv.error_result(outcome.denied_code or "denied", outcome.reason or "Denied")

    async def _ask_approval(
        self, ctx: Any, principal: MCPPrincipal, org_id: int, spec: ToolSpec,
        call: dict[str, Any], db_session, prefer_link: bool = False,
    ) -> types.CallToolResult | types.InputRequiredResult:
        target = await _describe(spec, call, org_id, db_session)
        summary = _approval_summary(spec, call, target)
        approver = _approver_id(principal)
        if approver is None:
            return srv.error_result(
                "approval_unavailable",
                f"{summary} needs a person's approval, and this API token has no member to ask. "
                "Connect as a member instead.",
            )
        try:
            if (
                principal.kind == "oauth"
                and not _link_only(spec)
                and _client_can_elicit(ctx)
                and not prefer_link
            ):
                state = approvals.form_state(
                    grant=principal.connection_id, user_id=approver, org_id=org_id,
                    tool=spec.name, arguments=call,
                )
                return _approval_form(spec, summary, state)
            request = approvals.create(
                grant=principal.connection_id,
                user_id=approver,
                org_id=org_id,
                tool=spec.name,
                arguments=call,
                summary=summary,
                client_name=principal.client_name,
                target=target,
            )
        except approvals.ApprovalUnavailable:
            return srv.error_result("approval_unavailable", "Approvals are unavailable right now")
        if prefer_link:
            lead = "Your app could not show the approval prompt, so the user approves through a link instead. "
        elif principal.kind == "api_token":
            lead = "The member who created this API token approves through a link. "
        else:
            lead = ""
        return srv.error_result(
            "approval_required",
            f"{lead}Needs the user's approval: {summary}. Ask them to open approval_url, then call "
            "this tool again with the same arguments and approval_id.",
            summary=summary,
            approval_id=request.id,
            approval_url=approvals.approval_url(request.id),
            expires_in_seconds=approvals.APPROVAL_TTL,
        )

    # ─── resources ────────────────────────────────────────────────────────

    async def _read_tool(self, principal: MCPPrincipal, name: str, args: dict) -> Any:
        """A resource read is the matching read tool, with the same gates as
        calling it: rate limit, org policy and whether this member may use it."""
        if _rate_limited(principal):
            raise MCPError(_RESOURCE_NOT_FOUND, "Too many calls in the last minute")
        spec = self.registry.get(name)
        async with _async_session_factory() as db_session:
            org, config = await srv.load_org_and_config(db_session, principal.org_id)
            if org is None or spec is None or not srv.mcp_allowed(config):
                raise MCPError(_RESOURCE_NOT_FOUND, "Resource not available")
            blocked = await _apply_org_policy(principal, org.id, db_session)
            if blocked:
                raise MCPError(_RESOURCE_NOT_FOUND, blocked)
            role_rights = await srv.member_role_rights(principal, org.id, db_session)
            if not srv.spec_visible(spec, principal, config, org.id, None, role_rights):
                raise MCPError(_RESOURCE_NOT_FOUND, "Resource not available")
            outcome = await run_tool(
                self.registry, name, args, srv.tool_context(principal, org, db_session)
            )
            await db_session.rollback()
        if outcome.status != "executed":
            raise MCPError(_RESOURCE_NOT_FOUND, outcome.reason or "Resource not available")
        return outcome.result

    async def list_resources(self, ctx: Any, params: Any) -> types.ListResourcesResult:
        principal = _principal(ctx)
        if principal is None:
            return types.ListResourcesResult(resources=[])
        resources = [
            types.Resource(
                uri="learnhouse://org",
                name="organization",
                title="Organization overview",
                description="The organization, your role, its plan features and link formats.",
                mime_type="application/json",
            )
        ]
        try:
            listing = await self._read_tool(principal, "list_courses", {"limit": 50})
        except MCPError:
            listing = {}
        for course in (listing or {}).get("items") or []:
            uuid = course.get("uuid")
            if uuid:
                resources.append(
                    types.Resource(
                        uri=f"learnhouse://course/{uuid}",
                        name=uuid,
                        title=course.get("name") or uuid,
                        description="Course outline: chapters and activities.",
                        mime_type="application/json",
                    )
                )
        return types.ListResourcesResult(resources=resources)

    async def list_resource_templates(
        self, ctx: Any, params: Any
    ) -> types.ListResourceTemplatesResult:
        return types.ListResourceTemplatesResult(
            resource_templates=[
                types.ResourceTemplate(
                    uri_template="learnhouse://course/{course_uuid}",
                    name="course",
                    title="Course structure",
                    description="A course's chapters and activities, in order.",
                    mime_type="application/json",
                ),
                types.ResourceTemplate(
                    uri_template="learnhouse://activity/{activity_uuid}",
                    name="activity",
                    title="Activity content",
                    description="A page's content as Markdown.",
                    mime_type="application/json",
                ),
            ]
        )

    async def read_resource(
        self, ctx: Any, params: types.ReadResourceRequestParams
    ) -> types.ReadResourceResult:
        principal = _principal(ctx)
        if principal is None:
            raise MCPError(_RESOURCE_NOT_FOUND, "Sign in first")
        uri = str(params.uri)
        parsed = srv.parse_resource_uri(uri)
        if parsed is None:
            raise MCPError(_INVALID_PARAMS, f"Unknown resource: {uri}")
        kind, ident = parsed
        if kind == "org":
            data = await self._read_tool(principal, "get_context", {})
        elif kind == "course" and ident:
            data = await self._read_tool(principal, "get_course", {"course_uuid": ident})
        elif kind == "activity" and ident:
            data = await self._read_tool(principal, "get_activity_content", {"activity_uuid": ident, "format": "markdown"})
        else:
            raise MCPError(_INVALID_PARAMS, f"Unknown resource: {uri}")
        return types.ReadResourceResult(
            contents=[
                types.TextResourceContents(
                    uri=uri, mime_type="application/json", text=srv.text_result(data)
                )
            ]
        )

    # ─── prompts ──────────────────────────────────────────────────────────

    async def list_prompts(self, ctx: Any, params: Any) -> types.ListPromptsResult:
        principal = _principal(ctx)
        if principal is None:
            return types.ListPromptsResult(prompts=prompt_listing())
        async with _async_session_factory() as db_session:
            rights = await srv.member_role_rights(principal, principal.org_id, db_session)
        return types.ListPromptsResult(
            prompts=prompt_listing(lambda p: prompt_allowed(p, principal.can_write, rights))
        )

    async def get_prompt(self, ctx: Any, params: types.GetPromptRequestParams) -> types.GetPromptResult:
        try:
            result = render_prompt(params.name, params.arguments)
        except ValueError as e:
            raise MCPError(_INVALID_PARAMS, str(e))
        if result is None:
            raise MCPError(_INVALID_PARAMS, f"Unknown prompt: {params.name}")
        return result

