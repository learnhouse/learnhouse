"""Atlas turn orchestrator.

Drives one user→Atlas exchange end-to-end:

    plan  →  resolve  →  preview  →  confirm  →  apply

Owns the typed SSE event stream the router serializes. Every meaningful
moment in a turn (text delta, tool start/end, entity resolution,
preview card, destructive challenge, applied result, error) shows up
here as a structured event — no markdown fences, no HTML comments, no
``tool.summary`` JSON-in-a-string.

There is exactly one Atlas pipeline per HTTP request. ``run_turn`` is
an async generator producing pydantic event models in order; the router
serializes them with ``events.serialize`` and ships them via
``sse-starlette``.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import Any, AsyncIterator, Optional
from uuid import uuid4

from pydantic import BaseModel

from pydantic_ai.messages import (
    FunctionToolCallEvent,
    FunctionToolResultEvent,
    PartDeltaEvent,
    PartStartEvent,
    TextPart,
    TextPartDelta,
    ToolCallPart,
)

from src.services.ai.atlas.context import build_current_context
from src.services.ai.atlas.deps import AtlasDeps
from src.services.ai.atlas.events import (
    AppliedEvent,
    ConfirmRequiredEvent,
    DoneEvent,
    EntityAmbiguousEvent,
    EntityNotFoundEvent,
    EntityResolvedEvent,
    ErrorEvent,
    MessageDeltaEvent,
    PendingDroppedEvent,
    PreviewActivityEvent,
    PreviewChapterEvent,
    PreviewCourseEvent,
    ResourceRef,
    ResultsListEvent,
    SessionEvent,
    StructureProposalEvent,
    ToolEndEvent,
    ToolStartEvent,
)
from src.services.ai.atlas.intent import classify_user_intent
from src.services.ai.atlas.llm import build_agent
from src.services.ai.atlas.pending import CreatePendingEditRequest, PendingEdit
from src.services.ai.atlas.prompts import build_system_prompt
from src.services.ai.atlas.resolver import (
    PageContextDTO,
    ReferenceDTO,
)
from src.services.ai.atlas.tiers import (
    ConfirmationChallenge,
    Tier,
    TurnState,
    ToolSpec,
    classify_error,
)

logger = logging.getLogger(__name__)


# --- Request schema ---------------------------------------------------------


class AtlasTurnRequest(BaseModel):
    """One agent turn's inputs. Built by the router from the chat body."""

    aichat_uuid: str
    message: str
    page_context: PageContextDTO
    references: list[ReferenceDTO] = []
    is_first_turn: bool = False
    # Optional refinement-flow seed: when the user POSTs /pending/{id}/refine,
    # the router calls ``run_turn`` with this set so the pipeline knows to
    # frame the message as "refine pending X".
    refining_pending_id: Optional[str] = None


# --- Entry point ------------------------------------------------------------


async def run_turn(
    req: AtlasTurnRequest, deps: AtlasDeps
) -> AsyncIterator[BaseModel]:
    """The one and only Atlas turn entry point. Yields SSE event models.

    The router serializes each yielded model via
    ``services.ai.atlas.events.serialize`` and ships it over SSE.
    Anything that needs to survive across turns — chat history, pending
    edits, snapshots — lives in Redis; the pipeline holds only
    request-scoped state.
    """
    yield SessionEvent(aichat_uuid=req.aichat_uuid)

    # ---- 1. Build the current_context block from page + references --------
    snapshot = None
    if req.page_context.course_uuid:
        try:
            snapshot = await deps.snapshot_cache.get_or_build(
                req.page_context.course_uuid,
                request=deps.request,
                db=deps.db,
                current_user=deps.current_user,
            )
        except Exception as e:
            logger.warning("Atlas snapshot build failed: %s", e)
            # Resolution falls back to selectors that don't need a snapshot.
    current_ctx_yaml = build_current_context(req.page_context, req.references, snapshot)

    # ---- 2. Reconcile with pending edits ----------------------------------
    pendings = await deps.pending_store.list_for_chat(req.aichat_uuid)
    active_pendings = [
        p for p in pendings if p.status in ("proposed", "awaiting_confirm")
    ]
    intent = classify_user_intent(req.message, active_pendings)

    if intent.kind == "approve" and intent.pending is not None:
        # In-chat approval: stream the apply through this same SSE channel.
        async for ev in apply_flow(intent.pending, deps, confirmation_phrase=None):
            yield ev
        yield DoneEvent()
        return

    if intent.kind == "cancel" and intent.pending is not None:
        ok = await deps.pending_store.cancel(intent.pending.pending_id, user_id=deps.acting_user_id)
        if ok:
            yield PendingDroppedEvent(
                pending_id=intent.pending.pending_id, reason="cancelled"
            )
        yield DoneEvent()
        return

    # ---- 3. Run the agent --------------------------------------------------
    async for ev in _run_agent(req, deps, snapshot, current_ctx_yaml, active_pendings):
        yield ev

    yield DoneEvent()


