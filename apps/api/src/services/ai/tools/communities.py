"""Community tools: communities, discussions and comments.

Every target is loaded through `refs` (only from the connected organization)
before a service runs, and the services keep their own permission checks:
members post where they can read and their role lets them post, authors edit
and delete their own posts, moderators pin, lock and remove anything.
Discussions and comments are member-written, so results carrying them are
marked untrusted.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from fastapi import HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlmodel import select

from src.db.communities.communities import Community, CommunityCreate, CommunityUpdate
from src.db.communities.discussion_comments import DiscussionComment
from src.db.communities.discussions import Discussion, DiscussionUpdate
from src.db.courses.courses import Course
from src.db.users import APITokenUser, User
from src.security.api_token_utils import require_token_content_read
from src.security.auth import resolve_acting_user_id
from src.security.rbac import AccessAction, check_resource_access
from src.security.superadmin import is_user_superadmin
from src.services.ai.tools import refs, results
from src.services.ai.tools.base import ActionTier, ToolContext, ToolSpec, require_approval
from src.services.ai.tools.results import Paging
from src.services.communities.comments import create_comment, delete_comment
from src.services.communities.communities import (
    accessible_community_ids_select,
    can_read_all_communities,
    create_community,
    delete_community,
    get_community,
    link_community_to_course,
    unlink_community_from_course,
    update_community,
)
from src.services.communities.discussions import (
    _can_moderate,
    calculate_hot_score,
    create_discussion,
    delete_discussion,
    get_discussion,
    lock_discussion,
    pin_discussion,
    update_discussion,
)

DiscussionLabel = Literal["general", "question", "idea", "announcement", "showcase"]

DISCUSSION_BODY_MAX = 20000
COMMENT_BODY_MAX = 10000
DISCUSSION_BODY_DETAIL = 4000
# "hot" ranks in Python; bound how many recent threads it considers.
HOT_WINDOW = 500


# ─── helpers ─────────────────────────────────────────────────────────────────


async def _readable(awaitable):
    """Await a service call, turning structured error details (moderation
    blocks, edit limits) into a plain sentence."""
    try:
        return await awaitable
    except HTTPException as e:
        if isinstance(e.detail, dict):
            message = e.detail.get("message") or e.detail.get("detail") or "Request refused."
            raise HTTPException(status_code=e.status_code, detail=str(message)) from None
        raise


def _iso(value: Any) -> str | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value)).isoformat()
    except ValueError:
        return str(value)


async def _community_url(ctx: ToolContext, community: Community) -> str | None:
    return await refs.web_url(ctx, "community", community=community.community_uuid)


async def _community_ref(ctx: ToolContext, community: Community, **extra) -> dict:
    return refs.ref(
        "community",
        community.community_uuid,
        community.name,
        await _community_url(ctx, community),
        **extra,
    )


async def _discussion_ref(ctx: ToolContext, discussion: Discussion, parent: Community, **extra) -> dict:
    url = await refs.web_url(
        ctx,
        "discussion",
        community=parent.community_uuid,
        discussion=discussion.discussion_uuid,
    )
    return refs.ref("discussion", discussion.discussion_uuid, refs.label("discussion", discussion), url, **extra)


async def _course_refs(ctx: ToolContext, course_ids: set[int]) -> dict[int, dict]:
    ids = {i for i in course_ids if i}
    if not ids:
        return {}
    rows = (
        await ctx.db_session.execute(select(Course).where(Course.id.in_(ids)))
    ).scalars().all()
    out = {}
    for course in rows:
        out[course.id] = refs.ref(
            "course",
            course.course_uuid,
            course.name,
            await refs.web_url(ctx, "course", course=course.course_uuid),
        )
    return out


async def _author_refs(ctx: ToolContext, user_ids: set[int]) -> dict[int, dict]:
    ids = {i for i in user_ids if i}
    if not ids:
        return {}
    rows = (await ctx.db_session.execute(select(User).where(User.id.in_(ids)))).scalars().all()
    # Username only: the matching HTTP routes never show authors' emails.
    return {u.id: refs.ref("user", u.user_uuid, u.username) for u in rows}


async def _comment_counts(ctx: ToolContext, discussion_ids: list[int]) -> dict[int, int]:
    if not discussion_ids:
        return {}
    rows = (
        await ctx.db_session.execute(
            select(DiscussionComment.discussion_id, func.count(DiscussionComment.id))
            .where(DiscussionComment.discussion_id.in_(discussion_ids))
            .group_by(DiscussionComment.discussion_id)
        )
    ).all()
    return {row[0]: row[1] for row in rows}


async def _visible_community_ids(ctx: ToolContext):
    """The ids of this org's communities the caller can read, as a subquery.

    Same rules as the communities listing route: tokens by their own rights,
    community managers and admins see all, members see public, org-wide and
    their usergroups' communities."""
    everything = select(Community.id).where(Community.org_id == ctx.org.id)
    if isinstance(ctx.user, APITokenUser):
        require_token_content_read(ctx.user, "communities")
        return everything
    user_id = resolve_acting_user_id(ctx.user)
    if await is_user_superadmin(user_id, ctx.db_session) or await can_read_all_communities(
        ctx.request, ctx.org, user_id, ctx.db_session
    ):
        return everything
    return accessible_community_ids_select(ctx.org.id, user_id)


