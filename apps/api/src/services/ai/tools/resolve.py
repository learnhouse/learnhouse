"""Entity resolution — the agent's search-first autonomy core.

`resolve_entity` turns a natural-language selector ("the Python course",
"John from marketing", "chapter two of Algebra") into a concrete uuid by
running the org's own search surfaces, so the agent never has to ask the
user for identifiers. Returns resolved / ambiguous(candidates) /
not_found(suggestions) — which the chat surface maps 1:1 onto the
`entity.*` SSE events.
"""

from __future__ import annotations

import unicodedata
from typing import Any, Literal

from pydantic import BaseModel, Field

from src.security.rbac import AccessAction
from src.services.ai.tools.base import ActionTier, ToolContext, ToolSpec, jsonable
from src.services.courses.courses import get_course_meta, search_courses
from src.services.folders.folders import search_library
from src.services.orgs.users import get_organization_users
from src.services.search.search import search_across_org

ResolveKind = Literal[
    "course", "chapter", "activity", "user", "community", "folder", "any"
]

# Decision thresholds
_RESOLVE_SCORE = 0.75
_RESOLVE_MARGIN = 0.15
_CANDIDATE_FLOOR = 0.35
_MAX_CANDIDATES = 5


def _norm(s: str) -> str:
    s = unicodedata.normalize("NFKC", s or "").lower().strip()
    return " ".join(s.split())


def _score(query: str, name: str) -> float:
    q, n = _norm(query), _norm(name)
    if not q or not n:
        return 0.0
    if q == n:
        return 1.0
    if n.startswith(q) or q.startswith(n):
        return 0.85
    if q in n or n in q:
        return 0.75
    qt, nt = set(q.split()), set(n.split())
    union = qt | nt
    if not union:
        return 0.0
    return 0.7 * (len(qt & nt) / len(union))


def _candidate(kind: str, uuid: str, name: str, score: float, **extra) -> dict:
    label = extra.pop("label", name)
    return {
        "kind": kind,
        "uuid": uuid,
        "name": name,
        "label": label,
        "score": round(score, 3),
        **extra,
    }


def _decide(selector: str, kind: str, candidates: list[dict], via: str) -> dict:
    ranked = sorted(candidates, key=lambda c: c["score"], reverse=True)
    viable = [c for c in ranked if c["score"] >= _CANDIDATE_FLOOR]
    if viable:
        top = viable[0]
        second = viable[1]["score"] if len(viable) > 1 else 0.0
        if top["score"] >= _RESOLVE_SCORE and (
            len(viable) == 1 or top["score"] - second >= _RESOLVE_MARGIN
        ):
            return {
                "status": "resolved",
                "kind": top["kind"],
                "selector": selector,
                "match": top,
                "candidates": [],
                "via": via,
            }
        return {
            "status": "ambiguous",
            "kind": kind,
            "selector": selector,
            "match": None,
            "candidates": viable[:_MAX_CANDIDATES],
            "via": via,
        }
    return {
        "status": "not_found",
        "kind": kind,
        "selector": selector,
        "match": None,
        "candidates": ranked[:3],
        "via": via,
    }


# ─── per-kind collectors ───────────────────────────────────────────────────


async def _collect_courses(ctx: ToolContext, selector: str) -> list[dict]:
    courses = await search_courses(
        ctx.request, ctx.user, ctx.org_slug, selector, ctx.db_session, page=1, limit=10
    )
    return [
        _candidate("course", c.course_uuid, c.name, _score(selector, c.name))
        for c in courses
        if c.course_uuid
    ]


async def _collect_course_tree(
    ctx: ToolContext, selector: str, kind: str, parent_course_uuid: str
) -> list[dict]:
    meta = await get_course_meta(
        ctx.request, parent_course_uuid, True, ctx.user, ctx.db_session, slim=True
    )
    data = jsonable(meta)
    out: list[dict] = []
    for chapter in data.get("chapters") or []:
        if kind == "chapter":
            out.append(
                _candidate(
                    "chapter",
                    chapter.get("chapter_uuid") or "",
                    chapter.get("name") or "",
                    _score(selector, chapter.get("name") or ""),
                    parent_course_uuid=parent_course_uuid,
                )
            )
        else:
            for activity in chapter.get("activities") or []:
                out.append(
                    _candidate(
                        "activity",
                        activity.get("activity_uuid") or "",
                        activity.get("name") or "",
                        _score(selector, activity.get("name") or ""),
                        parent_course_uuid=parent_course_uuid,
                        label=f"{activity.get('name')} (in {chapter.get('name')})",
                    )
                )
    return [c for c in out if c["uuid"]]