# --- Apply flow (also called by /pending/{id}/apply HTTP endpoint) ----------


async def apply_flow(
    pending: PendingEdit,
    deps: AtlasDeps,
    *,
    confirmation_phrase: Optional[str],
) -> AsyncIterator[BaseModel]:
    """Apply a confirmed pending edit. Yields the events the SSE channel
    should emit on success or failure.

    Steps:
      1. (DESTRUCTIVE only) verify the typed challenge phrase.
      2. CAS proposed/awaiting_confirm → applying via ``mark_applying``.
      3. Invoke the corresponding ``apply_*`` MCP tool with the stored
         payload.
      4. On success: mark_applied, emit ``applied``, invalidate snapshot.
      5. On failure: mark_failed, emit ``error``.
    """
    # Challenge check
    if pending.tier == "DESTRUCTIVE":
        challenge = pending.challenge.challenge_phrase if pending.challenge else None
        if not challenge or (confirmation_phrase or "").strip() != challenge.strip():
            yield ErrorEvent(
                code="confirmation_mismatch",
                message="The confirmation phrase didn't match. The change was not applied.",
                retriable=True,
            )
            return

    pe = await deps.pending_store.mark_applying(pending.pending_id)
    if pe is None:
        yield ErrorEvent(
            code="pending_not_applicable",
            message="This proposal is no longer valid (it may have been applied, cancelled, or expired).",
            retriable=False,
        )
        return

    # Inject expected_version + confirmation_phrase into the apply payload
    # so the MCP tool body can do the optimistic-lock check + re-verify.
    apply_args = dict(pe.proposed_payload or {})
    if pe.expected_version is not None:
        apply_args.setdefault("expected_version", pe.expected_version)
    if confirmation_phrase:
        apply_args["confirmation_phrase"] = confirmation_phrase

    from src.services.ai.atlas.mcp_session import open_atlas_mcp
    from src.services.ai.atlas.tool_proxy import ToolProxy

    try:
        async with open_atlas_mcp(deps.session_token) as session:
            proxy = ToolProxy(session)
            await proxy.load_catalog()
            outcome = await proxy.call_apply(pe.tool_name, apply_args)
    except Exception as e:
        logger.exception("apply_flow MCP error")
        await deps.pending_store.mark_failed(pe.pending_id, f"upstream: {e}")
        yield ErrorEvent(code="upstream_unavailable", message=str(e), retriable=True)
        return

    if not outcome.ok:
        err = outcome.error
        kind = classify_error(err) if err else "fatal"
        reason = err.code if err else "unknown_error"
        await deps.pending_store.mark_failed(pe.pending_id, reason)
        yield ErrorEvent(
            code=err.code if err else "internal_error",
            message=err.message if err else "Apply failed.",
            retriable=(kind == "retriable"),
        )
        return

    payload = outcome.structured or {}
    version_after = payload.get("version_after")
    undo_token = payload.get("undo_token")
    await deps.pending_store.mark_applied(
        pe.pending_id, version_after=version_after, undo_token=undo_token
    )
    # Course-scoped invalidation so subsequent resolves see fresh state.
    if pe.target_resource.parent_course_uuid:
        await deps.snapshot_cache.invalidate(pe.target_resource.parent_course_uuid)
    elif pe.target_resource.kind == "course":
        await deps.snapshot_cache.invalidate(pe.target_resource.uuid)

    yield AppliedEvent(
        pending_id=pe.pending_id,
        target=pe.target_resource,
        version_after=version_after,
        undo_token=undo_token,
    )


# --- Agent driver -----------------------------------------------------------


