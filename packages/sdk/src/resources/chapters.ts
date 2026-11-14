import type { HttpCore } from '../core/http'
import type { BaseRequestOptions } from '../core/types'
import type { Chapter } from '../models'

export function createChaptersResource(http: HttpCore) {
  return {
    /** `GET /api/v1/chapters/{chapter_id}` (numeric id; chapter UUIDs are not accepted here). */
    get(chapterId: number, options?: BaseRequestOptions): Promise<Chapter> {
      return http.GET('/api/v1/chapters/{chapter_id}', {
        ...options,
        params: { path: { chapter_id: chapterId } },
      })
    },
    /**
     * Chapters of a course, in order, with their activities.
     * `GET /api/v1/courses/{course_uuid}/meta?slim=true`, returning `.chapters`.
     */
    async listForCourse(courseUuid: string, options?: BaseRequestOptions): Promise<Chapter[]> {
      const meta = await http.GET('/api/v1/courses/{course_uuid}/meta', {
        ...options,
        params: { path: { course_uuid: courseUuid }, query: { slim: true } },
      })
      return meta.chapters
    },
  }
}

export type ChaptersResource = ReturnType<typeof createChaptersResource>
