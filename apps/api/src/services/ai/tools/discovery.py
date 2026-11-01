"""Orientation tools: where am I, what can I do here, and where is X.

`get_context` is the first call an agent makes: the organization, the caller
and their role, what this connection may do, the features that are on, and
how much the organization holds. `search` turns the names people use into
ids: one ranked list of matches across every kind of object, with a verdict
(resolved, ambiguous, not found) the agent can act on, and optionally
passages found by meaning inside lessons, documents and transcripts.
"""

from __future__ import annotations

import logging
import unicodedata
from typing import Any, Literal

from fastapi import HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlmodel import select

from src.db.organization_config import OrganizationConfig
from src.db.users import APITokenUser
from src.security.auth import resolve_acting_user_id
from src.security.features_utils.resolve import resolve_all_features, resolve_feature
from src.security.org_auth import get_user_org_role, is_org_admin
from src.security.rbac import AccessAction, AccessContext, check_resource_access
from src.services.ai.tools import refs
from src.services.ai.tools.base import ActionTier, ToolContext, ToolSpec, jsonable
from src.services.ai.tools.registry import _token_bucket_allows
from src.services.ai.tools.results import clip, untrusted

logger = logging.getLogger(__name__)


async def _org_config(ctx: ToolContext) -> dict:
    row = (
        await ctx.db_session.execute(
            select(OrganizationConfig).where(OrganizationConfig.org_id == ctx.org.id)
        )
    ).scalars().first()
    return (row.config or {}) if row else {}


def _plan(config: dict) -> str:
    if str(config.get("config_version", "1.0")).startswith("2"):
        return config.get("plan", "free")
    return config.get("cloud", {}).get("plan", "free")


async def _is_staff(ctx: ToolContext) -> bool:
    """Admins and maintainers (and API tokens, bounded by their own rights)."""
    if isinstance(ctx.user, APITokenUser):
        return True
    # is_org_admin covers maintainers too.
    return await is_org_admin(resolve_acting_user_id(ctx.user), ctx.org.id, ctx.db_session)


# ─── get_context ──────────────────────────────────────────────────────────────


class GetContextParams(BaseModel):
    pass


async def _counts(ctx: ToolContext, staff: bool) -> dict:
    from src.db.communities.communities import Community
    from src.db.courses.courses import Course
    from src.db.user_organizations import UserOrganization

    async def count(stmt) -> int:
        return int((await ctx.db_session.execute(stmt)).scalar() or 0)

    courses = select(func.count()).select_from(Course).where(Course.org_id == ctx.org.id)
    out = {
        "courses": await count(courses if staff else courses.where(Course.published.is_(True))),
        "communities": await count(
            select(func.count()).select_from(Community).where(Community.org_id == ctx.org.id)
        ),
    }
    if staff:
        out["unpublished_courses"] = await count(courses.where(Course.published.is_(False)))
        out["members"] = await count(
            select(func.count())
            .select_from(UserOrganization)
            .where(UserOrganization.org_id == ctx.org.id)
        )
    return out


async def _get_context(ctx: ToolContext, _p: GetContextParams):
    config = await _org_config(ctx)
    features = resolve_all_features(config, ctx.org.id)
    acting_user_id = resolve_acting_user_id(ctx.user)

    if isinstance(ctx.user, APITokenUser):
        caller = {
            "kind": "api_token",
            "name": ctx.user.token_name,
            "note": "Acting with an API token; its rights limit every call.",
        }
    else:
        role = await get_user_org_role(acting_user_id, ctx.org.id, ctx.db_session)
        name = " ".join(
            part for part in (getattr(ctx.user, "first_name", ""), getattr(ctx.user, "last_name", "")) if part
        )
        caller = {
            "kind": "member",
            "user_uuid": getattr(ctx.user, "user_uuid", None),
            "username": getattr(ctx.user, "username", None),
            "name": name or None,
            "role": refs.ref("role", role.role_uuid, role.name) if role else None,
            "is_admin_or_maintainer": await is_org_admin(acting_user_id, ctx.org.id, ctx.db_session),
        }

    if ctx.read_only:
        access = "read"
    elif ctx.can_admin:
        access = "admin"
    else:
        access = "write"
    staff = await _is_staff(ctx)
    base = await refs.web_base(ctx)
    return {
        "organization": {
            "name": ctx.org.name,
            "slug": ctx.org.slug,
            "uuid": ctx.org.org_uuid,
            "plan": _plan(config),
            "url": base or None,
            "dashboard_url": f"{base}/dash" if base else None,
        },
        "caller": caller,
        "connection": {
            "access": access,
            "meaning": {
                "read": "Can read only; every change is refused.",
                "write": "Can read and change content (courses, pages, assignments, community posts). Members, roles and settings are out of reach.",
                "admin": "Can also manage members, groups, roles and organization settings, within the caller's role.",
            }[access],
        },
        "features": {
            name: bool(state.get("enabled"))
            for name, state in features.items()
            if name not in ("members",)
        },
        "counts": await _counts(ctx, staff),
        "model": (
            "An organization holds courses. A course has ordered chapters; a chapter has "
            "ordered activities: pages (made of blocks: text, quizzes, callouts, media), "
            "videos, documents, assignments, SCORM packages. The library files resources "
            "in folders. Communities hold discussions. Usergroups gate who can see linked "
            "resources; roles grant rights. Every id is a prefixed uuid (course_..., "
            "chapter_..., activity_..., user_...): pass it back exactly as you received it."
        ),
    }


