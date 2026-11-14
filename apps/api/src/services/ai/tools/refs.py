"""References to LearnHouse objects: org-scoped lookups, ids and links.

Tools only ever take and return prefixed uuids (``course_...``,
``chapter_...``, ``user_...``). Every target named in a call is loaded here
first, and only from the connected organization: an id from another
organization is "not found", even when the caller also belongs to that one.
The services still run their own permission checks afterwards; this layer
makes sure they only ever see this organization's rows.

`ref()` builds the small ``{kind, uuid, name, url}`` object every result uses
to point at something, and `web_url()` the link a person can open.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

from fastapi import HTTPException
from sqlmodel import select

from src.services.ai.tools.base import ToolContext

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class Kind:
    name: str            # "course"
    prefix: str          # "course_"
    model: str           # dotted path of the SQLModel table
    uuid_field: str      # column holding the uuid
    label_field: str     # column shown as the name
    org_scoped: bool = True  # has an org_id column


def _model(path: str):
    module, _, attr = path.rpartition(".")
    if module.startswith("ee."):
        # EE-owned kinds (playgrounds, boards) do not exist without EE: an id of one
        # is simply not in this organization.
        from src.core.ee_hooks import get_ee_module

        loaded = get_ee_module(module)
        if loaded is None:
            raise HTTPException(status_code=404, detail="That feature is not available on this installation.")
        return getattr(loaded, attr)
    return getattr(__import__(module, fromlist=[attr]), attr)


KINDS: dict[str, Kind] = {
    k.name: k
    for k in (
        Kind("course", "course_", "src.db.courses.courses.Course", "course_uuid", "name"),
        Kind("chapter", "chapter_", "src.db.courses.chapters.Chapter", "chapter_uuid", "name"),
        Kind("activity", "activity_", "src.db.courses.activities.Activity", "activity_uuid", "name"),
        Kind("assignment", "assignment_", "src.db.courses.assignments.Assignment", "assignment_uuid", "title"),
        Kind(
            "assignment_task",
            "assignmenttask_",
            "src.db.courses.assignments.AssignmentTask",
            "assignment_task_uuid",
            "title",
        ),
        Kind("usergroup", "usergroup_", "src.db.usergroups.UserGroup", "usergroup_uuid", "name"),
        Kind("role", "role_", "src.db.roles.Role", "role_uuid", "name"),
        Kind("community", "community_", "src.db.communities.communities.Community", "community_uuid", "name"),
        Kind("discussion", "discussion_", "src.db.communities.discussions.Discussion", "discussion_uuid", "title"),
        Kind(
            "comment",
            "comment_",
            "src.db.communities.discussion_comments.DiscussionComment",
            "comment_uuid",
            "content",
            org_scoped=False,
        ),
        Kind("folder", "folder_", "src.db.folders.folders.Folder", "folder_uuid", "name"),
        Kind("media", "media_", "src.db.media.media.Media", "media_uuid", "name"),
        Kind("board", "board_", "ee.db.boards.Board", "board_uuid", "name"),
        Kind("playground", "playground_", "ee.db.playgrounds.Playground", "playground_uuid", "name"),
        Kind("path", "path_", "src.db.paths.Path", "path_uuid", "name"),
        Kind("live_session", "livesession_", "ee.db.live_sessions.LiveSession", "live_session_uuid", "title"),
        Kind("scheduled_agent", "schedagent_", "ee.db.atlas_scheduled.AtlasScheduledAgent", "agent_uuid", "name"),
        Kind("user", "user_", "src.db.users.User", "user_uuid", "username", org_scoped=False),
    )
}


def kind_of(uuid: str | None) -> str | None:
    """The kind a prefixed uuid names, or None."""
    if not uuid or not isinstance(uuid, str):
        return None
    for kind in KINDS.values():
        if uuid.startswith(kind.prefix):
            return kind.name
    return None


def bare(uuid: str, kind: str) -> str:
    """The uuid without its prefix, as web paths use it."""
    prefix = KINDS[kind].prefix
    return uuid[len(prefix):] if uuid.startswith(prefix) else uuid


def not_found(kind: str, uuid: str) -> HTTPException:
    return HTTPException(
        status_code=404,
        detail=(
            f"No {kind.replace('_', ' ')} '{uuid}' in this organization. "
            "Look it up with search or a list tool."
        ),
    )


def _check_prefix(kind: str, uuid: str) -> None:
    prefix = KINDS[kind].prefix
    # Playgrounds made before prefixes existed have bare uuids.
    if kind == "playground":
        return
    if not isinstance(uuid, str) or not uuid.startswith(prefix):
        named = kind_of(uuid)
        hint = f" That looks like a {named} id." if named and named != kind else ""
        raise HTTPException(
            status_code=400,
            detail=f"Expected a {kind.replace('_', ' ')} id starting with '{prefix}', got '{uuid}'.{hint}",
        )


async def load(ctx: ToolContext, kind: str, uuid: str) -> Any:
    """The row for `uuid`, only if it belongs to the connected organization.

    Raises 400 for an id of the wrong kind and 404 for one that is missing or
    belongs elsewhere (the two look the same on purpose)."""
    _check_prefix(kind, uuid)
    spec = KINDS[kind]
    model = _model(spec.model)
    row = (
        await ctx.db_session.execute(
            select(model).where(getattr(model, spec.uuid_field) == uuid)
        )
    ).scalars().first()
    if row is None:
        raise not_found(kind, uuid)
    if not await _in_org(ctx, kind, row):
        raise not_found(kind, uuid)
    return row


async def _in_org(ctx: ToolContext, kind: str, row: Any) -> bool:
    spec = KINDS[kind]
    if spec.org_scoped:
        org_id = getattr(row, "org_id", None)
        # Global roles (admin, maintainer, ...) have no org and apply everywhere.
        if kind == "role" and org_id is None:
            return True
        return org_id == ctx.org.id
    if kind == "comment":
        from src.db.communities.discussions import Discussion

        discussion = await ctx.db_session.get(Discussion, row.discussion_id)
        return discussion is not None and discussion.org_id == ctx.org.id
    if kind == "user":
        return await is_member(ctx, row.id)
    return False


async def is_member(ctx: ToolContext, user_id: int) -> bool:
    from src.db.user_organizations import UserOrganization

    found = (
        await ctx.db_session.execute(
            select(UserOrganization.id).where(
                UserOrganization.user_id == user_id,
                UserOrganization.org_id == ctx.org.id,
            )
        )
    ).first()
    return found is not None


# The same refusal get_member gives: an answer to "is this address a member?"
# would tell anyone who belongs to the organization.
EMAIL_LOOKUP_DENIED = "Looking members up by email needs admin access. Use their username or user_uuid."


async def can_look_up_by_email(ctx: ToolContext) -> bool:
    """Admins and maintainers on a connection with admin access, as for
    get_member. API tokens resolve to the person who made them."""
    from src.security.auth import resolve_acting_user_id
    from src.security.org_auth import is_org_admin

    return ctx.can_admin and await is_org_admin(
        resolve_acting_user_id(ctx.user), ctx.org.id, ctx.db_session
    )


async def load_member(ctx: ToolContext, who: str) -> Any:
    """A member of the organization by user uuid, email or username.

    Emails resolve only for staff (can_look_up_by_email); anyone else is
    refused before the lookup, whether or not the address belongs here."""
    from sqlalchemy import func

    from src.db.users import User

    who = (who or "").strip()
    if not who:
        raise HTTPException(status_code=400, detail="Name a member by user_uuid, email or username.")
    if who.startswith("user_"):
        return await load(ctx, "user", who)
    if "@" in who and not await can_look_up_by_email(ctx):
        raise HTTPException(status_code=403, detail=EMAIL_LOOKUP_DENIED)
    column = User.email if "@" in who else User.username
    row = (
        await ctx.db_session.execute(select(User).where(func.lower(column) == who.lower()))
    ).scalars().first()
    if row is None or not await is_member(ctx, row.id):
        raise HTTPException(
            status_code=404,
            detail=f"No member '{who}' in this organization. Find people with list_members.",
        )
    return row


async def uuid_for(ctx: ToolContext, kind: str, row_id: int | None) -> str | None:
    """The uuid of a row known only by its numeric id (services return those)."""
    if row_id is None:
        return None
    spec = KINDS[kind]
    model = _model(spec.model)
    row = await ctx.db_session.get(model, row_id)
    return getattr(row, spec.uuid_field, None) if row is not None else None


# ─── links ───────────────────────────────────────────────────────────────────


async def web_base(ctx: ToolContext) -> str:
    """The organization's web address, memoized on the context."""
    cached = getattr(ctx, "_web_base", None)
    if cached is not None:
        return cached
    base = ""
    try:
        from src.services.email.utils import get_org_signup_base_url

        base = await get_org_signup_base_url(
            ctx.org.slug, request=None, db_session=ctx.db_session, org_id=ctx.org.id
        )
    except Exception:  # pragma: no cover - links are a convenience
        logger.exception("agent-tools: could not build the org base URL")
    if not base:
        base = _configured_frontend()
    base = (base or "").rstrip("/")
    object.__setattr__(ctx, "_web_base", base)
    return base


