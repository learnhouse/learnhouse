"""End-to-end check of the MCP server and its OAuth sign-in, against a live API.

Not part of CI. Run it against a local instance:

    uv run python scripts/verify_mcp_e2e.py --base http://localhost:1368 \\
        --email admin@school.dev --password <password>

It signs in like the web app, connects an MCP client the way Claude or
Cursor would (register, PKCE, consent, token), then drives the server over
both protocol eras: the pre-2026 initialize handshake and the 2026-07-28
per-request envelope. Every object it creates is deleted again.
"""

from __future__ import annotations

import argparse
import asyncio
import base64
import hashlib
import json
import secrets
import sys
from urllib.parse import parse_qs, urlparse

import httpx
import httpx2
import mcp_types as types
from mcp import Client
from mcp.client.streamable_http import streamable_http_client

PASS = "\033[32mPASS\033[0m"
FAIL = "\033[31mFAIL\033[0m"
REDIRECT_URI = "http://127.0.0.1:53682/callback"

_failures: list[str] = []


def check(label: str, ok: bool, detail: str = "") -> bool:
    print(f"  [{PASS if ok else FAIL}] {label}" + (f": {detail}" if detail else ""))
    if not ok:
        _failures.append(label)
    return ok


def payload(result: types.CallToolResult) -> dict:
    if result.structured_content is not None:
        return result.structured_content
    return json.loads(result.content[0].text)


def pkce() -> tuple[str, str]:
    verifier = secrets.token_urlsafe(48)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    return verifier, challenge


async def sign_in(api: httpx.AsyncClient, email: str, password: str) -> dict:
    resp = await api.post("/auth/login", data={"username": email, "password": password})
    check("sign in", resp.status_code == 200, f"status={resp.status_code}")
    resp.raise_for_status()
    body = resp.json()
    token = (body.get("tokens") or {}).get("access_token")
    return {"Authorization": f"Bearer {token}"} if token else {}


async def connect_app(
    base: str, api: httpx.AsyncClient, session_headers: dict, org_id: int, scope: str | None = None
) -> dict:
    """The OAuth dance an MCP client does, with the consent click done here."""
    async with httpx.AsyncClient(base_url=base, timeout=30) as raw:
        resp = await raw.post(
            "/oauth/register",
            json={"client_name": "E2E Agent", "redirect_uris": [REDIRECT_URI]},
        )
        check("register client", resp.status_code == 201, resp.text[:120])
        client_id = resp.json()["client_id"]

        verifier, challenge = pkce()
        state = secrets.token_urlsafe(8)
        params = {
            "response_type": "code",
            "client_id": client_id,
            "redirect_uri": REDIRECT_URI,
            "code_challenge": challenge,
            "code_challenge_method": "S256",
            "state": state,
            "resource": f"{base}/mcp",
        }
        if scope:
            params["scope"] = scope
        resp = await raw.get("/oauth/authorize", params=params)
        check("authorize redirects to consent", resp.status_code == 302, resp.headers.get("location", "")[:80])
        consent = urlparse(resp.headers["location"])
        request_token = parse_qs(consent.query)["request"][0]

        resp = await api.get("/mcp/oauth/authorize", params={"request": request_token}, headers=session_headers)
        check("consent screen data", resp.status_code == 200, resp.text[:120])
        info = resp.json()
        check("consent lists the org", any(o["id"] == org_id for o in info["orgs"]))

        resp = await api.post(
            "/mcp/oauth/authorize",
            json={"request": request_token, "approve": True, "org_id": org_id, "scope": scope},
            headers=session_headers,
        )
        check("approve", resp.status_code == 200, resp.text[:120])
        redirect = urlparse(resp.json()["redirect_to"])
        query = parse_qs(redirect.query)
        check("state round-trips", query.get("state") == [state])
        check("iss is returned", query.get("iss") == [base])
        code = query["code"][0]

        bad = await raw.post(
            "/oauth/token",
            data={"grant_type": "authorization_code", "code": code, "client_id": client_id,
                  "redirect_uri": REDIRECT_URI, "code_verifier": "x" * 50},
        )
        check("wrong PKCE verifier refused", bad.status_code == 400 and bad.json()["error"] == "invalid_grant")

        # The failed attempt burned the code (single use): start over.
        resp = await raw.get("/oauth/authorize", params=params)
        request_token = parse_qs(urlparse(resp.headers["location"]).query)["request"][0]
        resp = await api.post(
            "/mcp/oauth/authorize",
            json={"request": request_token, "approve": True, "org_id": org_id, "scope": scope},
            headers=session_headers,
        )
        code = parse_qs(urlparse(resp.json()["redirect_to"]).query)["code"][0]
        form = {"grant_type": "authorization_code", "code": code, "client_id": client_id,
                "redirect_uri": REDIRECT_URI, "code_verifier": verifier, "resource": f"{base}/mcp"}
        resp = await raw.post("/oauth/token", data=form)
        check("code exchange", resp.status_code == 200, resp.text[:120])
        tokens = resp.json()
        again = await raw.post("/oauth/token", data=form)
        check("code is single use", again.status_code == 400)
        tokens["client_id"] = client_id
        return tokens