async def _run_agent(
    req: AtlasTurnRequest,
    deps: AtlasDeps,
    snapshot,
    current_ctx_yaml: str,
    active_pendings: list[PendingEdit],
) -> AsyncIterator[BaseModel]:
    """Run the pydantic-ai Agent, translating its event stream to SSE.

    The Agent receives the MCP toolset (filtered to hide apply_*) and a
    ``process_tool_call`` hook that runs the cross-tier guard and
    post-processes successful ``propose_*`` results into pending edits +
    preview events. Text deltas are forwarded via the
    ``event_stream_handler`` parameter.
    """
    # If there are still pending edits at this point (intent was 'refine'
    # or 'new_request' with stale pendings), the agent should know which
    # one (if any) the user is refining. The pipeline supersedes them
    # later if the agent's first tool call targets a different entity.
    refine_hint = ""
    if active_pendings:
        last = active_pendings[-1]
        refine_hint = (
            "\n\nrefinement_target: "
            f"{{ pending_id: {last.pending_id}, summary: \"{last.summary}\" }}"
        )

    system_prompt = build_system_prompt(current_ctx_yaml + refine_hint)

    # First we need the catalog to drive the tier guard. We open the MCP
    # connection just to read the catalog, then build the agent (which
    # opens its own connection internally via the toolset).
    from src.services.ai.atlas.mcp_session import open_atlas_mcp
    from src.services.ai.atlas.tool_proxy import ToolProxy

    tool_specs: dict[str, ToolSpec] = {}
    try:
        async with open_atlas_mcp(deps.session_token) as catalog_session:
            proxy = ToolProxy(catalog_session)
            await proxy.load_catalog()
            tool_specs = {s.name: s for s in proxy.all_specs()}
    except Exception as e:
        logger.warning("Atlas: could not preload tool catalog: %s", e)

    turn_state = TurnState()
    call_starts: dict[str, float] = {}
    # Per-step buffer the agent's callbacks push into; the outer
    # generator drains it after every text chunk. Using a plain list
    # (not asyncio.Queue) keeps everything inside one task — the MCP
    # toolset's anyio task group is entered + exited on this same task,
    # which prevents the cancel-scope mismatch the prior background-
    # task pattern caused.
    buffer: list[BaseModel] = []

    async def on_guard_block(name: str, reason: str) -> None:
        buffer.append(ErrorEvent(code="guard_blocked", message=reason, retriable=False))

    from src.services.ai.atlas.llm import build_agent as _build_agent

    bundle = _build_agent(
        system_prompt=system_prompt,
        session_token=deps.session_token,
        tool_specs=tool_specs,
        turn_state=turn_state,
        on_guard_block=on_guard_block,
    )

    # Wrap process_tool_call to post-process MCP tool results into the
    # buffer (preview/results/structure/entity events). The original
    # process_tool_call set by build_agent enforces the cross-tier guard.
    original_process = bundle.mcp.process_tool_call

    async def wrapped_process(ctx, call_tool, name: str, tool_args):
        spec = tool_specs.get(name)
        if original_process is not None:
            result = await original_process(ctx, call_tool, name, tool_args)
        else:
            result = await call_tool(name, tool_args, None)

        if isinstance(result, dict) and result.get("code") == "guard_blocked":
            return result

        if spec and spec.tier == "READ" and isinstance(result, dict):
            kind = result.get("results_kind")
            items = result.get("items")
            if kind and isinstance(items, list):
                buffer.append(ResultsListEvent(kind=kind, items=items))

        if (
            spec
            and spec.name == "suggest_course_structure"
            and isinstance(result, dict)
            and "tree" in result
        ):
            buffer.append(StructureProposalEvent(tree=result["tree"]))

        if (
            spec
            and not spec.is_apply
            and isinstance(result, dict)
            and result.get("ok")
            and "preview" in result
        ):
            try:
                async for ev in _emit_proposal(spec, result["preview"], req, deps):
                    buffer.append(ev)
            except Exception:
                logger.exception("Atlas: failed to emit proposal events")

        if isinstance(result, dict) and "entity_resolved" in result:
            try:
                buffer.append(EntityResolvedEvent(**result["entity_resolved"]))
            except Exception:
                pass
        if isinstance(result, dict) and "entity_ambiguous" in result:
            try:
                buffer.append(EntityAmbiguousEvent(**result["entity_ambiguous"]))
            except Exception:
                pass

        return result

    bundle.mcp.process_tool_call = wrapped_process

    # event_stream_handler: convert pydantic-ai's event stream to our SSE shape.
    async def event_handler(_ctx, events):
        async for evt in events:
            try:
                if isinstance(evt, PartStartEvent):
                    if isinstance(evt.part, TextPart) and evt.part.content:
                        buffer.append(MessageDeltaEvent(delta=evt.part.content))
                    elif isinstance(evt.part, ToolCallPart):
                        call_starts[evt.part.tool_call_id or evt.part.tool_name] = time.monotonic()
                elif isinstance(evt, PartDeltaEvent) and isinstance(evt.delta, TextPartDelta):
                    if evt.delta.content_delta:
                        buffer.append(MessageDeltaEvent(delta=evt.delta.content_delta))
                elif isinstance(evt, FunctionToolCallEvent):
                    cp: ToolCallPart = evt.part
                    call_id = cp.tool_call_id or cp.tool_name
                    call_starts.setdefault(call_id, time.monotonic())
                    buffer.append(
                        ToolStartEvent(
                            call_id=call_id,
                            name=cp.tool_name,
                            args_redacted=_redact_args(cp.args),
                        )
                    )
                elif isinstance(evt, FunctionToolResultEvent):
                    res = evt.result
                    call_id = getattr(res, "tool_call_id", None) or getattr(res, "tool_name", "")
                    started = call_starts.pop(call_id, time.monotonic())
                    duration_ms = int((time.monotonic() - started) * 1000)
                    ok = True
                    if isinstance(evt.content, dict) and evt.content.get("ok") is False:
                        ok = False
                    buffer.append(
                        ToolEndEvent(
                            call_id=call_id,
                            name=getattr(res, "tool_name", "") or "",
                            ok=ok,
                            duration_ms=duration_ms,
                        )
                    )
            except Exception:
                logger.exception("Atlas event handler failed")

    # Pre-enter the agent (which enters all toolsets, including the MCP
    # streamable-http transport) on THIS task. Both __aenter__ and
    # __aexit__ now happen on the same task as the surrounding async
    # generator — anyio cancel scopes stay consistent and a client
    # disconnect mid-stream tears down cleanly instead of crashing.
    try:
        async with bundle.agent:
            async with bundle.agent.run_stream(
                req.message,
                deps=deps,
                event_stream_handler=event_handler,
            ) as result:
                # Drain text to drive the agent loop to completion;
                # the event_handler + wrapped_process append to ``buffer``
                # as side-effects of run_stream's internals. We yield
                # whatever's accumulated between chunks.
                async for _ in result.stream_text(delta=True):
                    while buffer:
                        yield buffer.pop(0)
            # Flush anything emitted after the final text chunk (e.g. a
            # tool result that came in just before stream end).
            while buffer:
                yield buffer.pop(0)
    except asyncio.CancelledError:
        # Client disconnected mid-stream — propagate so the SSE
        # generator unwinds without emitting a synthetic error.
        raise
    except Exception as e:
        logger.exception("Atlas agent run crashed")
        # Drain anything we did collect before the crash so the user
        # still sees partial output.
        while buffer:
            yield buffer.pop(0)
        yield ErrorEvent(code="agent_failed", message=str(e), retriable=True)