# ─── search ───────────────────────────────────────────────────────────────────

SearchKind = Literal[
    "course",
    "chapter",
    "activity",
    "assignment",
    "community",
    "discussion",
    "folder",
    "playground",
    "member",
    "usergroup",
    "role",
]
_ALL_KINDS = SearchKind.__args__  # type: ignore[attr-defined]

# Verdict thresholds.
_RESOLVE_SCORE = 0.75
_RESOLVE_MARGIN = 0.15
_CANDIDATE_FLOOR = 0.3


class SearchParams(BaseModel):
    query: str = Field(
        ...,
        min_length=2,
        max_length=200,
        description="A name, title or topic as the user said it.",
    )
    kinds: list[SearchKind] | None = Field(
        None,
        max_length=11,
        description=(
            "Only look for these kinds. Omit to look everywhere. Chapters and "
            "activities are matched inside course_uuid when given, across the "
            "organization otherwise."
        ),
    )
    course_uuid: str | None = Field(None, description="Only search inside this course (course_...).")
    in_content: bool = Field(
        False,
        description=(
            "Also search inside lesson text, documents and video/audio transcripts by "
            "meaning, returning passages. Needs the organization's AI search."
        ),
    )
    limit: int = Field(10, ge=1, le=25, description="Most matches to return.")


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
    return 0.7 * (len(qt & nt) / len(union)) if union else 0.0


def _like(query: str) -> str:
    from src.services.search.normalization import build_like_pattern

    return build_like_pattern(query)


async def _readable_course(ctx: ToolContext, course_uuid: str, cache: dict) -> tuple[bool, bool]:
    """(can read, can edit) a course, memoized for one search."""
    if course_uuid in cache:
        return cache[course_uuid]
    read = await check_resource_access(
        ctx.request, ctx.db_session, ctx.user, course_uuid, AccessAction.READ,
        context=AccessContext.DASHBOARD, raise_on_deny=False,
    )
    edit = False
    if read.allowed:
        decision = await check_resource_access(
            ctx.request, ctx.db_session, ctx.user, course_uuid, AccessAction.UPDATE,
            context=AccessContext.DASHBOARD, raise_on_deny=False,
        )
        edit = decision.allowed
    cache[course_uuid] = (read.allowed, edit)
    return cache[course_uuid]


async def _org_search(ctx: ToolContext, p: SearchParams) -> dict:
    from src.services.search.search import search_across_org

    if len(p.query.strip()) < 3:
        return {}
    data = jsonable(
        await search_across_org(
            request=ctx.request,
            current_user=ctx.user,
            org_slug=ctx.org.slug,
            search_query=p.query,
            db_session=ctx.db_session,
            page=1,
            limit=p.limit,
        )
    )
    return data if isinstance(data, dict) else {}