async def _discussion_items(ctx: ToolContext, discussions: list[Discussion]) -> list[dict]:
    """Compact discussion refs for lists (body clipped, author by name)."""
    if not discussions:
        return []
    community_ids = {d.community_id for d in discussions}
    communities = {
        c.id: c
        for c in (
            await ctx.db_session.execute(select(Community).where(Community.id.in_(community_ids)))
        ).scalars().all()
    }
    authors = await _author_refs(ctx, {d.author_id for d in discussions})
    counts = await _comment_counts(ctx, [d.id for d in discussions])
    items = []
    for d in discussions:
        community = communities.get(d.community_id)
        if community is None:
            continue
        items.append(
            await _discussion_ref(
                ctx,
                d,
                community,
                community=refs.ref("community", community.community_uuid, community.name),
                label=d.label,
                author=authors.get(d.author_id),
                comments=counts.get(d.id, 0),
                upvotes=d.upvote_count,
                pinned=bool(d.is_pinned),
                locked=bool(d.is_locked),
                created_at=_iso(d.creation_date),
                body=results.clip(d.content or "", results.LIST_TEXT),
            )
        )
    return items


async def _community_of(ctx: ToolContext, discussion: Discussion) -> Community:
    community = await ctx.db_session.get(Community, discussion.community_id)
    if community is None:
        raise refs.not_found("community", str(discussion.community_id))
    return community


async def _require_course_free(ctx: ToolContext, course: Course, community: Community | None) -> None:
    """A course has at most one community; say so before changing anything."""
    statement = select(Community.id).where(Community.course_id == course.id)
    if community is not None:
        statement = statement.where(Community.id != community.id)
    if (await ctx.db_session.execute(statement)).first() is not None:
        raise HTTPException(
            status_code=400,
            detail=f"Course '{course.course_uuid}' already has a linked community. Unlink it there first.",
        )


# ─── params ──────────────────────────────────────────────────────────────────


class ListCommunitiesParams(Paging):
    pass


class GetCommunityParams(BaseModel):
    community_uuid: str = Field(..., max_length=100, description="The community, e.g. community_...")


class CreateCommunityParams(BaseModel):
    name: str = Field(..., min_length=1, max_length=200, description="Community name.")
    description: str | None = Field(None, max_length=5000, description="Short description shown on the community page.")
    public: bool = Field(
        False,
        description="True lets anyone, even signed-out visitors, read it. Private communities are for members.",
    )
    course_uuid: str | None = Field(
        None, max_length=100, description="Course to link the community to (a course has at most one)."
    )