# --- Proposal → pending edit + preview event --------------------------------


async def _emit_proposal(
    spec: ToolSpec,
    preview: dict[str, Any],
    req: AtlasTurnRequest,
    deps: AtlasDeps,
) -> AsyncIterator[BaseModel]:
    """Persist a PendingEdit + emit the matching preview event.

    ``preview`` is the structured payload an MCP ``propose_*`` tool
    returned. Its expected shape (validated below) is::

        {
          "kind": "activity|chapter|course",
          "target": {uuid, name, parent_course_uuid?, parent_chapter_id?},
          "summary": "...",
          "mode": "rename|create|replace|...",
          "proposed": {...},
          "current": {...},      # optional
          "expected_version": 4,  # optional
          "blast_radius": {...},  # destructive only
          "challenge_phrase": "...",  # destructive only
          "apply_tool_name": "apply_activity_rename",  # which apply_* to invoke
          "apply_payload": {...},  # the args for that apply
          "tier": "EDIT|CREATE|DESTRUCTIVE",
        }
    """
    kind = preview.get("kind") or "activity"
    target_raw = preview.get("target") or {}
    target = ResourceRef(
        kind=kind,
        uuid=target_raw.get("uuid") or target_raw.get("activity_uuid") or target_raw.get("chapter_uuid") or target_raw.get("course_uuid") or "",
        name=target_raw.get("name", ""),
        parent_course_uuid=target_raw.get("parent_course_uuid"),
        parent_chapter_id=target_raw.get("parent_chapter_id"),
    )

    tier: Tier = preview.get("tier") or spec.tier
    challenge = None
    if tier == "DESTRUCTIVE":
        phrase = preview.get("challenge_phrase") or target.name
        challenge_kind = "type_name" if phrase == target.name else "type_phrase"
        challenge = ConfirmationChallenge(
            pending_id="",  # filled below
            action_label=preview.get("action_label") or _default_action_label(spec, target),
            blast_radius_summary=preview.get("blast_radius_summary") or "",
            challenge_phrase=phrase,
            challenge_kind=challenge_kind,
        )

    create = CreatePendingEditRequest(
        aichat_uuid=req.aichat_uuid,
        user_id=deps.acting_user_id,
        org_id=deps.org_id,
        tier=tier,
        tool_name=preview.get("apply_tool_name") or _default_apply_name(spec),
        target_resource=target,
        proposed_payload=preview.get("apply_payload") or {},
        current_snapshot=preview.get("current"),
        summary=preview.get("summary") or "Proposed edit.",
        blast_radius=preview.get("blast_radius"),
        expected_version=preview.get("expected_version"),
        challenge=challenge,
    )
    pe = await deps.pending_store.create(create)
    if pe.challenge is not None:
        # Backfill the pending_id now that we have one.
        pe.challenge.pending_id = pe.pending_id

    # Per-kind preview event.
    proposed = preview.get("proposed") or {}
    current = preview.get("current")
    summary = preview.get("summary") or pe.summary

    if kind == "activity":
        mode = preview.get("mode") or "replace"
        yield PreviewActivityEvent(
            pending_id=pe.pending_id,
            target=target,
            proposed=proposed,
            current=current,
            summary=summary,
            mode=mode,
            expected_version=pe.expected_version,
        )
    elif kind == "chapter":
        mode = preview.get("mode") or "edit"
        yield PreviewChapterEvent(
            pending_id=pe.pending_id,
            target=target,
            patch=proposed,
            current=current,
            summary=summary,
            mode=mode,
        )
    elif kind == "course":
        mode = preview.get("mode") or "edit"
        yield PreviewCourseEvent(
            pending_id=pe.pending_id,
            target=target,
            patch=proposed,
            current=current,
            summary=summary,
            mode=mode,
        )

    # Destructive: also emit the challenge so the UI knows to render the
    # type-back form, even though the preview card itself already arrived.
    if pe.challenge is not None:
        yield ConfirmRequiredEvent(pending_id=pe.pending_id, challenge=pe.challenge)


