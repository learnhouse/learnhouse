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
from src.services.ai.tools import known_toolsets
from src.services.ai.tools.registry import ToolRegistry, resolve_names, run_tool
from src.services.ai.tools.progress import progress_reporter
from src.services.mcp import approvals, audit
from src.services.mcp import discovery as disc
from src.services.mcp import server as srv
from src.security.features_utils.resolve import resolve_feature
from src.services.mcp.prompts import PROMPTS, STATIC_KINDS, prompt_allowed, prompt_listing, render_prompt
from src.services.mcp.resources import (
    FIRST_PAGE,
    MAX_COMPLETIONS,
    RESOURCES,
    TEMPLATE_ARGS,
    TEMPLATE_VALUES,
    complete_static,
    completion_values,
    parse_uri,
    static_text,
)

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


class _ProgressPump:
    """Bridges the tools' synchronous report_progress to MCP progress
    notifications (sent only when the client asked, with a progressToken)."""

    def __init__(self, session: Any):
        self.session = session
        self.tasks: list[Any] = []

    def __call__(self, done: int, total: int, label: str | None) -> None:
        import asyncio

        try:
            self.tasks.append(asyncio.get_running_loop().create_task(self.session.report_progress(done, total, label)))
        except Exception:  # pragma: no cover - no loop means nothing to report to
            pass


def _pump(ctx: Any) -> _ProgressPump | None:
    session = getattr(ctx, "session", None)
    if session is None or not hasattr(session, "report_progress") or not _progress_token(ctx):
        return None
    return _ProgressPump(session)


def _progress_token(ctx: Any) -> Any:
    meta = getattr(ctx, "meta", None)
    return meta.get("progress_token") or meta.get("progressToken") if isinstance(meta, dict) else None


async def _flush_progress(pump: _ProgressPump | None) -> None:
    import asyncio

    if pump is None or not pump.tasks:
        return
    await asyncio.gather(*pump.tasks, return_exceptions=True)


async def _log(ctx: Any, level: str, data: Any) -> None:
    """A notifications/message entry for clients that show server logs
    (dropped on JSON responses and when the client did not opt in)."""
    session = getattr(ctx, "session", None)
    send = getattr(session, "send_log_message", None) if session is not None else None
    if send is None:
        return
    try:
        await send(level, data, logger="learnhouse", related_request_id=getattr(ctx, "request_id", None))
    except Exception:
        logger.debug("mcp: log message not delivered", exc_info=True)


def invalid_fields(spec: ToolSpec, arguments: dict[str, Any]) -> list[dict] | None:
    """Each bad argument with what is wrong and, for a fixed set, the values
    allowed, so the model can fix every field in one retry."""
    try:
        spec.params_model.model_validate(arguments)
    except ValidationError as e:
        fields = []
        for err in e.errors()[:8]:
            entry: dict[str, Any] = {
                "field": ".".join(str(p) for p in err.get("loc", ())) or "(arguments)",
                "problem": err.get("msg", ""),
            }
            ctx_ = err.get("ctx") or {}
            if "expected" in ctx_:
                entry["allowed"] = ctx_["expected"]
            elif err.get("type") == "extra_forbidden":
                entry["problem"] = "unknown argument; remove it"
            fields.append(entry)
        return fields
    return None