class UpdateCommunityParams(BaseModel):
    community_uuid: str = Field(..., max_length=100, description="The community to change.")
    name: str | None = Field(None, min_length=1, max_length=200, description="New name.")
    description: str | None = Field(None, max_length=5000, description="New description.")
    public: bool | None = Field(None, description="True opens it to everyone, false limits it to members.")
    course_uuid: str | None = Field(
        None,
        max_length=100,
        description='Course to link (course_...), or "none" to unlink the current course.',
    )
    moderation_words: list[str] | None = Field(
        None,
        max_length=200,
        description="Words blocked in posts and comments; replaces the whole list ([] clears it).",
    )


class DeleteCommunityParams(BaseModel):
    community_uuid: str = Field(..., max_length=100, description="The community to delete.")


class ListDiscussionsParams(Paging):
    community_uuid: str | None = Field(
        None, max_length=100, description="Limit to one community; omit for every community you can read."
    )
    label: DiscussionLabel | None = Field(None, description="Only discussions with this label.")
    pinned: bool | None = Field(None, description="Only pinned (true) or unpinned (false) discussions.")
    locked: bool | None = Field(None, description="Only locked (true) or open (false) discussions.")
    author_uuid: str | None = Field(
        None, max_length=200, description="Only posts by this member (user_uuid, username or email)."
    )
    sort: Literal["recent", "top", "hot"] = Field(
        "recent", description="recent = newest first, top = most upvoted, hot = upvotes weighted by age."
    )


class GetDiscussionParams(Paging):
    discussion_uuid: str = Field(..., max_length=100, description="The discussion, e.g. discussion_...")


class CreateDiscussionParams(BaseModel):
    community_uuid: str = Field(..., max_length=100, description="Community to post in.")
    title: str = Field(..., min_length=1, max_length=300, description="Thread title.")
    body: str = Field(..., min_length=1, max_length=DISCUSSION_BODY_MAX, description="Thread body (plain text).")
    label: DiscussionLabel = Field("general", description="Thread category.")


class UpdateDiscussionParams(BaseModel):
    discussion_uuid: str = Field(..., max_length=100, description="The discussion to change.")
    title: str | None = Field(None, min_length=1, max_length=300, description="New title.")
    body: str | None = Field(None, min_length=1, max_length=DISCUSSION_BODY_MAX, description="New body.")
    label: DiscussionLabel | None = Field(None, description="New label.")
    pinned: bool | None = Field(None, description="Pin (true) or unpin (false). Moderators only.")
    locked: bool | None = Field(None, description="Lock (true) or reopen (false) replies. Moderators only.")


class DeleteDiscussionParams(BaseModel):
    discussion_uuid: str = Field(..., max_length=100, description="The discussion to delete.")


class CreateCommentParams(BaseModel):
    discussion_uuid: str = Field(..., max_length=100, description="Discussion to reply to.")
    body: str = Field(..., min_length=1, max_length=COMMENT_BODY_MAX, description="Comment text.")


class DeleteCommentParams(BaseModel):
    comment_uuid: str = Field(..., max_length=100, description="The comment to delete, e.g. comment_...")


# ─── communities ─────────────────────────────────────────────────────────────


async def _list_communities(ctx: ToolContext, p: ListCommunitiesParams):
    offset = results.offset_of(p.cursor)
    visible = await _visible_community_ids(ctx)
    total = (
        await ctx.db_session.execute(select(func.count()).select_from(Community).where(Community.id.in_(visible)))
    ).scalar() or 0
    rows = (
        await ctx.db_session.execute(
            select(Community)
            .where(Community.id.in_(visible))
            .order_by(Community.creation_date.desc(), Community.id.desc())
            .offset(offset)
            .limit(p.limit)
        )
    ).scalars().all()
    courses = await _course_refs(ctx, {c.course_id for c in rows})
    counts: dict[int, int] = {}
    if rows:
        counts = {
            row[0]: row[1]
            for row in (
                await ctx.db_session.execute(
                    select(Discussion.community_id, func.count(Discussion.id))
                    .where(Discussion.community_id.in_([c.id for c in rows]))
                    .group_by(Discussion.community_id)
                )
            ).all()
        }
    items = [
        await _community_ref(
            ctx,
            c,
            public=bool(c.public),
            description=results.clip(c.description or "", results.LIST_TEXT) or None,
            course=courses.get(c.course_id),
            discussions=counts.get(c.id, 0),
        )
        for c in rows
    ]
    return results.page(items, offset=offset, limit=p.limit, total=total)


