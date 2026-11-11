import { createHttpCore, type CoreOptions, type HttpCore } from './core/http'
import { bindMedia, type MediaHelpers } from './media'
import { createActivitiesResource } from './resources/activities'
import { createAuthResource } from './resources/auth'
import { createChaptersResource } from './resources/chapters'
import { createCoursesResource } from './resources/courses'
import { createOrgsResource } from './resources/orgs'
import { createSearchResource } from './resources/search'
import { createTrailResource } from './resources/trail'
import { createUsersResource } from './resources/users'

export interface ClientOptions extends CoreOptions {
  /**
   * Origin that serves `content/...` media files, when it differs from
   * `baseUrl` (e.g. a CDN). Used by `client.media`.
   */
  mediaUrl?: string
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
  readonly media: MediaHelpers
}

export function createClient(options: ClientOptions): LearnHouseClient {
  const http = createHttpCore(options)
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
    media: bindMedia({ baseUrl: options.baseUrl, mediaUrl: options.mediaUrl }),
  }
}
