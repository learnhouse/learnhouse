"""New podcast episodes, on the day they were published.

Only published episodes of published podcasts the user can open, and only
when the org has podcasts on.
"""

from __future__ import annotations

from sqlmodel import select

from src.db.podcasts.episodes import PodcastEpisode
from src.db.podcasts.podcasts import Podcast
from src.security.rbac import AccessAction, check_resource_access
from src.services.calendar.sources import register_source
from src.services.calendar.sources.common import parse_stored_timestamp
from src.services.calendar.types import CalendarContext, CalendarEvent, iso_utc


async def podcast_episodes(ctx: CalendarContext) -> list[CalendarEvent]:
    if not await ctx.feature_enabled("podcasts"):
        return []
    rows = (await ctx.db_session.execute(
        select(PodcastEpisode, Podcast)
        .join(Podcast, Podcast.id == PodcastEpisode.podcast_id)  # type: ignore[arg-type]
        .where(
            Podcast.org_id == ctx.org.id,
            PodcastEpisode.org_id == ctx.org.id,
            Podcast.published == True,  # noqa: E712
            PodcastEpisode.published == True,  # noqa: E712
        )
    )).all()

    readable: dict[str, bool] = {}
    events = []
    for episode, podcast in rows:
        published = parse_stored_timestamp(episode.creation_date)
        if published is None or not ctx.overlaps(published):
            continue
        if podcast.podcast_uuid not in readable:
            decision = await check_resource_access(
                ctx.request, ctx.db_session, ctx.current_user, podcast.podcast_uuid, AccessAction.READ, raise_on_deny=False
            )
            readable[podcast.podcast_uuid] = bool(decision.allowed)
        if not readable[podcast.podcast_uuid]:
            continue
        events.append(CalendarEvent(
            id=f"podcast_episode:{episode.episode_uuid}",
            type="podcast_episode",
            title=episode.title,
            starts_at=iso_utc(published),
            url=f"/podcast/{podcast.podcast_uuid.removeprefix('podcast_')}",
            meta={"podcast": podcast.name},
        ))
    return events


register_source(podcast_episodes, key="podcasts")