async def _get_community(ctx: ToolContext, p: GetCommunityParams):
    row = await refs.load(ctx, "community", p.community_uuid)
    # The service checks read access and decides who sees the word list.
    community = await get_community(ctx.request, row.community_uuid, ctx.user, ctx.db_session)
    courses = await _course_refs(ctx, {row.course_id})
    recent = (
        await ctx.db_session.execute(
            select(Discussion)
            .where(Discussion.community_id == row.id)
            .order_by(Discussion.creation_date.desc(), Discussion.id.desc())
            .limit(5)
        )
    ).scalars().all()
    total = (
        await ctx.db_session.execute(
            select(func.count()).select_from(Discussion).where(Discussion.community_id == row.id)
        )
    ).scalar() or 0
    out: dict[str, Any] = {
        "community": await _community_ref(ctx, row),
        "description": community.description or "",
        "public": bool(community.public),
        "course": courses.get(row.course_id),
        "created_at": _iso(community.creation_date),
        "updated_at": _iso(community.update_date),
        "discussions": total,
        "recent_discussions": [
            {k: v for k, v in item.items() if k not in ("community", "body")}
            for item in await _discussion_items(ctx, list(recent))
        ],
    }
    if community.moderation_words:
        out["moderation_words"] = list(community.moderation_words)[:200]
    results.clip_field(out, "description")
    return results.untrusted(out)


async def _create_community(ctx: ToolContext, p: CreateCommunityParams):
    course = await refs.load(ctx, "course", p.course_uuid) if p.course_uuid else None
    if course is not None:
        await _require_course_free(ctx, course, None)
    created = await create_community(
        ctx.request,
        ctx.org.id,
        CommunityCreate(
            name=p.name,
            description=p.description or "",
            public=p.public,
            org_id=ctx.org.id,
            course_id=course.id if course else None,
        ),
        ctx.user,
        ctx.db_session,
    )
    row = await refs.load(ctx, "community", created.community_uuid)
    courses = await _course_refs(ctx, {row.course_id})
    return results.changed(
        f'Created {"public" if p.public else "private"} community "{row.name}".',
        community=await _community_ref(ctx, row),
        course=courses.get(row.course_id),
    )


async def _update_community(ctx: ToolContext, p: UpdateCommunityParams):
    row = await refs.load(ctx, "community", p.community_uuid)
    unlink = p.course_uuid is not None and p.course_uuid.strip().lower() == "none"
    course = None
    if p.course_uuid is not None and not unlink:
        course = await refs.load(ctx, "course", p.course_uuid)
        await _require_course_free(ctx, course, row)

    words = None
    if p.moderation_words is not None:
        words = [w.strip()[:100] for w in p.moderation_words if w and w.strip()]
    patch = {
        k: v
        for k, v in {
            "name": p.name,
            "description": p.description,
            "public": p.public,
            "moderation_words": words,
        }.items()
        if v is not None
    }
    if not patch and p.course_uuid is None:
        raise HTTPException(status_code=400, detail="Nothing to change: pass at least one field.")

    changed_fields = list(patch)
    if patch:
        await update_community(
            ctx.request, row.community_uuid, CommunityUpdate(**patch), ctx.user, ctx.db_session
        )
    if unlink:
        await unlink_community_from_course(ctx.request, row.community_uuid, ctx.user, ctx.db_session)
        changed_fields.append("course")
    elif course is not None:
        await link_community_to_course(
            ctx.request, row.community_uuid, course.course_uuid, ctx.user, ctx.db_session
        )
        changed_fields.append("course")

    await ctx.db_session.refresh(row)
    courses = await _course_refs(ctx, {row.course_id})
    return results.changed(
        f'Updated community "{row.name}" ({", ".join(changed_fields)}).',
        community=await _community_ref(ctx, row, public=bool(row.public)),
        course=courses.get(row.course_id),
    )


