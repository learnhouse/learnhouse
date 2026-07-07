"""End-to-end verification of the embedded MCP server + agent tools.

Run manually against a live instance (not part of CI):

    uv run python scripts/verify_agent_e2e.py \
        --base http://localhost:1348 \
        --email admin@school.dev --password <password>

Flow: login (JWT) → mint an org-scoped lh_ API token → connect a real MCP
client over streamable HTTP → initialize + tools/list → run READ, CREATE,
and DESTRUCTIVE (deny-then-confirm) tool calls → clean up.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
import uuid

import httpx
from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client

# Buckets the token-rights validator requires, with all actions granted.
_ALL_PERMS = {
    "action_create": True,
    "action_read": True,
    "action_update": True,
    "action_delete": True,
}
_RIGHTS_BUCKETS = (
    "courses", "users", "usergroups", "folders", "media", "organizations",
    "coursechapters", "activities", "assignments", "roles", "communities",
    "discussions", "podcasts", "boards", "playgrounds",
    "certifications", "payments", "search",
)

PASS = "\033[32mPASS\033[0m"
FAIL = "\033[31mFAIL\033[0m"

_failures: list[str] = []


def check(label: str, ok: bool, detail: str = "") -> None:
    print(f"  [{PASS if ok else FAIL}] {label}" + (f" — {detail}" if detail else ""))
    if not ok:
        _failures.append(label)


def _full_rights() -> dict:
    """Maximal Rights payload covering every bucket the token validator
    requires. Sent as a raw dict so the endpoint keeps the extra buckets
    (certifications/payments/search) the validator demands."""
    rights = {b: dict(_ALL_PERMS) for b in _RIGHTS_BUCKETS}
    rights["dashboard"] = {"action_access": True}
    return rights


def tool_payload(result) -> dict:
    """Extract the JSON payload from a tools/call result."""
    text = result.content[0].text
    return json.loads(text)


async def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", default="http://localhost:1348")
    parser.add_argument("--email", default="admin@school.dev")
    parser.add_argument("--password", required=True)
    parser.add_argument("--org-id", type=int, default=1)
    args = parser.parse_args()
    token_name = f"agent-e2e-{uuid.uuid4().hex[:8]}"

    api = f"{args.base}/api/v1"

    async with httpx.AsyncClient(base_url=api, timeout=30) as http:
        # 1. Login for a session (form-encoded, same as the web app).
        resp = await http.post(
            "/auth/login",
            data={"username": args.email, "password": args.password},
        )
        check("login", resp.status_code == 200, f"status={resp.status_code}")
        if resp.status_code != 200:
            return 1
        access_token = resp.json()["tokens"]["access_token"] if "tokens" in resp.json() else None
        cookies = resp.cookies
        auth_headers = (
            {"Authorization": f"Bearer {access_token}"} if access_token else {}
        )

        # 2. Mint an org-scoped API token with broad rights. Fetch the full
        # Rights schema from the live OpenAPI so every bucket the validator
        # requires is present, then flip all action_* flags on.
        rights = _full_rights()
        resp = await http.post(
            f"/orgs/{args.org_id}/api-tokens",
            json={"name": token_name, "description": "e2e verification", "rights": rights},
            headers=auth_headers,
            cookies=cookies,
        )
        check("mint api token", resp.status_code == 200, f"status={resp.status_code} {resp.text[:120]}")
        if resp.status_code != 200:
            return 1
        token = resp.json()["token"]

    # 3. Connect a real MCP client to /mcp.
    mcp_url = f"{args.base}/mcp/"
    async with streamablehttp_client(
        mcp_url, headers={"Authorization": f"Bearer {token}"}
    ) as (read, write, _get_session_id):
        async with ClientSession(read, write) as session:
            init = await session.initialize()
            check("mcp initialize", init.serverInfo.name == "learnhouse", init.serverInfo.name)

            tools = await session.list_tools()
            names = {t.name for t in tools.tools}
            check("tools/list count", len(names) >= 80, f"{len(names)} tools")
            check(
                "core tools present",
                {"search_courses", "create_course", "delete_course", "resolve_entity"} <= names,
            )
            destructive = [t for t in tools.tools if t.name == "delete_course"][0]
            check(
                "destructive schema has confirm",
                "confirm" in destructive.inputSchema.get("properties", {}),
            )

            # READ
            result = await session.call_tool("list_courses", {"limit": 5})
            payload = tool_payload(result)
            check("list_courses executes", payload["status"] == "executed", str(payload)[:120])

            # CREATE (execute-mode: runs immediately, bounded by token rights)
            result = await session.call_tool(
                "create_course", {"name": "Agent E2E Course", "description": "created by verify_agent_e2e"}
            )
            payload = tool_payload(result)
            check("create_course executes", payload["status"] == "executed", str(payload)[:120])
            course_uuid = (payload.get("result") or {}).get("course_uuid")
            check("created course has uuid", bool(course_uuid), str(course_uuid))

            # resolve_entity finds it
            result = await session.call_tool(
                "resolve_entity", {"kind": "course", "selector": "Agent E2E Course"}
            )
            payload = tool_payload(result)
            resolved = payload.get("result") or {}
            check(
                "resolve_entity resolves it",
                payload["status"] == "executed" and resolved.get("status") == "resolved",
                str(resolved.get("status")),
            )

            # DESTRUCTIVE without confirm → denied
            result = await session.call_tool("delete_course", {"course_uuid": course_uuid})
            payload = tool_payload(result)
            check(
                "delete without confirm denied",
                payload["status"] == "denied" and payload.get("code") == "confirmation_required",
                str(payload)[:120],
            )

            # DESTRUCTIVE with confirm → executed (cleanup)
            result = await session.call_tool(
                "delete_course", {"course_uuid": course_uuid, "confirm": True}
            )
            payload = tool_payload(result)
            check("delete with confirm executes", payload["status"] == "executed", str(payload)[:120])

            # Bad auth is rejected end-to-end
    async with httpx.AsyncClient(timeout=10) as raw:
        resp = await raw.post(
            mcp_url,
            headers={"Authorization": "Bearer lh_invalid", "Content-Type": "application/json"},
            json={"jsonrpc": "2.0", "id": 1, "method": "initialize"},
        )
        check("invalid token rejected", resp.status_code == 401, f"status={resp.status_code}")
        resp = await raw.post(
            mcp_url,
            headers={"Content-Type": "application/json"},
            json={"jsonrpc": "2.0", "id": 1, "method": "initialize"},
        )
        check("missing token rejected", resp.status_code == 401, f"status={resp.status_code}")

    print()
    if _failures:
        print(f"{len(_failures)} check(s) FAILED: {_failures}")
        return 1
    print("All e2e checks passed ✅")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