def mcp_client(base: str, token: str, mode: str, **kwargs) -> Client:
    http = httpx2.AsyncClient(headers={"Authorization": f"Bearer {token}"}, timeout=60)
    return Client(streamable_http_client(f"{base}/mcp", http_client=http), mode=mode, **kwargs)


async def approve(api: httpx.AsyncClient, session_headers: dict, result: types.CallToolResult) -> str | None:
    """Play the member opening the approval link and saying yes."""
    error = payload(result).get("error") or {}
    if error.get("code") != "approval_required":
        return None
    approval_id = error.get("approval_id")
    shown = await api.get(f"/mcp/approvals/{approval_id}", headers=session_headers)
    check("approval page data", shown.status_code == 200 and shown.json()["status"] == "pending", shown.text[:120])
    decided = await api.post(f"/mcp/approvals/{approval_id}", json={"approve": True}, headers=session_headers)
    check("member approves", decided.status_code == 200 and decided.json()["status"] == "approved")
    return approval_id


async def exercise(base: str, token: str, mode: str, api: httpx.AsyncClient, session_headers: dict) -> None:
    print(f"\n== MCP over {mode} ==")

    async def approve_form(_ctx, params):
        return types.ElicitResult(action="accept", content={"approve": True})

    async with mcp_client(base, token, mode, elicitation_callback=approve_form) as client:

        async def sensitive(name: str, arguments: dict) -> types.CallToolResult:
            """Call a tool that needs approval, whichever channel the client uses."""
            result = await client.call_tool(name, arguments)
            approval_id = await approve(api, session_headers, result)
            if approval_id:
                if mode == "legacy":
                    early = await client.call_tool(name, {**arguments, "approval_id": "apr_forged"})
                    check("forged approval refused", early.is_error, payload(early)["error"]["code"])
                result = await client.call_tool(name, {**arguments, "approval_id": approval_id})
                again = await client.call_tool(name, {**arguments, "approval_id": approval_id})
                check("approval is single use", again.is_error and payload(again)["error"]["code"] in ("approval_expired", "http_404"))
            return result

        info = client.server_info
        check("server info", info is not None and info.name == "learnhouse" and bool(info.version), f"{info and info.version}")

        tools = {t.name: t for t in (await client.list_tools()).tools}
        check("tools listed", len(tools) >= 50, f"{len(tools)} tools")
        check("delete_course is destructive", bool(tools["delete_course"].annotations.destructive_hint))
        check("get_context is read-only", bool(tools["get_context"].annotations.read_only_hint))
        check("approval tools take approval_id", "approval_id" in tools["delete_course"].input_schema["properties"])
        check("no admin tools without admin access", "list_members" not in tools)

        ctx = payload(await client.call_tool("get_context", {}))
        check("get_context", ctx.get("organization", {}).get("slug") == "default" and ctx["connection"]["access"] == "write",
              json.dumps(ctx.get("connection")))
        check("organization has a web address", bool(ctx["organization"].get("url")))

        name = f"MCP E2E {mode} {secrets.token_hex(3)}"
        created = payload(await client.call_tool("create_course", {
            "name": name,
            "description": "Made by the MCP e2e check",
            "chapters": [
                {"name": "Basics", "activities": [
                    {"name": "Intro", "markdown": "# Hello\n\nSome **bold** text.\n\n> [!TIP]\n> A tip\n\n- one\n- two"},
                    {"name": "Empty page"},
                ]},
                {"name": "More", "activities": [
                    {"name": "Math", "markdown": "$$E = mc^2$$"},
                    {"name": "Check", "markdown": "```quiz\nQ: 2 + 2?\n- [x] 4\n- [ ] 5\n```\n\n```flipcards\nOne :: 1\nTwo :: 2\n```"},
                ]},
            ],
        }))
        course_uuid = (created.get("course") or {}).get("uuid")
        check("create_course with outline", bool(course_uuid) and "stopped" not in created, json.dumps(created)[:160])
        check_page = (created.get("chapters") or [{}, {}])[1].get("activities", [{}, {}])[1]
        check("quiz and flipcard fences became blocks", check_page.get("rich_blocks") == {"blockQuiz": 1, "flipcardGrid": 1},
              json.dumps(check_page)[:160])
        bad = await client.call_tool("create_course", {"name": "Never made", "chapters": [
            {"name": "A", "activities": [{"name": "Bad quiz", "markdown": "```quiz\nQ: x\n- [ ] a\n- [ ] b\n```"}]}]})
        check("a bad fence fails the whole call", bad.is_error and "Nothing was created" in payload(bad)["error"]["message"])

        found = payload(await client.call_tool("search", {"query": name, "kinds": ["course"]}))
        check("search resolves the course", found.get("status") == "resolved" and found["match"]["uuid"] == course_uuid,
              json.dumps(found)[:160])
        check("search lists results for research modes", found.get("results", [{}])[0].get("id") == course_uuid)
        opened = payload(await client.call_tool("fetch", {"id": course_uuid}))
        check("fetch opens the course as text", opened.get("title") == name and "## Basics" in opened.get("text", ""),
              json.dumps(opened)[:160])

        course = payload(await client.call_tool("get_course", {"course_uuid": course_uuid}))
        outline = course.get("chapters") or []
        pages = [a for ch in outline for a in ch.get("activities", [])]
        check("outline has chapters and pages", len(outline) == 2 and len(pages) == 4, json.dumps(outline)[:160])
        check("pages are real pages", all(a.get("type") == "page" for a in pages), str({a.get("type") for a in pages}))
        intro = pages[0]["uuid"]
        empty = pages[1]["uuid"]

        listed = payload(await client.call_tool("list_courses", {"limit": 2}))
        check("list_courses is paged", "items" in listed and "has_more" in listed and len(listed["items"]) <= 2)

        read = payload(await client.call_tool("get_activity_content", {"activity_uuid": intro, "format": "markdown"}))
        check("page reads back as Markdown", "# Hello" in read.get("markdown", "") and "[!TIP]" in read.get("markdown", ""),
              read.get("markdown", "")[:120])
        version = read.get("version")

        edited = payload(await client.call_tool("edit_activity_content", {
            "activity_uuid": intro,
            "expected_version": version,
            "ops": [
                {"op": "replace_text", "find": "Hello", "replace": "Welcome"},
                {"op": "insert", "at": "end", "block": {"quiz": {"questions": [
                    {"text": "2 + 2?", "options": [{"text": "4", "correct": True}, {"text": "5", "correct": False}]},
                ]}}},
            ],
        }))
        check("edit_activity_content applies ops as one version", edited.get("ok") is True, json.dumps(edited)[:200])
        stale = await client.call_tool("edit_activity_content", {
            "activity_uuid": intro, "expected_version": version,
            "ops": [{"op": "replace_text", "find": "Welcome", "replace": "Hi"}],
        })
        check("stale version refused", stale.is_error and payload(stale)["error"]["code"] == "http_409")

        wrote = payload(await client.call_tool("write_activity_content", {"activity_uuid": empty, "markdown": "Now with text."}))
        check("write_activity_content on an empty page", wrote.get("ok") is True, json.dumps(wrote)[:160])

        outlined = payload(await client.call_tool("get_activity_content", {"activity_uuid": intro}))
        types_seen = {b.get("type") for b in outlined.get("blocks", [])}
        check("outline shows the quiz and callout", {"blockQuiz", "callout"} <= types_seen, str(types_seen))

        res = await client.read_resource(f"learnhouse://course/{course_uuid}")
        check("course resource", bool(res.contents) and course_uuid in res.contents[0].text)
        res = await client.read_resource(f"learnhouse://activity/{intro}")
        check("page resource is Markdown", "Welcome" in res.contents[0].text)

        prompts = {p.name for p in (await client.list_prompts()).prompts}
        check("prompts listed", {"draft_course", "review_course"} <= prompts, str(prompts))

        chapter_uuid = outline[0]["uuid"]
        assignment = payload(await client.call_tool("create_assignment", {"chapter_uuid": chapter_uuid, "title": "Quiz time"}))
        a_uuid = (assignment.get("assignment") or {}).get("uuid")
        check("create_assignment", bool(a_uuid), json.dumps(assignment)[:160])
        tasks = payload(await client.call_tool("create_assignment_tasks", {"assignment_uuid": a_uuid, "tasks": [
            {"type": "quiz", "title": "Capitals", "questions": [
                {"text": "Capital of France?", "options": [{"text": "Paris", "correct": True}, {"text": "Rome", "correct": False}]}]},
            {"type": "short_answer", "title": "Sum", "prompt": "2+2?", "accepted_answers": ["4"]},
        ]}))
        check("create_assignment_tasks", len(tasks.get("tasks") or []) == 2, json.dumps(tasks)[:160])

        rename = await client.call_tool("update_course", {"course_uuid": course_uuid, "name": f"{name} renamed"})
        check("plain update needs no approval", not rename.is_error, json.dumps(payload(rename))[:120])
        published = await sensitive("update_course", {"course_uuid": course_uuid, "published": True})
        check("publish after approval", not published.is_error, json.dumps(payload(published))[:160])

        deleted = await sensitive("delete_course", {"course_uuid": course_uuid})
        check("delete after approval", not deleted.is_error, json.dumps(payload(deleted))[:160])
        gone = await client.call_tool("get_course", {"course_uuid": course_uuid})
        check("course is gone", gone.is_error)