async def _delete_community(ctx: ToolContext, p: DeleteCommunityParams):
    row = await refs.load(ctx, "community", p.community_uuid)
    name = row.name
    await delete_community(ctx.request, row.community_uuid, ctx.user, ctx.db_session)
    return results.changed(
        f'Deleted community "{name}" and all its discussions.',
        community=refs.ref("community", p.community_uuid, name),
    )


# ─── discussions ─────────────────────────────────────────────────────────────


async def _list_discussions(ctx: ToolContext, p: ListDiscussionsParams):
    offset = results.offset_of(p.cursor)
    conditions = []
    if p.community_uuid:
        community = await refs.load(ctx, "community", p.community_uuid)
        await check_resource_access(
            ctx.request, ctx.db_session, ctx.user, community.community_uuid, AccessAction.READ
        )
        conditions.append(Discussion.community_id == community.id)
    else:
        conditions.append(Discussion.community_id.in_(await _visible_community_ids(ctx)))
    if p.label:
        conditions.append(Discussion.label == p.label)
    if p.pinned is not None:
        conditions.append(Discussion.is_pinned == p.pinned)
    if p.locked is not None:
        conditions.append(Discussion.is_locked == p.locked)
    if p.author_uuid:
        author = await refs.load_member(ctx, p.author_uuid)
        conditions.append(Discussion.author_id == author.id)

    total = (
        await ctx.db_session.execute(select(func.count()).select_from(Discussion).where(*conditions))
    ).scalar() or 0
    # Within one community pinned threads lead, as on the community page.
    lead = [Discussion.is_pinned.desc()] if p.community_uuid else []
    if p.sort == "hot":
        window = (
            await ctx.db_session.execute(
                select(Discussion)
                .where(*conditions)
                .order_by(Discussion.creation_date.desc())
                .limit(HOT_WINDOW)
            )
        ).scalars().all()
        ranked = sorted(
            window,
            key=lambda d: (
                bool(d.is_pinned) if p.community_uuid else False,
                calculate_hot_score(d.upvote_count, d.creation_date),
            ),
            reverse=True,
        )
        total = min(total, len(window))
        rows = ranked[offset : offset + p.limit]
    else:
        order = (
            [Discussion.upvote_count.desc(), Discussion.creation_date.desc()]
            if p.sort == "top"
            else [Discussion.creation_date.desc()]
        )
        rows = (
            await ctx.db_session.execute(
                select(Discussion)
                .where(*conditions)
                .order_by(*lead, *order, Discussion.id.desc())
                .offset(offset)
                .limit(p.limit)
            )
        ).scalars().all()
    items = await _discussion_items(ctx, list(rows))
    return results.untrusted(results.page(items, offset=offset, limit=p.limit, total=total))


async def _get_discussion(ctx: ToolContext, p: GetDiscussionParams):
    row = await refs.load(ctx, "discussion", p.discussion_uuid)
    # The service checks the caller can read the community.
    discussion = await get_discussion(ctx.request, row.discussion_uuid, ctx.user, ctx.db_session)
    community = await _community_of(ctx, row)

    offset = results.offset_of(p.cursor)
    total = (
        await ctx.db_session.execute(
            select(func.count()).select_from(DiscussionComment).where(DiscussionComment.discussion_id == row.id)
        )
    ).scalar() or 0
    comments = (
        await ctx.db_session.execute(
            select(DiscussionComment)
            .where(DiscussionComment.discussion_id == row.id)
            .order_by(DiscussionComment.creation_date.asc(), DiscussionComment.id.asc())
            .offset(offset)
            .limit(p.limit)
        )
    ).scalars().all()
    authors = await _author_refs(ctx, {row.author_id} | {c.author_id for c in comments})
    comment_items = []
    for c in comments:
        item = {
            "comment": refs.ref("comment", c.comment_uuid),
            "author": authors.get(c.author_id),
            "body": c.content or "",
            "upvotes": c.upvote_count,
            "created_at": _iso(c.creation_date),
        }
        results.clip_field(item, "body")
        comment_items.append(item)

    out: dict[str, Any] = {
        "discussion": await _discussion_ref(ctx, row, community),
        "community": await _community_ref(ctx, community),
        "label": discussion.label,
        "author": authors.get(row.author_id),
        "body": discussion.content or "",
        "upvotes": discussion.upvote_count,
        "pinned": bool(discussion.is_pinned),
        "locked": bool(discussion.is_locked),
        "edited": bool(discussion.edit_count),
        "created_at": _iso(discussion.creation_date),
        "updated_at": _iso(discussion.update_date),
        "comments": results.page(comment_items, offset=offset, limit=p.limit, total=total),
    }
    results.clip_field(out, "body", DISCUSSION_BODY_DETAIL)
    return results.untrusted(out)


