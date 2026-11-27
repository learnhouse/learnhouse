import type { HttpCore } from '../core/http'
import { paginate } from '../core/paginate'
import type { BaseRequestOptions } from '../core/types'
import type { Podcast, PodcastEpisode, PodcastWithEpisodeCount } from '../models'

export interface ListPodcastsOptions extends BaseRequestOptions {
  /** 1-based. Default 1. */
  page?: number
  /** Default 20. */
  limit?: number
  /** Include unpublished podcasts (only honoured for users who may see them). */
  includeUnpublished?: boolean
}

/** Podcasts and their episodes. */
export function createPodcastsResource(http: HttpCore) {
  // Named so methods still work when destructured off the resource.
  const resource = {
    /** `GET /api/v1/podcasts/org_slug/{org_slug}/page/{page}/limit/{limit}` */
    list(orgSlug: string, options: ListPodcastsOptions = {}): Promise<PodcastWithEpisodeCount[]> {
      const { page = 1, limit = 20, includeUnpublished, ...rest } = options
      return http.GET('/api/v1/podcasts/org_slug/{org_slug}/page/{page}/limit/{limit}', {
        ...rest,
        params: { path: { org_slug: orgSlug, page, limit }, query: { include_unpublished: includeUnpublished } },
      })
    },
    /** Every podcast of the org, page by page. */
    listAll(
      orgSlug: string,
      options: Omit<ListPodcastsOptions, 'page' | 'limit'> & { pageSize?: number } = {},
    ): AsyncGenerator<PodcastWithEpisodeCount, void, undefined> {
      const { pageSize = 50, ...rest } = options
      return paginate(({ page }) => resource.list(orgSlug, { ...rest, page, limit: pageSize }), {
        pageSize,
        signal: rest.signal,
      })
    },
    /** Number of podcasts the caller can see. `GET /api/v1/podcasts/org_slug/{org_slug}/count` (unwraps `{ count }`) */
    async count(orgSlug: string, options?: BaseRequestOptions): Promise<number> {
      const res = (await http.GET('/api/v1/podcasts/org_slug/{org_slug}/count', {
        ...options,
        params: { path: { org_slug: orgSlug } },
      })) as { count?: unknown } | number
      return typeof res === 'number' ? res : Number(res?.count ?? 0)
    },
    /** `GET /api/v1/podcasts/{podcast_uuid}` */
    get(podcastUuid: string, options?: BaseRequestOptions): Promise<Podcast> {
      return http.GET('/api/v1/podcasts/{podcast_uuid}', { ...options, params: { path: { podcast_uuid: podcastUuid } } })
    },
    /** The podcast with its episodes in one call. `GET /api/v1/podcasts/{podcast_uuid}/meta` */
    getMeta(podcastUuid: string, options?: BaseRequestOptions): Promise<{ podcast: Podcast; episodes: PodcastEpisode[] }> {
      return http.GET('/api/v1/podcasts/{podcast_uuid}/meta', {
        ...options,
        params: { path: { podcast_uuid: podcastUuid } },
      }) as Promise<{ podcast: Podcast; episodes: PodcastEpisode[] }>
    },
    /** `GET /api/v1/podcasts/{podcast_uuid}/episodes` */
    listEpisodes(podcastUuid: string, options: BaseRequestOptions & { includeUnpublished?: boolean } = {}): Promise<PodcastEpisode[]> {
      const { includeUnpublished, ...rest } = options
      return http.GET('/api/v1/podcasts/{podcast_uuid}/episodes', {
        ...rest,
        params: { path: { podcast_uuid: podcastUuid }, query: { include_unpublished: includeUnpublished } },
      })
    },
    /** `GET /api/v1/podcasts/episodes/{episode_uuid}` */
    getEpisode(episodeUuid: string, options?: BaseRequestOptions): Promise<PodcastEpisode> {
      return http.GET('/api/v1/podcasts/episodes/{episode_uuid}', {
        ...options,
        params: { path: { episode_uuid: episodeUuid } },
      })
    },
  }
  return resource
}

export type PodcastsResource = ReturnType<typeof createPodcastsResource>