async def _from_org_search(ctx: ToolContext, p: SearchParams, wanted: set[str]) -> list[dict]:
    data = await _org_search(ctx, p) if wanted & {"course", "community", "discussion", "folder", "playground", "member"} else {}
    out: list[dict] = []
    if "course" in wanted:
        for c in data.get("courses") or []:
            out.append(refs.ref(
                "course", c.get("course_uuid"), c.get("name"),
                await refs.web_url(ctx, "course", course=c.get("course_uuid")),
                published=c.get("published"),
                description=clip(c.get("description"), 160),
            ))
    if "community" in wanted:
        for c in data.get("communities") or []:
            out.append(refs.ref(
                "community", c.get("community_uuid"), c.get("name"),
                await refs.web_url(ctx, "community", community=c.get("community_uuid")),
            ))
    if "discussion" in wanted:
        for d in data.get("discussions") or []:
            out.append(refs.ref(
                "discussion", d.get("discussion_uuid"), clip(d.get("title"), 160),
                await refs.web_url(
                    ctx, "discussion", community=d.get("community_uuid"), discussion=d.get("discussion_uuid")
                ),
            ))
    if "folder" in wanted:
        for f in data.get("folders") or []:
            out.append(refs.ref(
                "folder", f.get("folder_uuid"), f.get("name"),
                await refs.web_url(ctx, "folder", folder=f.get("folder_uuid")),
            ))
    if "playground" in wanted:
        for g in data.get("playgrounds") or []:
            out.append(refs.ref(
                "playground", g.get("playground_uuid"), g.get("name"),
                await refs.web_url(ctx, "playground", playground=g.get("playground_uuid")),
            ))
    if "member" in wanted:
        for u in data.get("users") or []:
            name = " ".join(x for x in (u.get("first_name"), u.get("last_name")) if x)
            out.append(refs.ref(
                "member", u.get("user_uuid"), name or u.get("username"),
                await refs.web_url(ctx, "user", username=u.get("username")),
                username=u.get("username"),
            ))
    return out


async def _course_items(ctx: ToolContext, p: SearchParams, wanted: set[str]) -> list[dict]:
    """Chapters, activities and assignments matched by name, only in courses
    the caller can read, and drafts only for those who can edit them."""
    from src.db.courses.activities import Activity
    from src.db.courses.assignments import Assignment
    from src.db.courses.chapters import Chapter
    from src.db.courses.courses import Course

    course_filter = None
    if p.course_uuid:
        course = await refs.load(ctx, "course", p.course_uuid)
        course_filter = course.id
    pattern = _like(p.query)
    cache: dict = {}
    out: list[dict] = []

    async def emit(kind: str, row: Any, name: str, course_uuid: str, course_name: str, extra: dict) -> None:
        can_read, can_edit = await _readable_course(ctx, course_uuid, cache)
        if not can_read:
            return
        if not can_edit and extra.get("published") is False:
            return
        out.append(refs.ref(kind, getattr(row, f"{kind}_uuid"), name, **extra,
                            **{"in": refs.ref("course", course_uuid, course_name)}))

    specs = (
        ("chapter", Chapter, Chapter.name, Chapter.course_id),
        ("activity", Activity, Activity.name, Activity.course_id),
        ("assignment", Assignment, Assignment.title, Assignment.course_id),
    )
    for kind, model, column, course_col in specs:
        if kind not in wanted:
            continue
        stmt = (
            select(model, Course.course_uuid, Course.name)
            .join(Course, Course.id == course_col)
            .where(model.org_id == ctx.org.id, column.ilike(pattern))
            .limit(p.limit)
        )
        if course_filter is not None:
            stmt = stmt.where(course_col == course_filter)
        for row, course_uuid, course_name in (await ctx.db_session.execute(stmt)).all():
            extra: dict = {}
            if kind == "activity":
                extra["published"] = row.published
                extra["url"] = await refs.web_url(ctx, "activity", course=course_uuid, activity=row.activity_uuid)
            elif kind == "assignment":
                extra["published"] = row.published
                extra["url"] = await refs.web_url(ctx, "assignment", assignment=row.assignment_uuid)
            name = row.title if kind == "assignment" else row.name
            await emit(kind, row, name, course_uuid, course_name, extra)
    return out


# Search kind -> the token rights bucket and plan feature list_usergroups and
# list_roles answer to.
_PEOPLE_KINDS = {"usergroup": "usergroups", "role": "roles"}


async def _people_kinds(ctx: ToolContext, wanted: set[str]) -> set[str]:
    """The people kinds this caller may search: admin connections of staff,
    or API tokens holding that bucket's read right, and only while the plan
    feature is on (as for the list tools)."""
    kinds = wanted & set(_PEOPLE_KINDS)
    if not kinds or not ctx.can_admin:
        return set()
    if isinstance(ctx.user, APITokenUser):
        kinds = {
            k for k in kinds
            if _token_bucket_allows(ctx.user.rights, _PEOPLE_KINDS[k], AccessAction.READ)
        }
    elif not await _is_staff(ctx):
        return set()
    if kinds:
        config = await _org_config(ctx)
        kinds = {k for k in kinds if resolve_feature(_PEOPLE_KINDS[k], config, ctx.org.id)["enabled"]}
    return kinds