async def essentials(base: str, token: str) -> None:
    print("\n== ?toolsets=essentials ==")
    http = httpx2.AsyncClient(headers={"Authorization": f"Bearer {token}"}, timeout=60)
    async with Client(streamable_http_client(f"{base}/mcp?toolsets=essentials", http_client=http), mode="legacy") as client:
        names = {t.name for t in (await client.list_tools()).tools}
        check("essentials fits capped clients", len(names) <= 40 and {"fetch", "create_course", "create_assignment"} <= names,
              f"{len(names)} tools")
        check("essentials leaves out the rest", "list_communities" not in names and "list_boards" not in names)


async def read_only(base: str, token: str) -> None:
    print("\n== read-only connection ==")
    async with mcp_client(base, token, "legacy") as client:
        names = {t.name for t in (await client.list_tools()).tools}
        check("no write tools listed", "create_course" not in names and "list_courses" in names, f"{len(names)} tools")
        result = await client.call_tool("create_course", {"name": "should fail"})
        check("write refused", result.is_error and payload(result)["error"]["code"] in ("unknown_tool", "insufficient_scope"), json.dumps(payload(result))[:160])


async def admin_access(base: str, token: str) -> None:
    print("\n== admin connection ==")
    async with mcp_client(base, token, "legacy") as client:
        names = {t.name for t in (await client.list_tools()).tools}
        check("admin tools listed", {"list_members", "list_roles", "update_org_settings"} <= names, f"{len(names)} tools")
        members = payload(await client.call_tool("list_members", {"limit": 5}))
        check("list_members", bool(members.get("items")), json.dumps(members)[:120])
        ctx = payload(await client.call_tool("get_context", {}))
        check("connection says admin", ctx["connection"]["access"] == "admin")