class Handlers:
    def __init__(self, registry: ToolRegistry):
        self.registry = registry

    # ─── tools ────────────────────────────────────────────────────────────

    async def _callable_specs(self, principal: MCPPrincipal) -> tuple[list[ToolSpec], dict, Any] | None:
        """Every tool this connection may call (listed or not), with the org
        config and role rights; None when the org is gone or MCP is off."""
        async with _async_session_factory() as db_session:
            org, config = await srv.load_org_and_config(db_session, principal.org_id)
            if org is None or not srv.mcp_allowed(config):
                return None
            org_id = org.id
            role_rights = await srv.member_role_rights(principal, org_id, db_session)
        specs = [s for s in self.registry.specs() if srv.spec_visible(s, principal, config, org_id, None, role_rights)]
        return specs, config, role_rights

    def _listed(self, ctx: Any, specs: list[ToolSpec]) -> list[ToolSpec]:
        toolsets = srv.requested_toolsets(getattr(ctx, "request", None), known_toolsets(self.registry))
        return [s for s in specs if toolsets is None or (s.toolset or "core") in toolsets]

    async def list_tools(self, ctx: Any, params: Any) -> types.ListToolsResult:
        principal = _principal(ctx)
        if principal is None or _rate_limited(principal):
            return types.ListToolsResult(tools=[])
        found = await self._callable_specs(principal)
        if found is None:
            return types.ListToolsResult(tools=[])
        tools = disc.meta_tool_definitions() + [srv.tool_definition(spec) for spec in self._listed(ctx, found[0])]
        try:
            page, nxt = disc.paginate(tools, getattr(params, "cursor", None), disc.TOOLS_PAGE)
        except (ValueError, KeyError, TypeError):
            raise MCPError(_INVALID_PARAMS, "Invalid cursor: pass nextCursor exactly as returned.")
        return types.ListToolsResult(tools=page, next_cursor=nxt)

    async def _search_tools(self, ctx: Any, principal: MCPPrincipal, arguments: dict) -> types.CallToolResult:
        found = await self._callable_specs(principal)
        if found is None:
            return srv.error_result("mcp_disabled", "AI app connections are turned off for this organization")
        specs = found[0]
        listed = {s.name for s in self._listed(ctx, specs)}
        query = arguments.get("query")
        toolset = arguments.get("toolset")
        limit = arguments.get("limit", 10)
        if not isinstance(limit, int) or isinstance(limit, bool) or not 1 <= limit <= 50:
            return srv.error_result("invalid_args", "limit must be a whole number from 1 to 50", fields=[{"field": "limit", "problem": "1 to 50"}])
        known = sorted({s.toolset or "core" for s in specs})
        if toolset is not None and toolset not in known:
            return srv.error_result(
                "invalid_args", f"Unknown toolset '{toolset}'.",
                fields=[{"field": "toolset", "problem": "unknown toolset", "allowed": known}],
            )
        try:
            result = disc.search(
                specs, listed, query if isinstance(query, str) else None, toolset,
                arguments.get("include_schema", True) is not False, limit, arguments.get("cursor"), srv.tool_definition,
            )
        except (ValueError, KeyError, TypeError):
            return srv.error_result("invalid_cursor", "Invalid cursor.")
        return srv.success_result(result)

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
        if params.name == disc.SEARCH_TOOLS:
            if _rate_limited(principal):
                return srv.error_result("rate_limited", "Too many calls in the last minute")
            return await self._search_tools(ctx, principal, dict(params.arguments or {}))
        if params.name == disc.INVOKE_TOOL:
            args = dict(params.arguments or {})
            name, inner = args.get("name"), args.get("arguments", {})
            if not isinstance(name, str) or name in disc.META_TOOLS or not isinstance(inner, dict):
                return srv.error_result(
                    "invalid_args", "invoke_tool needs name (a tool from search_tools, not a meta tool) and arguments (an object).",
                    fields=[{"field": "name", "problem": "required tool name"}],
                )
            # Dispatched exactly like a direct call: same checks, approvals bound to the real tool.
            params = params.model_copy(update={"name": name, "arguments": inner})
        spec = self.registry.get(params.name)
        if spec is None:
            import difflib

            close = difflib.get_close_matches(params.name, [s.name for s in self.registry.specs()], n=3, cutoff=0.6)
            return srv.error_result(
                "unknown_tool", f"Unknown tool: {params.name}",
                did_you_mean=close or None,
            )
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
                pump = _pump(ctx)
                with progress_reporter(pump):
                    outcome = await run_tool(self.registry, spec.name, call, tool_ctx)
                await _flush_progress(pump)
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
            if spec.tier is not ActionTier.READ and isinstance(outcome.result, dict) and outcome.result.get("summary"):
                await _log(ctx, "info", {"tool": spec.name, "summary": outcome.result["summary"]})
            return srv.success_result(outcome.result)
        if outcome.denied_code == "invalid_args":
            return srv.error_result("invalid_args", outcome.reason or "Invalid arguments", fields=invalid_fields(spec, call))
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

    async def _open_org(self, principal: MCPPrincipal) -> tuple[Any, dict, Any] | None:
        """(org id, config, role rights) while the connected org exists and
        allows AI app connections; None otherwise."""
        async with _async_session_factory() as db_session:
            org, config = await srv.load_org_and_config(db_session, principal.org_id)
            if org is None or not srv.mcp_allowed(config):
                return None
            org_id = org.id
            rights = await srv.member_role_rights(principal, org_id, db_session)
        return org_id, config, rights

    async def list_resources(self, ctx: Any, params: Any) -> types.ListResourcesResult:
        principal = _principal(ctx)
        if principal is None or await self._open_org(principal) is None:
            return types.ListResourcesResult(resources=[])
        listed: list[types.Resource] = []
        for resource in RESOURCES.values():
            if resource.arg is None:
                listed.append(
                    types.Resource(
                        uri=resource.uri(),
                        name=resource.kind,
                        title=resource.title,
                        description=resource.description,
                        mime_type=resource.mime_type,
                    )
                )
                continue
            if resource.values:
                listed.extend(
                    types.Resource(
                        uri=resource.uri(value), name=f"{resource.kind}/{value}",
                        title=f"{resource.title}: {value}", description=resource.description, mime_type=resource.mime_type,
                    )
                    for value in resource.values
                )
                continue
            if resource.listed_by is None:
                continue
            tool, args = resource.listed_by
            try:
                found = await self._read_tool(principal, tool, dict(args))
            except MCPError:
                continue
            for item in (found or {}).get("items") or []:
                uuid = item.get("uuid") if isinstance(item, dict) else None
                if uuid:
                    listed.append(
                        types.Resource(
                            uri=resource.uri(uuid),
                            name=uuid,
                            title=item.get("name") or uuid,
                            description=resource.description,
                            mime_type="application/json",
                        )
                    )
        try:
            page, nxt = disc.paginate(listed, getattr(params, "cursor", None), disc.RESOURCES_PAGE)
        except (ValueError, KeyError, TypeError):
            raise MCPError(_INVALID_PARAMS, "Invalid cursor: pass nextCursor exactly as returned.")
        return types.ListResourcesResult(resources=page, next_cursor=nxt)

    async def list_resource_templates(
        self, ctx: Any, params: Any
    ) -> types.ListResourceTemplatesResult:
        return types.ListResourceTemplatesResult(
            resource_templates=[
                types.ResourceTemplate(
                    uri_template=resource.template,
                    name=resource.kind,
                    title=resource.title,
                    description=resource.description,
                    mime_type=resource.mime_type,
                )
                for resource in RESOURCES.values()
                if resource.template
            ]
        )

    async def read_resource(
        self, ctx: Any, params: types.ReadResourceRequestParams
    ) -> types.ReadResourceResult:
        principal = _principal(ctx)
        if principal is None:
            raise MCPError(_RESOURCE_NOT_FOUND, "Sign in first")
        uri = str(params.uri)
        parsed = parse_uri(uri)
        if parsed is None:
            raise MCPError(_INVALID_PARAMS, f"Unknown resource: {uri}")
        resource, ident = parsed
        if resource.reader == "static":
            if await self._open_org(principal) is None:
                raise MCPError(_RESOURCE_NOT_FOUND, "Resource not available")
            try:
                text = static_text(resource, ident)
            except KeyError:
                raise MCPError(_RESOURCE_NOT_FOUND, f"Unknown {resource.kind}: {ident}. Known: {', '.join(resource.values)}")
        elif resource.reader == "branding":
            text = srv.text_result(await self._branding(principal))
        else:
            data = await self._read_tool(principal, resource.tool, resource.tool_args(ident))
            if resource.mime_type == "text/markdown" and isinstance(data, dict) and isinstance(data.get("markdown"), str):
                text = data["markdown"]
            else:
                text = srv.text_result(data)
        return types.ReadResourceResult(
            contents=[types.TextResourceContents(uri=uri, mime_type=resource.mime_type, text=text)]
        )

    async def _branding(self, principal: MCPPrincipal) -> dict:
        from src.services.orgs.theme import read_org_theme, resolve_org_theme_summary

        if _rate_limited(principal):
            raise MCPError(_RESOURCE_NOT_FOUND, "Too many calls in the last minute")
        async with _async_session_factory() as db_session:
            org, config = await srv.load_org_and_config(db_session, principal.org_id)
            if org is None or not srv.mcp_allowed(config):
                raise MCPError(_RESOURCE_NOT_FOUND, "Resource not available")
            summary = resolve_org_theme_summary(config)
            general = ((config.get("customization") or {}).get("general") or config.get("general") or {}) if isinstance(config, dict) else {}
            return {
                "name": org.name,
                "description": org.description,
                "has_logo": bool(org.logo_image),
                "brand_color": summary["brand_color"],
                "accent_color": summary["accent_color"],
                "font": general.get("font") if isinstance(general, dict) else None,
                "theme": read_org_theme(config).model_dump(),
                "use": "Match widgets (blockMagic HTML), callout choices and images to these colors and this tone.",
            }

    # ─── prompts ──────────────────────────────────────────────────────────

    async def _prompt_filter(self, principal: MCPPrincipal | None):
        """Which prompts this caller is offered: their role's rights, write
        access and the plan features the prompt depends on."""
        if principal is None:
            return lambda p: True
        opened = await self._open_org(principal)
        if opened is None:
            return lambda p: False
        org_id, config, rights = opened
        features = {
            p.feature: bool(resolve_feature(p.feature, config, org_id)["enabled"])
            for p in PROMPTS.values()
            if p.feature
        }
        return lambda p: prompt_allowed(p, principal.can_write, rights, features)

    async def list_prompts(self, ctx: Any, params: Any) -> types.ListPromptsResult:
        allowed = await self._prompt_filter(_principal(ctx))
        try:
            page, nxt = disc.paginate(prompt_listing(allowed), getattr(params, "cursor", None), disc.PROMPTS_PAGE)
        except (ValueError, KeyError, TypeError):
            raise MCPError(_INVALID_PARAMS, "Invalid cursor: pass nextCursor exactly as returned.")
        return types.ListPromptsResult(prompts=page, next_cursor=nxt)

    async def get_prompt(self, ctx: Any, params: types.GetPromptRequestParams) -> types.GetPromptResult:
        prompt = PROMPTS.get(params.name)
        if prompt is None or not (await self._prompt_filter(_principal(ctx)))(prompt):
            raise MCPError(_INVALID_PARAMS, f"Unknown prompt: {params.name}")
        try:
            result = render_prompt(params.name, params.arguments)
        except ValueError as e:
            raise MCPError(_INVALID_PARAMS, str(e))
        return result

    # ─── completion ───────────────────────────────────────────────────────

    async def complete(self, ctx: Any, params: types.CompleteRequestParams) -> types.CompleteResult:
        """Suggest values for a prompt argument (names) or a resource
        template argument (ids), from what the member can see."""
        empty = types.CompleteResult(completion=types.Completion(values=[], has_more=False))
        principal = _principal(ctx)
        if principal is None:
            return empty
        ref, argument = params.ref, params.argument
        kind, by = None, "name"
        fixed: tuple[str, ...] = ()
        if isinstance(ref, types.PromptReference):
            prompt = PROMPTS.get(ref.name)
            arg = next((a for a in (prompt.args if prompt else ()) if a.name == argument.name), None)
            kind = arg.kind if arg else None
            fixed = STATIC_KINDS.get(kind or "", ())
        elif isinstance(ref, types.ResourceTemplateReference):
            kind, by = TEMPLATE_ARGS.get(argument.name), "uuid"
            fixed = TEMPLATE_VALUES.get(argument.name, ())
        if fixed:
            values = complete_static(fixed, argument.value)
            return types.CompleteResult(completion=types.Completion(values=values, total=len(values), has_more=False))
        if kind is None:
            return empty
        typed = (argument.value or "").strip()
        if len(typed) >= 2:
            tool, args = "search", {"query": typed[:200], "kinds": [kind], "limit": MAX_COMPLETIONS}
        elif kind in FIRST_PAGE:
            tool, args = FIRST_PAGE[kind], {"limit": MAX_COMPLETIONS}
        else:
            return empty
        try:
            found = await self._read_tool(principal, tool, args)
        except MCPError:
            return empty
        values = completion_values(found, by=by)
        return types.CompleteResult(
            completion=types.Completion(
                values=values,
                has_more=bool(isinstance(found, dict) and found.get("has_more")),
            )
        )
