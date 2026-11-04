import type { HttpCore } from '../core/http'
import type { BaseRequestOptions } from '../core/types'
import type { Activity } from '../models'

export function createActivitiesResource(http: HttpCore) {
  return {
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
  }
}

export type ActivitiesResource = ReturnType<typeof createActivitiesResource>
