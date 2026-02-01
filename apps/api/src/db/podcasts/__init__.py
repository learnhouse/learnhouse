from src.db.podcasts.podcasts import (
    Podcast,
    PodcastBase,
    PodcastCreate,
    PodcastUpdate,
    PodcastRead,
    PodcastReadWithEpisodeCount,
    PodcastSEO,
    AuthorWithRole,
)
from src.db.podcasts.episodes import (
    PodcastEpisode,
    PodcastEpisodeBase,
    PodcastEpisodeCreate,
    PodcastEpisodeUpdate,
    PodcastEpisodeRead,
)

__all__ = [
    "Podcast",
    "PodcastBase",
    "PodcastCreate",
    "PodcastUpdate",
    "PodcastRead",
    "PodcastReadWithEpisodeCount",
    "PodcastSEO",
    "AuthorWithRole",
    "PodcastEpisode",
    "PodcastEpisodeBase",
    "PodcastEpisodeCreate",
    "PodcastEpisodeUpdate",
    "PodcastEpisodeRead",
]
