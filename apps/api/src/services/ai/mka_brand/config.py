"""Environment config for the MKA Brand Center integration (fork-owned).

Read at call time so unsetting ``MKA_BRANDCENTER_TOKEN`` is an immediate kill switch.
"""

from __future__ import annotations

import os

DEFAULT_URL = "https://mkausa.design/mcp"
DEFAULT_BRAND = "mka-usa"

# Read-only tools the model may call. Every build/compose/audit/list tool is excluded.
ALLOWED_TOOLS: frozenset[str] = frozenset(
    {
        "get_culture_guardrails",
        "search_visual_kb",
        "get_brand_context",
        "search_brand_context",
        "check_copy",
        "get_prompt_vocabulary",
        "get_brand_guidelines",
    }
)

MAX_TOOL_CALLS_PER_RUN = 4
INIT_TIMEOUT_S = 5.0
CALL_TIMEOUT_S = 15.0


def token() -> str | None:
    value = (os.environ.get("MKA_BRANDCENTER_TOKEN") or "").strip()
    return value or None


def enabled() -> bool:
    return token() is not None


def url() -> str:
    return (os.environ.get("MKA_BRANDCENTER_URL") or "").strip() or DEFAULT_URL


def brand() -> str:
    return (os.environ.get("MKA_BRANDCENTER_BRAND") or "").strip() or DEFAULT_BRAND


def headers() -> dict[str, str]:
    return {"Authorization": f"Bearer {token()}"}