async def _collect_users(ctx: ToolContext, selector: str) -> list[dict]:
    result = await get_organization_users(
        ctx.request,
        ctx.org.id,
        ctx.db_session,
        ctx.user,
        page=1,
        limit=10,
        search=selector,
    )
    data = jsonable(result)
    if isinstance(data, dict):
        rows = data.get("items") or data.get("users") or []
    elif isinstance(data, list):
        rows = data
    else:
        rows = []
    out = []
    for row in rows:
        user = row.get("user") if isinstance(row, dict) and "user" in row else row
        if not isinstance(user, dict):
            continue
        uuid = user.get("user_uuid") or ""
        username = user.get("username") or ""
        full_name = " ".join(
            x for x in (user.get("first_name"), user.get("last_name")) if x
        )
        display = full_name or username
        best = max(
            _score(selector, username),
            _score(selector, full_name),
            _score(selector, user.get("email") or ""),
        )
        if uuid:
            out.append(
                _candidate(
                    "user", uuid, display, best, label=f"{display} (@{username})"
                )
            )
    return out


async def _collect_communities(ctx: ToolContext, selector: str) -> list[dict]:
    result = await search_across_org(
        ctx.request, ctx.user, ctx.org_slug, selector, ctx.db_session, page=1, limit=10
    )
    data = jsonable(result)
    return [
        _candidate(
            "community",
            c.get("community_uuid") or "",
            c.get("name") or "",
            _score(selector, c.get("name") or ""),
        )
        for c in data.get("communities") or []
        if c.get("community_uuid")
    ]


async def _collect_folders(ctx: ToolContext, selector: str) -> list[dict]:
    result = await search_library(
        ctx.request, str(ctx.org.id), selector, ctx.user, ctx.db_session
    )
    data = jsonable(result)
    return [
        _candidate(
            "folder",
            f.get("folder_uuid") or "",
            f.get("name") or "",
            _score(selector, f.get("name") or ""),
        )
        for f in data.get("folders") or []
        if f.get("folder_uuid")
    ]


# ─── tool ──────────────────────────────────────────────────────────────────


class ResolveEntityParams(BaseModel):
    kind: ResolveKind = Field(
        ...,
        description=(
            "What to resolve: course, chapter, activity (both need "
            "parent_course_uuid), user, community, folder, or 'any' for a "
            "cross-type search."
        ),
    )
    selector: str = Field(..., min_length=1, description="The name as the user said it")
    parent_course_uuid: str | None = Field(
        None, description="Required when kind is chapter or activity"
    )


async def _resolve_entity(ctx: ToolContext, p: ResolveEntityParams) -> dict[str, Any]:
    kind = p.kind
    if kind in ("chapter", "activity"):
        if not p.parent_course_uuid:
            return {
                "status": "not_found",
                "kind": kind,
                "selector": p.selector,
                "match": None,
                "candidates": [],
                "via": "missing_parent — resolve the course first, then retry "
                "with parent_course_uuid",
            }
        candidates = await _collect_course_tree(
            ctx, p.selector, kind, p.parent_course_uuid
        )
        return _decide(p.selector, kind, candidates, via="course_tree")

    if kind == "course":
        return _decide(
            p.selector, kind, await _collect_courses(ctx, p.selector), via="course_search"
        )
    if kind == "user":
        return _decide(
            p.selector, kind, await _collect_users(ctx, p.selector), via="org_users"
        )
    if kind == "community":
        return _decide(
            p.selector,
            kind,
            await _collect_communities(ctx, p.selector),
            via="org_search",
        )
    if kind == "folder":
        return _decide(
            p.selector, kind, await _collect_folders(ctx, p.selector), via="library"
        )

    # kind == "any": merge the cheap cross-type surfaces.
    candidates: list[dict] = []
    candidates += await _collect_courses(ctx, p.selector)
    candidates += await _collect_communities(ctx, p.selector)
    candidates += await _collect_folders(ctx, p.selector)
    return _decide(p.selector, "any", candidates, via="org_search")


SPECS: list[ToolSpec] = [
    ToolSpec(
        name="resolve_entity",
        description=(
            "Resolve a natural-language name to a concrete entity uuid. "
            "ALWAYS use this (or a search tool) instead of asking the user "
            "for ids. Returns resolved (act on match.uuid), ambiguous (ask "
            "the user to pick from candidates), or not_found."
        ),
        params_model=ResolveEntityParams,
        tier=ActionTier.READ,
        rights_bucket=None,
        access_action=AccessAction.READ,
        execute=_resolve_entity,
    ),
]
