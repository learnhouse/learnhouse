"""AI interactive-scenario generation service (editor `scenarios` block).

Structured output keeps the branching valid; the service resolves the AI's
``ref``/``next_ref`` links to stable ids and stamps the exact shape the
ScenariosExtension renders. Mirrors the quiz generator (Redis refine session +
durable history).
"""

from __future__ import annotations

import json
import logging
from uuid import uuid4

from src.services.ai.base import get_chat_session_history, save_message_to_history
from src.services.ai.llm import generate, model_for_tier
from src.services.ai.rag.content_extraction import extract_text_from_prosemirror
from src.services.ai.schemas.scenario import GeneratedScenarioSet

logger = logging.getLogger(__name__)

MAX_SCENARIOS = 40
MAX_CONTEXT_CHARS = 6000

_SYSTEM_PROMPT = """You are an instructional designer building a branching, interactive scenario for a course.

A scenario is a decision tree of nodes. Each node has narrative text and 2-4 options.
Each option either leads to another node (by its ref) or ends the scenario.

Rules:
- Give every node a short unique `ref` (e.g. "start", "s2", "win"). One node's ref must be "start" (the entry point).
- Each option's `next_ref` must be either the ref of an existing node or null to end the scenario.
- Ensure at least one path reaches an ending (an option with null next_ref). Avoid dead links.
- Keep node text concise (1-3 sentences) and options short and actionable.
- Base the scenario on the provided course content when supplied; write in its language.
- Return ONLY the structured scenario."""


def _build_prompt(prompt: str, num_scenarios: int, context: str) -> str:
    parts = [
        f"Create an interactive branching scenario with about {num_scenarios} nodes.",
        f"Topic / instructions: {prompt.strip()}",
    ]
    if context:
        parts.append(f"\nCourse content to base it on:\n{context[:MAX_CONTEXT_CHARS]}")
    return "\n".join(parts)


def _to_block_scenario(generated: GeneratedScenarioSet) -> dict:
    """Resolve refs → ids and stamp the ScenariosExtension block shape."""
    # Map each ref to a stable id, preserving order; guarantee a valid entry node.
    nodes = [s for s in generated.scenarios if s.text]
    if not nodes:
        return {"title": generated.title or "Interactive Scenario", "scenarios": [], "currentScenarioId": ""}

    ref_to_id: dict[str, str] = {}
    for idx, node in enumerate(nodes, start=1):
        ref_to_id[node.ref] = str(idx)

    scenarios = []
    for idx, node in enumerate(nodes, start=1):
        options = []
        for opt in node.options:
            next_id = ref_to_id.get(opt.next_ref) if opt.next_ref else None
            options.append(
                {
                    "id": f"opt_{uuid4().hex[:8]}",
                    "text": opt.text,
                    "nextScenarioId": next_id,
                }
            )
        scenarios.append(
            {
                "id": str(idx),
                "text": node.text,
                "imageUrl": "",
                "options": options,
            }
        )

    # Entry node: prefer the one whose ref maps like "start", else the first.
    start_id = ref_to_id.get("start", "1")
    return {
        "title": generated.title or "Interactive Scenario",
        "scenarios": scenarios,
        "currentScenarioId": start_id,
    }


async def generate_scenario(
    *,
    org_id: int,
    prompt: str,
    model_name: str,
    activity_content: dict | None = None,
    num_scenarios: int = 5,
    session_uuid: str | None = None,
) -> tuple[dict, str]:
    """Generate a `scenarios` block payload. Returns ``(block_attrs, session_uuid)``."""
    num_scenarios = max(2, min(num_scenarios, MAX_SCENARIOS))

    context = ""
    if activity_content:
        try:
            context = extract_text_from_prosemirror(activity_content) or ""
        except Exception:
            logger.warning("Failed to extract activity content for scenario grounding", exc_info=True)

    session = get_chat_session_history(session_uuid)
    resolved_session_uuid = session["aichat_uuid"]
    history = session["message_history"]

    generated: GeneratedScenarioSet = await generate(
        model_name=model_name or model_for_tier("standard"),
        user_prompt=_build_prompt(prompt, num_scenarios, context),
        system_prompt=_SYSTEM_PROMPT,
        history=history,
        output_type=GeneratedScenarioSet,
    )

    block = _to_block_scenario(generated)

    # Persist the actual generated scenario so a refine turn can amend it.
    try:
        save_message_to_history(resolved_session_uuid, prompt.strip(), json.dumps(block), org_id=org_id)
    except Exception:
        logger.debug("Failed to persist scenario refine history", exc_info=True)

    return block, resolved_session_uuid