async def _people_admin(ctx: ToolContext, p: SearchParams, wanted: set[str]) -> list[dict]:
    """Usergroups and roles, for callers _people_kinds lets through."""
    wanted = await _people_kinds(ctx, wanted)
    if not wanted:
        return []
    from src.db.roles import Role
    from src.db.usergroups import UserGroup

    pattern = _like(p.query)
    out: list[dict] = []
    if "usergroup" in wanted:
        rows = (await ctx.db_session.execute(
            select(UserGroup).where(UserGroup.org_id == ctx.org.id, UserGroup.name.ilike(pattern)).limit(p.limit)
        )).scalars().all()
        out += [refs.ref("usergroup", g.usergroup_uuid, g.name) for g in rows]
    if "role" in wanted:
        rows = (await ctx.db_session.execute(
            select(Role).where(
                (Role.org_id == ctx.org.id) | (Role.org_id.is_(None)), Role.name.ilike(pattern)
            ).limit(p.limit)
        )).scalars().all()
        out += [refs.ref("role", r.role_uuid, r.name) for r in rows]
    return out


async def _passages(ctx: ToolContext, p: SearchParams) -> tuple[list[dict] | None, str | None]:
    """Ranked content passages, or (None, why) when there is no usable index."""
    from src.routers.ai.rag import _open_rag  # noqa: PLC0415 (heavy import, lazy)
    from src.security.features_utils.usage import refund_ai_credit, reserve_ai_credit
    from src.services.ai.rag.query_service import search_course_content, source_from_row

    try:
        org_id, scope = await _open_rag(ctx.request, ctx.user, p.course_uuid, ctx.org.slug, ctx.db_session)
    except HTTPException as e:
        if e.status_code in (402, 403, 429):
            return None, str(e.detail)
        raise
    if not scope.course_ids:
        return [], None
    # One embedding call for the query, charged like the copilot search.
    await reserve_ai_credit(org_id, ctx.db_session, amount=1)
    try:
        rows = await search_course_content(p.query, org_id, ctx.db_session, scope, top_k=min(p.limit, 8))
    except Exception:
        refund_ai_credit(org_id, 1)
        raise
    passages = []
    for row in rows:
        src = source_from_row(row).to_dict()
        src["text"] = clip(src.get("text") or src.get("content"), 600)
        src.pop("content", None)
        passages.append(src)
    return passages, None


def _verdict(query: str, matches: list[dict]) -> dict:
    for m in matches:
        m["score"] = round(_score(query, m.get("name") or ""), 2)
    ranked = sorted(matches, key=lambda m: m["score"], reverse=True)
    viable = [m for m in ranked if m["score"] >= _CANDIDATE_FLOOR]
    if not viable:
        return {"status": "not_found", "match": None, "matches": ranked}
    top = viable[0]
    runner_up = viable[1]["score"] if len(viable) > 1 else 0.0
    if top["score"] >= _RESOLVE_SCORE and top["score"] - runner_up >= _RESOLVE_MARGIN:
        return {"status": "resolved", "match": top, "matches": ranked}
    return {"status": "ambiguous", "match": None, "matches": ranked}


async def _search(ctx: ToolContext, p: SearchParams):
    from src.services.security.rate_limiting import check_search_rate_limit

    caller_id = resolve_acting_user_id(ctx.user)
    if caller_id:
        allowed, retry_after = check_search_rate_limit(caller_id)
        if not allowed:
            raise HTTPException(status_code=429, detail=f"Too many searches. Retry in {retry_after}s.")

    wanted = set(p.kinds or _ALL_KINDS)
    if p.course_uuid and not p.kinds:
        wanted = {"chapter", "activity", "assignment"}
    matches: list[dict] = []
    matches += await _from_org_search(ctx, p, wanted)
    matches += await _course_items(ctx, p, wanted)
    matches += await _people_admin(ctx, p, wanted)

    result = _verdict(p.query, matches)
    result["matches"] = result["matches"][: p.limit]
    result["query"] = p.query
    # The {id, title, url} list ChatGPT's research modes read; fetch opens any id.
    result["results"] = [
        {"id": m["uuid"], "title": m.get("name"), "url": m.get("url")}
        for m in result["matches"]
        if m.get("uuid")
    ]
    if p.in_content:
        passages, why = await _passages(ctx, p)
        result["passages"] = passages or []
        if why:
            result["note"] = f"Content search is not available: {why}"
    if any(m.get("kind") in ("discussion", "member") for m in result["matches"]):
        # Discussion titles and member names were written by members.
        untrusted(result, "matches", "results")
    return result