# --- Helpers ----------------------------------------------------------------


def _default_action_label(spec: ToolSpec, target: ResourceRef) -> str:
    """Best-effort human-readable label for a destructive confirm card."""
    verb = "Delete"
    if "publish" in spec.name:
        verb = "Change publication of"
    if "delete" not in spec.name and "publish" not in spec.name:
        verb = "Modify"
    name = target.name or f"({target.kind})"
    return f"{verb} {target.kind} '{name}'"


def _default_apply_name(spec: ToolSpec) -> str:
    """Derive the apply_* tool name from a propose_* spec when the tool
    didn't supply one in its preview payload."""
    if spec.name.startswith("propose_"):
        return "apply_" + spec.name[len("propose_"):]
    return spec.name


def _redact_args(args: Any) -> dict[str, Any]:
    """Trim large tool args before forwarding to telemetry events.

    We want call telemetry but not the full payload (markdown bodies can
    be kilobytes). Replace anything >256 chars with a placeholder.
    """
    if isinstance(args, str):
        try:
            args = json.loads(args)
        except Exception:
            return {"_raw": args[:256] + ("…" if len(args) > 256 else "")}
    if not isinstance(args, dict):
        return {"_value": str(args)[:256]}
    out: dict[str, Any] = {}
    for k, v in args.items():
        if isinstance(v, str) and len(v) > 256:
            out[k] = v[:256] + "…"
        else:
            out[k] = v
    return out
