"""What a tool call acts on, named the way the user would say it.

A call only carries the tool's arguments (ids). Atlas's preview cards and the
approval prompts (Atlas and MCP) need the real kind and name: "Delete chapter
"Respiration"", not "Delete chapter_8f2c...". Lookups are scoped to the
caller's org so a stray id never reveals another org's names.
"""

from __future__ import annotations

from typing import Any

from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.services.ai.tools.refs import KINDS, _model, kind_of

# Most specific first: an activity edit also names its course, etc.
_ORDER = (
    "activity_uuid",
    "assignment_task_uuid",
    "assignment_uuid",
    "chapter_uuid",
    "comment_uuid",
    "discussion_uuid",
    "community_uuid",
    "board_uuid",
    "playground_uuid",
    "folder_uuid",
    "media_uuid",
    "usergroup_uuid",
    "role_uuid",
    "user_uuid",
    "course_uuid",
)
_COPY_ARGS = ("copy_from_course_uuid", "copy_from_board_uuid", "copy_from_playground_uuid")


def _kind_for_arg(arg: str, value: Any) -> str | None:
    if arg in ("member", "user_uuid"):
        return "user"
    by_value = kind_of(value) if isinstance(value, str) else None
    if by_value:
        return by_value
    stem = arg.removesuffix("_uuid").removeprefix("copy_from_")
    return stem if stem in KINDS else None


async def _lookup(kind: str, value: Any, org_id: int, db: AsyncSession) -> str | None:
    spec = KINDS.get(kind)
    if spec is None or not isinstance(value, str) or not value:
        return None
    model = _model(spec.model)
    try:
        if kind == "user":
            from src.db.user_organizations import UserOrganization
            from src.db.users import User

            column = User.user_uuid if value.startswith("user_") else (
                User.email if "@" in value else User.username
            )
            row = (
                await db.execute(
                    select(User)
                    .join(UserOrganization, UserOrganization.user_id == User.id)
                    .where(column == value, UserOrganization.org_id == org_id)
                )
            ).scalars().first()
            if row is None:
                return None
            full = " ".join(x for x in (row.first_name, row.last_name) if x)
            return full or row.username
        query = select(model).where(getattr(model, spec.uuid_field) == value)
        if spec.org_scoped:
            query = query.where(model.org_id == org_id) if kind != "role" else query.where(
                (model.org_id == org_id) | (model.org_id.is_(None))
            )
        row = (await db.execute(query)).scalars().first()
        if row is None:
            return None
        if kind == "comment":
            from src.db.communities.discussions import Discussion

            discussion = await db.get(Discussion, row.discussion_id)
            if discussion is None or discussion.org_id != org_id:
                return None
            text = row.content or ""
            return text[:60] + ("..." if len(text) > 60 else "")
        return getattr(row, spec.label_field, None)
    except Exception:  # display only: never fail a proposal on a lookup
        return None


def _created_kind(tool: str) -> str | None:
    if not tool.startswith("create_"):
        return None
    return tool.split("_", 1)[1].replace("_", " ")


async def describe_target(
    tool: str, args: dict[str, Any], target_param: str | None, org_id: int, db: AsyncSession
) -> dict[str, Any]:
    """{kind, uuid?, name?, parent?, source?, new_name?} for what the call changes."""
    new_name = args.get("name") or args.get("title")
    created = _created_kind(tool)

    subject_arg = target_param if target_param and args.get(target_param) else None
    if subject_arg is None:
        subject_arg = next((a for a in (*_ORDER, "member") if args.get(a) not in (None, "")), None)

    subject: dict[str, Any] | None = None
    if subject_arg is not None:
        value = args[subject_arg]
        kind = _kind_for_arg(subject_arg, value)
        if kind:
            subject = {
                "kind": kind.replace("_", " "),
                "uuid": str(value),
                "name": await _lookup(kind, value, org_id, db),
            }

    if created:
        target: dict[str, Any] = {"kind": created}
        if new_name:
            target["name"] = new_name
        # Creating inside something: name the container as the parent.
        if subject:
            target["parent"] = subject
        source_arg = next((a for a in _COPY_ARGS if args.get(a)), None)
        if source_arg:
            kind = _kind_for_arg(source_arg, args[source_arg])
            target["source"] = {
                "kind": kind,
                "uuid": args[source_arg],
                "name": await _lookup(kind, args[source_arg], org_id, db) if kind else None,
            }
        return target

    if subject is None:
        target = {"kind": tool.split("_", 1)[-1].replace("_", " ") if "_" in tool else "item"}
        if new_name:
            target["name"] = new_name
        return target

    target = {"kind": subject["kind"], "uuid": subject["uuid"]}
    if subject.get("name"):
        target["name"] = subject["name"]
    elif new_name:
        target["name"] = new_name
    if new_name and subject.get("name") and new_name != subject["name"]:
        # A rename: keep the new name visible too.
        target["new_name"] = new_name
    # Other ids the call names (the role being granted, the chapter moved
    # to), so an approval prompt shows what they are, not just ids.
    related: dict[str, str] = {}
    for arg in _ORDER:
        value = args.get(arg)
        if arg == subject_arg or not isinstance(value, str) or not value:
            continue
        kind = _kind_for_arg(arg, value)
        name = await _lookup(kind, value, org_id, db) if kind else None
        if name:
            related[value] = name
    if related:
        target["related"] = related
    return target