async def _create_discussion(ctx: ToolContext, p: CreateDiscussionParams):
    community = await refs.load(ctx, "community", p.community_uuid)
    created = await _readable(
        create_discussion(
            ctx.request,
            community.community_uuid,
            p.title,
            p.body,
            p.label,
            ctx.user,
            ctx.db_session,
        )
    )
    row = await refs.load(ctx, "discussion", created.discussion_uuid)
    return results.changed(
        f'Posted "{results.clip(p.title, 120)}" in {community.name}.',
        discussion=await _discussion_ref(ctx, row, community),
        community=refs.ref("community", community.community_uuid, community.name),
    )


async def _update_discussion(ctx: ToolContext, p: UpdateDiscussionParams):
    row = await refs.load(ctx, "discussion", p.discussion_uuid)
    community = await _community_of(ctx, row)
    edits = {
        k: v
        for k, v in {"title": p.title, "content": p.body, "label": p.label}.items()
        if v is not None
    }
    if not edits and p.pinned is None and p.locked is None:
        raise HTTPException(status_code=400, detail="Nothing to change: pass title, body, label, pinned or locked.")
    # Pinning and locking are for moderators; check before any edit lands so
    # a refused pin never leaves a half-applied change.
    acting_user_id = resolve_acting_user_id(ctx.user)
    if edits and row.author_id != acting_user_id:
        # A moderator rewriting someone else's post: it still shows under
        # their name, so a person has to agree to it.
        require_approval(ctx, "Editing a post written by someone else needs the user's approval.", person=True)
    if p.pinned is not None or p.locked is not None:
        if not await _can_moderate(
            ctx.request, ctx.user, acting_user_id, AccessAction.UPDATE, community, ctx.db_session
        ):
            raise HTTPException(
                status_code=403, detail="Only community moderators can pin or lock discussions."
            )

    done = []
    if edits:
        await _readable(
            update_discussion(
                ctx.request, row.discussion_uuid, DiscussionUpdate(**edits), ctx.user, ctx.db_session
            )
        )
        done += ["body" if k == "content" else k for k in edits]
    if p.pinned is not None:
        await _readable(pin_discussion(ctx.request, row.discussion_uuid, p.pinned, ctx.user, ctx.db_session))
        done.append("pinned" if p.pinned else "unpinned")
    if p.locked is not None:
        await _readable(lock_discussion(ctx.request, row.discussion_uuid, p.locked, ctx.user, ctx.db_session))
        done.append("locked" if p.locked else "unlocked")

    await ctx.db_session.refresh(row)
    return results.changed(
        f'Updated discussion "{results.clip(row.title, 120)}" ({", ".join(done)}).',
        discussion=await _discussion_ref(ctx, row, community, pinned=bool(row.is_pinned), locked=bool(row.is_locked)),
    )


async def _delete_discussion(ctx: ToolContext, p: DeleteDiscussionParams):
    row = await refs.load(ctx, "discussion", p.discussion_uuid)
    title = row.title
    await _readable(delete_discussion(ctx.request, row.discussion_uuid, ctx.user, ctx.db_session))
    return results.changed(
        f'Deleted discussion "{results.clip(title, 120)}" and its comments.',
        discussion=refs.ref("discussion", p.discussion_uuid, results.clip(title, 120)),
    )


