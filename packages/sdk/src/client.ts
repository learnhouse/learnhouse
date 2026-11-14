import { createHttpCore, type CoreOptions, type FetchLike, type HttpCore } from './core/http'
import { bindMedia, type MediaHelpers } from './media'
import { createActivitiesResource } from './resources/activities'
import { createAuthResource } from './resources/auth'
import { createChaptersResource } from './resources/chapters'
import { createCoursesResource } from './resources/courses'
import { createEmbedResource } from './resources/embed'
import { createOrgsResource } from './resources/orgs'
import { createSearchResource } from './resources/search'
import { createTrailResource } from './resources/trail'
import { createUsersResource } from './resources/users'
import { SessionStore, withSessionRetry, type GetLearnHouseSession, type LearnHouseSessionInput } from './session'

export interface ClientOptions extends CoreOptions {
  /**
   * Origin that serves `content/...` media files, when it differs from
   * `baseUrl` (e.g. a CDN). Used by `client.media`.
   */
  mediaUrl?: string
  /**
   * Browser apps: a learner session (an embed session minted on your server),
   * the minted object or its `access_token`. Takes the place of `token`.
   */
  session?: LearnHouseSessionInput | null
  /**
   * Browser apps: fetches a new learner session from your server. Called when
   * there is none, shortly before the current one expires, and once on a 401.
   */
  getSession?: GetLearnHouseSession
  /** Share one session store between clients (what the React/Vue components do). */
  sessionStore?: SessionStore
}

export interface LearnHouseClient extends HttpCore {
  readonly baseUrl: string
  readonly orgs: ReturnType<typeof createOrgsResource>
  readonly courses: ReturnType<typeof createCoursesResource>
  readonly chapters: ReturnType<typeof createChaptersResource>
  readonly activities: ReturnType<typeof createActivitiesResource>
  readonly search: ReturnType<typeof createSearchResource>
  readonly trail: ReturnType<typeof createTrailResource>
  readonly users: ReturnType<typeof createUsersResource>
  readonly auth: ReturnType<typeof createAuthResource>
  /** Server-side: mint embed sessions for learners (needs an org API token). */
  readonly embed: ReturnType<typeof createEmbedResource>
  readonly media: MediaHelpers
  /** The learner session store, when the client was created with a session. */
  readonly session: SessionStore | null
}

export function createClient(options: ClientOptions): LearnHouseClient {
  const store =
    options.sessionStore ??
    (options.session !== undefined || options.getSession
      ? new SessionStore(options.session ?? null, options.getSession)
      : null)
  const baseFetch: FetchLike = options.fetch ?? ((input, init) => fetch(input, init))
  const http = createHttpCore(
    store
      ? {
          ...options,
          token: undefined,
          getToken: () => store.getToken(),
          fetch: withSessionRetry(baseFetch, store),
        }
      : options,
  )
  return {
    ...http,
    baseUrl: options.baseUrl,
    orgs: createOrgsResource(http),
    courses: createCoursesResource(http),
    chapters: createChaptersResource(http),
    activities: createActivitiesResource(http),
    search: createSearchResource(http),
    trail: createTrailResource(http),
    users: createUsersResource(http),
    auth: createAuthResource(http),
    embed: createEmbedResource(http),
    media: bindMedia({ baseUrl: options.baseUrl, mediaUrl: options.mediaUrl }),
    session: store,
  }
}
