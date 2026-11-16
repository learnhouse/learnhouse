"""Podcast tools: the organization's shows and their episodes.

Through the same services as the podcast pages and routes: the org's
podcasts feature switch and plan, the API-token ``podcasts`` rights, and who
may see unpublished shows and episodes (admins, maintainers and authors) all
apply as they do there. Podcast and episode ids are loaded from the connected
organization first. Audio and cover files are uploaded in the dashboard;
these tools manage the text, order and publishing. Publishing or making a
show public, and deleting, need approval.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field

from src.security.rbac import AccessAction
from src.services.ai.tools import refs, results
from src.services.ai.tools.base import ActionTier, ToolContext, ToolSpec
from fastapi import HTTPException
from sqlmodel import select

from src.db.podcasts.episodes import PodcastEpisode, PodcastEpisodeCreate, PodcastEpisodeUpdate
from src.db.podcasts.podcasts import Podcast, PodcastCreate, PodcastUpdate
from src.services.ai.tools.results import Paging
from src.services.podcasts.episodes import (
    create_episode,
    delete_episode,
    get_episodes_by_podcast,
    update_episode,
)
from src.services.podcasts.podcasts import (
    create_podcast,
    delete_podcast,
    get_podcast,
    get_podcasts_orgslug,
    update_podcast,
)


class ListPodcastsParams(BaseModel):
    limit: int = Field(20, ge=1, le=50, description="How many podcasts to return, newest first.")
    episodes_per_podcast: int = Field(
        10, ge=0, le=50, description="Episode titles to list per podcast, in order; 0 for counts only."
    )


def _bare(podcast_uuid: str) -> str:
    return podcast_uuid.removeprefix("podcast_")


async def _list_podcasts(ctx: ToolContext, p: ListPodcastsParams) -> dict[str, Any]:
    podcasts = await get_podcasts_orgslug(
        ctx.request, ctx.user, ctx.org.slug, ctx.db_session, page=1, limit=p.limit + 1, include_unpublished=True
    )
    base = await refs.web_base(ctx)
    items = []
    for podcast in podcasts[: p.limit]:
        item: dict[str, Any] = {
            "kind": "podcast",
            "uuid": podcast.podcast_uuid,
            "name": podcast.name,
            "description": results.clip(podcast.description or None),
            "published": bool(podcast.published),
            "public": bool(podcast.public),
            "episode_count": podcast.episode_count,
            "url": f"{base}/podcast/{_bare(podcast.podcast_uuid)}" if base else None,
            "editor_url": f"{base}/dash/podcasts/podcast/{_bare(podcast.podcast_uuid)}/general" if base else None,
        }
        if p.episodes_per_podcast:
            episodes = await get_episodes_by_podcast(
                ctx.request, podcast.id, ctx.db_session, ctx.user, include_unpublished=True
            )
            item["episodes"] = [
                {
                    "title": e.title,
                    "number": e.episode_number,
                    "published": bool(e.published),
                    "minutes": round((e.duration_seconds or 0) / 60) or None,
                }
                for e in episodes[: p.episodes_per_podcast]
            ]
            if len(episodes) > p.episodes_per_podcast:
                item["more_episodes"] = len(episodes) - p.episodes_per_podcast
        items.append(item)
    return results.untrusted(
        {"items": items, "total_listed": len(items), "has_more": len(podcasts) > p.limit},
        "items",
    )


# ─── one show, and changing shows and episodes ───────────────────────────────


async def _load_podcast(ctx: ToolContext, podcast_uuid: str) -> Podcast:
    row = (
        await ctx.db_session.execute(select(Podcast).where(Podcast.podcast_uuid == podcast_uuid))
    ).scalars().first()
    if row is None or row.org_id != ctx.org.id:
        raise HTTPException(status_code=404, detail=f"No podcast '{podcast_uuid}' in this organization. Use list_podcasts.")
    return row


async def _load_episode(ctx: ToolContext, episode_uuid: str) -> PodcastEpisode:
    row = (
        await ctx.db_session.execute(select(PodcastEpisode).where(PodcastEpisode.episode_uuid == episode_uuid))
    ).scalars().first()
    if row is None or row.org_id != ctx.org.id:
        raise HTTPException(status_code=404, detail=f"No episode '{episode_uuid}' in this organization. Use get_podcast.")
    return row


async def _podcast_ref(ctx: ToolContext, podcast, **extra) -> dict:
    base = await refs.web_base(ctx)
    url = f"{base}/dash/podcasts/podcast/{_bare(podcast.podcast_uuid)}/general" if base else None
    return refs.ref("podcast", podcast.podcast_uuid, podcast.name, url, **extra)


def _episode_row(e) -> dict:
    return {
        "uuid": e.episode_uuid,
        "title": e.title,
        "number": e.episode_number,
        "order": e.order,
        "published": bool(e.published),
        "minutes": round((e.duration_seconds or 0) / 60) or None,
        "has_audio": bool(e.audio_file),
        "description": results.clip(e.description or None),
    }


class GetPodcastParams(Paging):
    podcast_uuid: str = Field(..., max_length=100, description="The podcast, e.g. podcast_...")


class CreatePodcastParams(BaseModel):
    name: str = Field(..., min_length=1, max_length=200, description="Show name.")
    description: str | None = Field(None, max_length=2000, description="Short description.")
    about: str | None = Field(None, max_length=10000, description="Longer 'about' text.")
    tags: str | None = Field(None, max_length=500, description="Comma-separated tags.")


class UpdatePodcastParams(BaseModel):
    podcast_uuid: str = Field(..., max_length=100, description="The podcast to change.")
    name: str | None = Field(None, min_length=1, max_length=200)
    description: str | None = Field(None, max_length=2000)
    about: str | None = Field(None, max_length=10000)
    tags: str | None = Field(None, max_length=500)
    published: bool | None = Field(None, description="Publish (true) or unpublish (false). Needs approval.")
    public: bool | None = Field(None, description="Open to signed-out visitors (true) or members only. Needs approval.")


class PodcastIdParams(BaseModel):
    podcast_uuid: str = Field(..., max_length=100, description="The podcast.")


class CreateEpisodeParams(BaseModel):
    podcast_uuid: str = Field(..., max_length=100, description="The show to add the episode to.")
    title: str = Field(..., min_length=1, max_length=300, description="Episode title.")
    description: str | None = Field(None, max_length=10000, description="Show notes.")
    episode_number: int | None = Field(None, ge=0, le=100000, description="Episode number; next one when omitted.")


class UpdateEpisodeParams(BaseModel):
    episode_uuid: str = Field(..., max_length=100, description="The episode, e.g. episode_...")
    title: str | None = Field(None, min_length=1, max_length=300)
    description: str | None = Field(None, max_length=10000)
    episode_number: int | None = Field(None, ge=0, le=100000)
    published: bool | None = Field(None, description="Publish or unpublish. Needs approval.")


class EpisodeIdParams(BaseModel):
    episode_uuid: str = Field(..., max_length=100, description="The episode.")


async def _get_podcast(ctx: ToolContext, p: GetPodcastParams):
    row = await _load_podcast(ctx, p.podcast_uuid)
    podcast = await get_podcast(ctx.request, row.podcast_uuid, ctx.user, ctx.db_session)
    episodes = await get_episodes_by_podcast(ctx.request, row.id, ctx.db_session, ctx.user, include_unpublished=True)
    out = results.page_of([_episode_row(e) for e in episodes], p)
    out.update(
        podcast=await _podcast_ref(ctx, row),
        description=results.clip(getattr(podcast, "description", None) or None, results.DETAIL_TEXT),
        about=results.clip(getattr(podcast, "about", None) or None, results.DETAIL_TEXT),
        tags=getattr(podcast, "tags", None) or None,
        published=bool(getattr(podcast, "published", False)),
        public=bool(getattr(podcast, "public", False)),
    )
    return results.untrusted(out, "description", "about", "items")


async def _create_podcast(ctx: ToolContext, p: CreatePodcastParams):
    created = await create_podcast(
        ctx.request, ctx.org.id,
        PodcastCreate(
            name=p.name, description=p.description, about=p.about, tags=p.tags, public=False, published=False, org_id=ctx.org.id
        ),
        ctx.user, ctx.db_session,
    )
    return results.changed(
        f'Created draft podcast "{created.name}". Add episodes with create_podcast_episode; upload audio in the dashboard.',
        podcast=await _podcast_ref(ctx, created),
    )


async def _update_podcast(ctx: ToolContext, p: UpdatePodcastParams):
    row = await _load_podcast(ctx, p.podcast_uuid)
    patch = p.model_dump(exclude={"podcast_uuid"}, exclude_none=True)
    if not patch:
        raise HTTPException(status_code=400, detail="Nothing to change: pass at least one field.")
    # thumbnail_image defaults to "" on PodcastUpdate: keep the current one.
    updated = await update_podcast(
        ctx.request, PodcastUpdate(thumbnail_image=row.thumbnail_image, **patch), row.podcast_uuid, ctx.user, ctx.db_session
    )
    return results.changed(
        f'Updated podcast "{updated.name}" ({", ".join(patch)}).', podcast=await _podcast_ref(ctx, updated)
    )


async def _delete_podcast(ctx: ToolContext, p: PodcastIdParams):
    row = await _load_podcast(ctx, p.podcast_uuid)
    name = row.name
    await delete_podcast(ctx.request, row.podcast_uuid, ctx.user, ctx.db_session)
    return results.changed(f'Deleted podcast "{name}" and its episodes.', podcast=refs.ref("podcast", p.podcast_uuid, name))


async def _create_episode(ctx: ToolContext, p: CreateEpisodeParams):
    row = await _load_podcast(ctx, p.podcast_uuid)
    number = p.episode_number
    existing = await get_episodes_by_podcast(ctx.request, row.id, ctx.db_session, ctx.user, include_unpublished=True)
    if number is None:
        number = max([e.episode_number or 0 for e in existing] or [0]) + 1
    episode = await create_episode(
        ctx.request, row.podcast_uuid,
        PodcastEpisodeCreate(title=p.title, description=p.description, episode_number=number, order=len(existing), published=False),
        ctx.user, ctx.db_session,
    )
    return results.changed(
        f'Added draft episode {number} "{episode.title}" to "{row.name}". Upload its audio in the dashboard, then publish it.',
        podcast=await _podcast_ref(ctx, row), episode=refs.ref("episode", episode.episode_uuid, episode.title),
    )


async def _update_episode(ctx: ToolContext, p: UpdateEpisodeParams):
    row = await _load_episode(ctx, p.episode_uuid)
    patch = p.model_dump(exclude={"episode_uuid"}, exclude_none=True)
    if not patch:
        raise HTTPException(status_code=400, detail="Nothing to change: pass at least one field.")
    episode = await update_episode(ctx.request, row.episode_uuid, PodcastEpisodeUpdate(**patch), ctx.user, ctx.db_session)
    return results.changed(
        f'Updated episode "{episode.title}" ({", ".join(patch)}).', episode=refs.ref("episode", episode.episode_uuid, episode.title)
    )


async def _delete_episode(ctx: ToolContext, p: EpisodeIdParams):
    row = await _load_episode(ctx, p.episode_uuid)
    title = row.title
    await delete_episode(ctx.request, row.episode_uuid, ctx.user, ctx.db_session)
    return results.changed(f'Deleted episode "{title}".', episode=refs.ref("episode", p.episode_uuid, title))


SPECS: list[ToolSpec] = [
    ToolSpec(
        name="list_podcasts",
        title="List podcasts",
        description=(
            "The organization's podcasts, newest first: name, description, published or not, "
            "episode count and the first episode titles (episodes_per_podcast). Use it before "
            "suggesting episode ideas so they do not repeat existing episodes."
        ),
        params_model=ListPodcastsParams,
        tier=ActionTier.READ,
        rights_bucket="podcasts",
        access_action=AccessAction.READ,
        execute=_list_podcasts,
        idempotent=True,
    ),
    ToolSpec(
        name="get_podcast",
        title="Get a podcast",
        description="One podcast: description, about, tags, published and public flags, and its episodes in order (paged).",
        params_model=GetPodcastParams, tier=ActionTier.READ, rights_bucket="podcasts",
        access_action=AccessAction.READ, execute=_get_podcast, target_param="podcast_uuid", target_kind="podcast",
        idempotent=True,
    ),
    ToolSpec(
        name="create_podcast",
        title="Create a podcast",
        description="Create a draft podcast (unpublished, members only). Add episodes with create_podcast_episode.",
        params_model=CreatePodcastParams, tier=ActionTier.CREATE, rights_bucket="podcasts",
        access_action=AccessAction.CREATE, execute=_create_podcast, target_kind="podcast",
        summarize=lambda p: f'Create podcast "{p.name}"',
    ),
    ToolSpec(
        name="update_podcast",
        title="Update a podcast",
        description="Change a podcast's name, description, about text or tags, publish it or make it public. Send only what changes.",
        params_model=UpdatePodcastParams, tier=ActionTier.EDIT, rights_bucket="podcasts",
        access_action=AccessAction.UPDATE, execute=_update_podcast, target_param="podcast_uuid", target_kind="podcast",
        approval_if=lambda p: p.published is not None or p.public is not None, idempotent=True,
        summarize=lambda p: f"Update podcast {p.podcast_uuid}: " + ", ".join(p.model_dump(exclude={"podcast_uuid"}, exclude_none=True) or ["nothing"]),
    ),
    ToolSpec(
        name="delete_podcast",
        title="Delete a podcast",
        description="Permanently delete a podcast, its episodes and their files.",
        params_model=PodcastIdParams, tier=ActionTier.DESTRUCTIVE, rights_bucket="podcasts",
        access_action=AccessAction.DELETE, execute=_delete_podcast, target_param="podcast_uuid", target_kind="podcast",
        summarize=lambda p: f"Delete podcast {p.podcast_uuid}",
    ),
    ToolSpec(
        name="create_podcast_episode",
        title="Add a podcast episode",
        description="Add a draft episode (title, show notes, number) to a podcast. Audio is uploaded in the dashboard.",
        params_model=CreateEpisodeParams, tier=ActionTier.CREATE, rights_bucket="podcasts",
        access_action=AccessAction.CREATE, execute=_create_episode, target_param="podcast_uuid", target_kind="podcast",
        target_access=AccessAction.UPDATE,
        summarize=lambda p: f'Add episode "{p.title}" to podcast {p.podcast_uuid}',
    ),
    ToolSpec(
        name="update_podcast_episode",
        title="Update a podcast episode",
        description="Change an episode's title, show notes or number, or publish it. Send only what changes.",
        params_model=UpdateEpisodeParams, tier=ActionTier.EDIT, rights_bucket="podcasts",
        access_action=AccessAction.UPDATE, execute=_update_episode, target_param="episode_uuid", target_kind="episode",
        approval_if=lambda p: p.published is not None, idempotent=True,
        summarize=lambda p: f"Update episode {p.episode_uuid}: " + ", ".join(p.model_dump(exclude={"episode_uuid"}, exclude_none=True) or ["nothing"]),
    ),
    ToolSpec(
        name="delete_podcast_episode",
        title="Delete a podcast episode",
        description="Permanently delete an episode and its audio.",
        params_model=EpisodeIdParams, tier=ActionTier.DESTRUCTIVE, rights_bucket="podcasts",
        access_action=AccessAction.DELETE, execute=_delete_episode, target_param="episode_uuid", target_kind="episode",
        summarize=lambda p: f"Delete episode {p.episode_uuid}",
    ),
]