async def _create_comment(ctx: ToolContext, p: CreateCommentParams):
    row = await refs.load(ctx, "discussion", p.discussion_uuid)
    community = await _community_of(ctx, row)
    created = await _readable(
        create_comment(ctx.request, row.discussion_uuid, p.body, ctx.user, ctx.db_session)
    )
    # The body is not echoed back: the caller just wrote it.
    return results.changed(
        f'Commented on "{results.clip(row.title, 120)}".',
        comment=refs.ref("comment", created.comment_uuid),
        discussion=await _discussion_ref(ctx, row, community),
    )


async def _delete_comment(ctx: ToolContext, p: DeleteCommentParams):
    row = await refs.load(ctx, "comment", p.comment_uuid)
    discussion = await ctx.db_session.get(Discussion, row.discussion_id)
    await _readable(delete_comment(ctx.request, row.comment_uuid, ctx.user, ctx.db_session))
    return results.changed(
        "Deleted the comment.",
        comment=refs.ref("comment", p.comment_uuid),
        discussion=(
            refs.ref("discussion", discussion.discussion_uuid, results.clip(discussion.title, 120))
            if discussion
            else None
        ),
    )


# ─── specs ───────────────────────────────────────────────────────────────────

SPECS: list[ToolSpec] = [
    ToolSpec(
        name="list_communities",
        description=(
            "List the communities you can read, newest first: name, link, public flag, linked "
            "course, discussion count and a clipped description. Paged."
        ),
        params_model=ListCommunitiesParams,
        tier=ActionTier.READ,
        rights_bucket="communities",
        access_action=AccessAction.READ,
        execute=_list_communities,
        title="List communities",
    ),
    ToolSpec(
        name="get_community",
        description=(
            "One community: description, visibility, linked course, discussion count and its 5 "
            "newest discussions. Moderators also get the blocked-words list."
        ),
        params_model=GetCommunityParams,
        tier=ActionTier.READ,
        rights_bucket="communities",
        access_action=AccessAction.READ,
        execute=_get_community,
        target_param="community_uuid",
        target_kind="community",
        title="Get community",
    ),
    ToolSpec(
        name="create_community",
        description=(
            "Create a community, private by default, optionally linked to a course (one community "
            "per course). A public community or a course link needs approval. Returns the new community."
        ),
        params_model=CreateCommunityParams,
        tier=ActionTier.CREATE,
        rights_bucket="communities",
        access_action=AccessAction.CREATE,
        execute=_create_community,
        target_kind="community",
        approval_if=lambda p: p.public or p.course_uuid is not None,
        summarize=lambda p: f'Create {"public" if p.public else "private"} community "{p.name}"'
        + (f" linked to course {p.course_uuid}" if p.course_uuid else ""),
        title="Create community",
    ),
    ToolSpec(
        name="update_community",
        description=(
            'Change a community: name, description, visibility, blocked words, or its course link '
            '(course_uuid, or "none" to unlink). Send only what changes. Visibility and course link '
            "changes need approval."
        ),
        params_model=UpdateCommunityParams,
        tier=ActionTier.EDIT,
        rights_bucket="communities",
        access_action=AccessAction.UPDATE,
        execute=_update_community,
        target_param="community_uuid",
        target_kind="community",
        approval_if=lambda p: p.public is not None or p.course_uuid is not None,
        idempotent=True,
        summarize=lambda p: "Update community: "
        + ", ".join(p.model_dump(exclude={"community_uuid"}, exclude_none=True) or ["nothing"]),
        title="Update community",
    ),
    ToolSpec(
        name="delete_community",
        description="Permanently delete a community with all its discussions and comments.",
        params_model=DeleteCommunityParams,
        tier=ActionTier.DESTRUCTIVE,
        rights_bucket="communities",
        access_action=AccessAction.DELETE,
        execute=_delete_community,
        target_param="community_uuid",
        target_kind="community",
        summarize=lambda p: f"Delete community {p.community_uuid} and all its discussions",
        title="Delete community",
    ),
    ToolSpec(
        name="list_discussions",
        description=(
            "List discussions in one community, or across every community you can read. Filter by "
            "label, pinned, locked or author; sort recent, top or hot. Items carry link, author, "
            "comment count and a clipped body. Paged."
        ),
        params_model=ListDiscussionsParams,
        tier=ActionTier.READ,
        rights_bucket="discussions",
        access_action=AccessAction.READ,
        execute=_list_discussions,
        target_param="community_uuid",
        target_kind="community",
        title="List discussions",
    ),
    ToolSpec(
        name="get_discussion",
        description=(
            "Read one discussion: full body (up to 4000 chars), author, label, pinned and locked "
            "state, then its comments oldest first, paged with limit and cursor."
        ),
        params_model=GetDiscussionParams,
        tier=ActionTier.READ,
        rights_bucket="discussions",
        access_action=AccessAction.READ,
        execute=_get_discussion,
        target_param="discussion_uuid",
        target_kind="discussion",
        title="Get discussion",
    ),
    ToolSpec(
        name="create_discussion",
        description=(
            "Start a discussion thread in a community you can read, as yourself. The community's "
            "moderation rules (blocked words, slow mode, daily caps) apply. Returns the new thread."
        ),
        params_model=CreateDiscussionParams,
        tier=ActionTier.CREATE,
        rights_bucket="discussions",
        access_action=AccessAction.CREATE,
        target_access=AccessAction.READ,
        execute=_create_discussion,
        target_param="community_uuid",
        target_kind="community",
        summarize=lambda p: f'Post discussion "{p.title}"',
        title="Create discussion",
    ),
    ToolSpec(
        name="update_discussion",
        description=(
            "Edit a discussion's title, body or label (authors: own posts, at most 2 edits; "
            "moderators: any) or pin or lock it (moderators only). Send only what changes."
        ),
        params_model=UpdateDiscussionParams,
        tier=ActionTier.EDIT,
        rights_bucket="discussions",
        access_action=AccessAction.UPDATE,
        target_access=AccessAction.READ,
        execute=_update_discussion,
        target_param="discussion_uuid",
        target_kind="discussion",
        idempotent=True,
        summarize=lambda p: "Update discussion: "
        + ", ".join(p.model_dump(exclude={"discussion_uuid"}, exclude_none=True) or ["nothing"]),
        title="Update discussion",
        approval_in_call=True,
    ),
    ToolSpec(
        name="delete_discussion",
        description="Permanently delete a discussion and its comments. Allowed for its author and moderators.",
        params_model=DeleteDiscussionParams,
        tier=ActionTier.DESTRUCTIVE,
        rights_bucket="discussions",
        access_action=AccessAction.DELETE,
        target_access=AccessAction.READ,
        execute=_delete_discussion,
        target_param="discussion_uuid",
        target_kind="discussion",
        summarize=lambda p: f"Delete discussion {p.discussion_uuid} and its comments",
        title="Delete discussion",
    ),
    ToolSpec(
        name="create_comment",
        description=(
            "Reply to a discussion as yourself (up to 10000 chars). Fails on locked threads and "
            "when the community's moderation rules block it. Returns the new comment's id."
        ),
        params_model=CreateCommentParams,
        tier=ActionTier.CREATE,
        rights_bucket="discussions",
        access_action=AccessAction.CREATE,
        target_access=AccessAction.READ,
        execute=_create_comment,
        target_param="discussion_uuid",
        target_kind="discussion",
        summarize=lambda p: f"Comment on discussion {p.discussion_uuid}",
        title="Comment on discussion",
    ),
    ToolSpec(
        name="delete_comment",
        description="Permanently delete a comment. Allowed for its author and community moderators.",
        params_model=DeleteCommentParams,
        tier=ActionTier.DESTRUCTIVE,
        rights_bucket="discussions",
        access_action=AccessAction.DELETE,
        execute=_delete_comment,
        target_param="comment_uuid",
        target_kind="comment",
        summarize=lambda p: f"Delete comment {p.comment_uuid}",
        title="Delete comment",
    ),
]
