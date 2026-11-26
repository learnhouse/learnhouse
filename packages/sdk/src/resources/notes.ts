import type { HttpCore } from '../core/http'
import type { BaseRequestOptions } from '../core/types'
import type { Note, NoteAnchor, NoteList } from '../models'

export interface ListNotesOptions extends BaseRequestOptions {
  /** Only notes taken in this course. */
  courseUuid?: string
  /** Text search. */
  q?: string
  /** Default 50 (server side). */
  limit?: number
}

/** The signed-in learner's private notes on activities. Sessions only. */
export function createNotesResource(http: HttpCore) {
  return {
    /** Notes across an org, newest first. `GET /api/v1/notes` */
    list(orgId: number, options: ListNotesOptions = {}): Promise<NoteList> {
      const { courseUuid, q, limit, ...rest } = options
      return http.GET('/api/v1/notes', {
        ...rest,
        params: { query: { org_id: orgId, course_uuid: courseUuid, q, limit } },
      })
    },
    /** Notes on one activity. `GET /api/v1/notes/activity/{activity_uuid}` */
    listForActivity(activityUuid: string, options?: BaseRequestOptions): Promise<Note[]> {
      return http.GET('/api/v1/notes/activity/{activity_uuid}', {
        ...options,
        params: { path: { activity_uuid: activityUuid } },
      })
    },
    /**
     * Add a note. `content` is a rich-text (Tiptap JSON) document; `anchor`
     * pins it to a block or a video time.
     * `POST /api/v1/notes/activity/{activity_uuid}`
     */
    create(
      activityUuid: string,
      input: { content?: Record<string, unknown>; anchor?: NoteAnchor | null },
      options?: BaseRequestOptions,
    ): Promise<Note> {
      return http.POST('/api/v1/notes/activity/{activity_uuid}', {
        ...options,
        params: { path: { activity_uuid: activityUuid } },
        body: input,
      })
    },
    /**
     * Change a note's content or anchor; `clearAnchor` unpins it.
     * `PATCH /api/v1/notes/{note_uuid}`
     */
    update(
      noteUuid: string,
      input: { content?: Record<string, unknown> | null; anchor?: NoteAnchor | null; clearAnchor?: boolean },
      options?: BaseRequestOptions,
    ): Promise<Note> {
      const { clearAnchor, ...fields } = input
      return http.PATCH('/api/v1/notes/{note_uuid}', {
        ...options,
        params: { path: { note_uuid: noteUuid } },
        body: clearAnchor === undefined ? fields : { ...fields, clear_anchor: clearAnchor },
      })
    },
    /** `DELETE /api/v1/notes/{note_uuid}` */
    delete(noteUuid: string, options?: BaseRequestOptions): Promise<unknown> {
      return http.DELETE('/api/v1/notes/{note_uuid}', { ...options, params: { path: { note_uuid: noteUuid } } })
    },
  }
}

export type NotesResource = ReturnType<typeof createNotesResource>
