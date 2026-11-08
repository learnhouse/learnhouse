import type { HttpCore } from '../core/http'
import type { BaseRequestOptions } from '../core/types'
import { LearnHouseError } from '../errors'
import type { Activity, CourseMeta } from '../models'

/** Which activity to load: by uuid, or by name inside a course. */
export type ActivityRef =
  | { activityId: string; activityName?: undefined; courseId?: string }
  | { activityId?: undefined; activityName: string; courseId: string }

export interface ResolveActivityOptions extends BaseRequestOptions {
  /** The course meta if you already have it (or are fetching it), so a name lookup skips its own request. */
  courseMeta?: CourseMeta | Promise<CourseMeta>
}

/** Ids copied from site URLs are bare (`/course/<id>/activity/<id>`); the API wants the prefix. */
function withPrefix(id: string, prefix: string): string {
  return id.startsWith(prefix) ? id : `${prefix}${id}`
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w]+/g, '-')
    .replace(/^-|-$/g, '')

/** First activity whose name matches, ignoring case, spacing and punctuation. */
function findActivityByName(meta: CourseMeta, name: string): string | null {
  const wanted = name.trim().toLowerCase()
  for (const chapter of meta.chapters ?? []) {
    for (const activity of chapter.activities ?? []) {
      const actual = String(activity.name ?? '')
      if (actual.toLowerCase() === wanted || slug(actual) === slug(name)) return activity.activity_uuid
    }
  }
  return null
}

export function createActivitiesResource(http: HttpCore) {
  const resource = {
    /** Activity including its `content`. `GET /api/v1/activities/{activity_uuid}` */
    get(activityUuid: string, options?: BaseRequestOptions): Promise<Activity> {
      return http.GET('/api/v1/activities/{activity_uuid}', {
        ...options,
        params: { path: { activity_uuid: activityUuid } },
      })
    },
    /** `GET /api/v1/activities/chapter/{chapter_id}` */
    listForChapter(chapterId: number, options?: BaseRequestOptions): Promise<Activity[]> {
      return http.GET('/api/v1/activities/chapter/{chapter_id}', {
        ...options,
        params: { path: { chapter_id: chapterId } },
      })
    },
    /**
     * An activity with its `content`, ready for `<LearnHouseActivity activity>`.
     * Takes a uuid (bare or `activity_`-prefixed), or a name looked up in the
     * course's chapters (case-insensitive). An unknown name throws a 404
     * LearnHouseError with code `ACTIVITY_NOT_FOUND`.
     */
    async resolve(ref: ActivityRef, options: ResolveActivityOptions = {}): Promise<Activity> {
      const { courseMeta, ...rest } = options
      if (ref.activityId) return resource.get(withPrefix(ref.activityId, 'activity_'), rest)
      if (!ref.activityName || !ref.courseId) {
        throw new TypeError('activities.resolve: pass `activityId`, or `activityName` with `courseId`')
      }
      const courseUuid = withPrefix(ref.courseId, 'course_')
      const meta = await (courseMeta ??
        http.GET('/api/v1/courses/{course_uuid}/meta', {
          ...rest,
          params: { path: { course_uuid: courseUuid }, query: { slim: true } },
        }))
      const uuid = findActivityByName(meta, ref.activityName)
      if (!uuid) {
        const path = '/api/v1/courses/{course_uuid}/meta'
        throw new LearnHouseError({
          status: 404,
          code: 'ACTIVITY_NOT_FOUND',
          message: `No activity named "${ref.activityName}" in this course`,
          method: 'GET',
          path,
          url: path.replace('{course_uuid}', courseUuid),
        })
      }
      return resource.get(uuid, rest)
    },
  }
  return resource
}

export type ActivitiesResource = ReturnType<typeof createActivitiesResource>