# Id parameters a caller may fill with a name instead ("the solar course"),
# in the order they are resolved: the course first, so a chapter or page
# named in the same call is looked for inside it.
NAMEABLE: tuple[tuple[str, str], ...] = (
    ("course_uuid", "course"),
    ("copy_from_course_uuid", "course"),
    ("chapter_uuid", "chapter"),
    ("to_chapter_uuid", "chapter"),
    ("activity_uuid", "activity"),
    ("assignment_uuid", "assignment"),
    ("community_uuid", "community"),
    ("discussion_uuid", "discussion"),
    ("folder_uuid", "folder"),
    ("parent_folder_uuid", "folder"),
    ("from_folder_uuid", "folder"),
    ("playground_uuid", "playground"),
    ("usergroup_uuid", "usergroup"),
    ("role_uuid", "role"),
    ("base_role_uuid", "role"),
    ("user_uuid", "member"),
    ("author_uuid", "member"),
)


# Words some id parameters take on purpose ("none" unlinks, "root" is the
# library root); never names to look up.
_SENTINELS = {"none", "root"}


def _looks_like_id(value: str) -> bool:
    value = value.strip()
    if refs.kind_of(value) or value.lower() in _SENTINELS:
        return True
    # Playgrounds made before prefixes have bare uuids.
    return len(value) == 36 and value.count("-") == 4 and " " not in value


async def resolve_names(ctx: ToolContext, fields: set[str], args: dict[str, Any]) -> tuple[dict[str, Any], dict[str, dict]]:
    """Swap names given in id parameters for the ids they mean.

    Looks only where search would: what the caller can see, drafts only for
    those who can edit them. One clear match is used; several, or none, is an
    error the agent can relay ("which one did you mean?"). Returns the new
    arguments and, per parameter, the ref it was resolved to."""
    out = dict(args)
    resolved: dict[str, dict] = {}
    for param, kind in NAMEABLE:
        value = out.get(param)
        if param not in fields or not isinstance(value, str) or not value.strip() or _looks_like_id(value):
            continue
        if kind == "member" and "@" in value:
            continue  # emails go to load_member, which only lets staff use them
        course = out.get("course_uuid") if kind in ("chapter", "activity", "assignment") else None
        query = SearchParams(
            query=value.strip()[:200].ljust(2),
            kinds=[kind],
            course_uuid=course if isinstance(course, str) and refs.kind_of(course) == "course" else None,
            limit=10,
        )
        matches = await _from_org_search(ctx, query, {kind})
        matches += await _course_items(ctx, query, {kind})
        matches += await _people_admin(ctx, query, {kind})
        verdict = _verdict(value, matches)
        label = "member" if kind == "member" else kind.replace("_", " ")
        if verdict["status"] == "resolved":
            match = verdict["match"]
            out[param] = match["uuid"]
            resolved[param] = {k: match[k] for k in ("kind", "uuid", "name", "url") if match.get(k) is not None}
            continue
        if verdict["status"] == "ambiguous":
            options = [m for m in verdict["matches"] if m["score"] >= _CANDIDATE_FLOOR][:5]
            listed = "; ".join(
                f'"{m.get("name")}" ({m["uuid"]}' + (f', in "{m["in"]["name"]}"' if m.get("in") else "") + ")"
                for m in options
            )
            raise HTTPException(
                status_code=409,
                detail=(
                    f'"{value}" could be more than one {label}: {listed}. Ask the user which one '
                    f"they mean, then pass its id as {param}."
                ),
            )
        if kind == "member":
            continue  # usernames and emails are looked up by the tool itself
        raise HTTPException(
            status_code=404,
            detail=(
                f'No {label} called "{value}" that you can see. Check the name with search, '
                f"or pass its id as {param}."
            ),
        )
    return out, resolved


SPECS: list[ToolSpec] = [
    ToolSpec(
        name="get_context",
        title="Get context",
        description=(
            "Start here. Returns the organization (name, plan, web address), who you act "
            "as and their role, what this connection may do (read, write or admin), which "
            "features are on, how much the organization holds, and how content is organized."
        ),
        params_model=GetContextParams,
        tier=ActionTier.READ,
        rights_bucket=None,
        access_action=AccessAction.READ,
        execute=_get_context,
        idempotent=True,
    ),
    ToolSpec(
        name="search",
        title="Search",
        description=(
            "Find anything by name: courses, chapters, activities, assignments, communities, "
            "discussions, folders, playgrounds, members, groups and roles. Returns ranked "
            "matches with ids and links, and a verdict: resolved (use match), ambiguous (ask "
            "the user to pick) or not_found. Set in_content to also find passages inside "
            "lessons, documents and transcripts. Open any result with fetch."
        ),
        params_model=SearchParams,
        tier=ActionTier.READ,
        rights_bucket=None,
        access_action=AccessAction.READ,
        execute=_search,
        idempotent=True,
    ),
]