def _configured_frontend() -> str:
    """Last resort for local and single-org installs: the configured web host."""
    from config.config import get_learnhouse_config

    hosting = get_learnhouse_config().hosting_config
    domain = (hosting.frontend_domain or hosting.domain or "").strip().rstrip("/")
    if not domain:
        return ""
    return f"{'https' if hosting.ssl else 'http'}://{domain}"


_PATHS = {
    "course": "/course/{course}",
    "activity": "/course/{course}/activity/{activity}",
    "community": "/community/{community}",
    "discussion": "/community/{community}/discussion/{discussion}",
    "folder": "/library/folder/{folder}",
    "playground": "/playground/{playground}",
    "board": "/dash/boards/{board}/general",
    "path": "/path/{path}",
    "path_editor": "/dash/paths/path/{path}/general",
    "assignment": "/dash/assignments/{assignment}",
    "course_editor": "/dash/courses/course/{course}/content",
    "activity_editor": "/course/{course}/activity/{activity}/edit",
    "user": "/user/{username}",
    "usergroup": "/dash/users/settings/usergroups",
    "role": "/dash/users/settings/roles",
    "live_session": "/dash/live-sessions/session/{live_session}/general",
    # The full id: the Scheduled tab opens the agent from ?agent=.
    "scheduled_agent": "/dash/atlas?tab=scheduled&agent={agent}",
    "scheduled_agents": "/dash/atlas?tab=scheduled",
}


async def web_url(ctx: ToolContext, page: str, **ids: str | None) -> str | None:
    """A link a person can open, e.g. web_url(ctx, "course", course="course_x").

    Uuids may be passed with or without their prefix. None when any id is
    missing or the org has no known web address."""
    template = _PATHS.get(page)
    if template is None:
        return None
    values = {}
    for key, value in ids.items():
        if not value:
            return None
        values[key] = bare(value, key) if key in KINDS else value
    try:
        path = template.format(**values)
    except KeyError:
        return None
    base = await web_base(ctx)
    return f"{base}{path}" if base else None


def ref(kind: str, uuid: str | None, name: str | None = None, url: str | None = None, **extra) -> dict:
    """The standard pointer to an object in results."""
    out: dict[str, Any] = {"kind": kind, "uuid": uuid}
    if name is not None:
        out["name"] = name
    if url:
        out["url"] = url
    out.update({k: v for k, v in extra.items() if v is not None})
    return out


def label(kind: str, row: Any) -> str | None:
    value = getattr(row, KINDS[kind].label_field, None)
    if isinstance(value, str) and len(value) > 120:
        return value[:117] + "..."
    return value
