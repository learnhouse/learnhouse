import { createAgentResource } from './agent/client'
import { createHttpCore, type CoreOptions, type FetchLike, type HttpCore } from './core/http'
import { bindMedia, type MediaHelpers } from './media'
import { createActivitiesResource } from './resources/activities'
import { createAdminResource } from './resources/admin'
import { createAssignmentsResource } from './resources/assignments'
import { createAuthResource } from './resources/auth'
import { createCalendarResource } from './resources/calendar'
import { createCertificatesResource } from './resources/certificates'
import { createChaptersResource } from './resources/chapters'
import { createCommunitiesResource, createDiscussionsResource } from './resources/communities'
import { createCoursesResource } from './resources/courses'
import { createEmbedResource } from './resources/embed'
import { createInstanceResource } from './resources/instance'
import { createNotesResource } from './resources/notes'
import { createNotificationsResource } from './resources/notifications'
import { createOrgsResource } from './resources/orgs'
import { createPathsResource } from './resources/paths'
import { createPodcastsResource } from './resources/podcasts'
import { createSearchResource } from './resources/search'
import { createTrailResource } from './resources/trail'
import { createUserGroupsResource } from './resources/usergroups'
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
  /** Assignments: tasks, answers, file uploads, submission, grade, retry. */
  readonly assignments: ReturnType<typeof createAssignmentsResource>
  /** Course completion certificates: the learner's own, and verification. */
  readonly certificates: ReturnType<typeof createCertificatesResource>
  /** Learning paths: browse, enroll, leave, path certificates. */
  readonly paths: ReturnType<typeof createPathsResource>
  /** Community forums. */
  readonly communities: ReturnType<typeof createCommunitiesResource>
  /** Discussions in a community: post, reply, vote, react. */
  readonly discussions: ReturnType<typeof createDiscussionsResource>
  /** The signed-in user's notification inbox, preferences and push devices. */
  readonly notifications: ReturnType<typeof createNotificationsResource>
  readonly podcasts: ReturnType<typeof createPodcastsResource>
  /** The signed-in user's groups, and joining one with a code. */
  readonly usergroups: ReturnType<typeof createUserGroupsResource>
  /** The learner's private notes on activities. */
  readonly notes: ReturnType<typeof createNotesResource>
  /** The learner's calendar (due dates, releases). */
  readonly calendar: ReturnType<typeof createCalendarResource>
  /** Public instance configuration. */
  readonly instance: ReturnType<typeof createInstanceResource>
  /** Server-side: mint embed sessions for learners (needs an org API token). */
  readonly embed: ReturnType<typeof createEmbedResource>
  /** Server-side: the headless Admin API (org API token): users, enrollments, progress, certificates, groups. */
  readonly admin: ReturnType<typeof createAdminResource>
  readonly media: MediaHelpers
  /** The Agent API (Atlas, the learner copilot, custom agents): conversations and streamed turns. */
  readonly agent: ReturnType<typeof createAgentResource>
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
    assignments: createAssignmentsResource(http),
    certificates: createCertificatesResource(http),
    paths: createPathsResource(http),
    communities: createCommunitiesResource(http),
    discussions: createDiscussionsResource(http),
    notifications: createNotificationsResource(http),
    podcasts: createPodcastsResource(http),
    usergroups: createUserGroupsResource(http),
    notes: createNotesResource(http),
    calendar: createCalendarResource(http),
    instance: createInstanceResource(http),
    embed: createEmbedResource(http),
    admin: createAdminResource(http),
    media: bindMedia({ baseUrl: options.baseUrl, mediaUrl: options.mediaUrl }),
    agent: createAgentResource(http),
    session: store,
  }
}