async def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", default="http://localhost:1368")
    parser.add_argument("--email", default="admin@school.dev")
    parser.add_argument("--password", required=True)
    parser.add_argument("--org-id", type=int, default=1)
    args = parser.parse_args()
    base = args.base.rstrip("/")

    async with httpx.AsyncClient(base_url=f"{base}/api/v1", timeout=30) as api:
        print("== OAuth sign-in ==")
        session_headers = await sign_in(api, args.email, args.password)
        tokens = await connect_app(base, api, session_headers, args.org_id)
        await exercise(base, tokens["access_token"], "legacy", api, session_headers)
        await exercise(base, tokens["access_token"], "auto", api, session_headers)
        await essentials(base, tokens["access_token"])

        print("\n== tokens ==")
        async with httpx.AsyncClient(base_url=base, timeout=30) as raw:
            resp = await raw.post("/oauth/token", data={"grant_type": "refresh_token", "client_id": tokens["client_id"], "refresh_token": tokens["refresh_token"]})
            check("refresh", resp.status_code == 200, resp.text[:100])
            rotated = resp.json()
            replay = await raw.post("/oauth/token", data={"grant_type": "refresh_token", "client_id": tokens["client_id"], "refresh_token": tokens["refresh_token"]})
            check("refresh replay refused", replay.status_code == 400)
            after = await raw.post("/oauth/token", data={"grant_type": "refresh_token", "client_id": tokens["client_id"], "refresh_token": rotated["refresh_token"]})
            check("replay revoked the whole grant", after.status_code == 400)
            resp = await raw.post("/mcp", headers={"Authorization": "Bearer lho_at_nope", "Content-Type": "application/json"},
                                  json={"jsonrpc": "2.0", "id": 1, "method": "tools/list"})
            check("bad token gets a discovery challenge", resp.status_code == 401 and "resource_metadata" in resp.headers.get("www-authenticate", ""))

        ro = await connect_app(base, api, session_headers, args.org_id, scope="mcp:read")
        await read_only(base, ro["access_token"])
        admin = await connect_app(base, api, session_headers, args.org_id, scope="mcp:read mcp:write mcp:admin")
        await admin_access(base, admin["access_token"])

        print("\n== connected apps ==")
        resp = await api.get(f"/mcp/orgs/{args.org_id}/connections", headers=session_headers)
        apps = resp.json()
        check("connections listed", resp.status_code == 200 and len(apps) >= 1, f"{len(apps)} active")
        for app in apps:
            resp = await api.delete(f"/mcp/orgs/{args.org_id}/connections/{app['grant_uuid']}", headers=session_headers)
            check(f"disconnect {app['grant_uuid'][:16]}", resp.status_code == 200)

    print()
    if _failures:
        print(f"{len(_failures)} check(s) FAILED: {_failures}")
        return 1
    print("All MCP e2e checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
