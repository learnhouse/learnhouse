/**
 * AI settings feature API: reads and writes the org's per-feature AI switches
 * (Settings > AI) and seeds a one-page course the specs open as a learner and
 * in the editor. Builds on the generic client in core/.
 */
import { req } from '../../core/client'
import type { Org } from '../../core/client'
import { API_URL } from '../../core/instance'

export { login, getOrg } from '../../core/client'
export type { Org } from '../../core/client'

export interface AISettings {
  enabled: boolean
  switches: Record<string, boolean>
  features: Record<string, boolean>
  ask_ai_staff_only: boolean
  monthly_credit_cap: number
}

export interface AISettingsPatch {
  ai_enabled?: boolean
  features?: Record<string, boolean>
  ask_ai_staff_only?: boolean
  monthly_credit_cap?: number
}

export function getAISettings(token: string, orgId: number): Promise<AISettings> {
  return req<AISettings>('GET', `/orgs/${orgId}/config/ai/settings`, token)
}

export function setAISettings(token: string, orgId: number, patch: AISettingsPatch): Promise<AISettings> {
  return req<AISettings>('PUT', `/orgs/${orgId}/config/ai/settings`, token, patch)
}

/** Put the settings back exactly as a snapshot had them. */
export function restoreAISettings(token: string, orgId: number, s: AISettings): Promise<AISettings> {
  return setAISettings(token, orgId, {
    ai_enabled: s.enabled,
    features: s.switches,
    ask_ai_staff_only: s.ask_ai_staff_only,
    monthly_credit_cap: s.monthly_credit_cap,
  })
}

export interface SeededLesson {
  courseUuid: string
  activityUuid: string
  /** Learner URL path (no origin). */
  lessonPath: string
  /** Activity editor URL path (no origin). */
  editorPath: string
}

/** A public, published course with one published page. */
export async function seedLesson(token: string, org: Org, name: string): Promise<SeededLesson> {
  const fd = new FormData()
  fd.set('name', name)
  fd.set('description', 'Seeded by E2E')
  fd.set('public', 'true')
  fd.set('about', 'Seeded by E2E')
  fd.set('learnings', '[]')
  fd.set('tags', '')
  const res = await fetch(`${API_URL}/courses/?org_id=${org.id}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: fd,
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`createCourse -> ${res.status}: ${text}`)
  const course = JSON.parse(text)

  const chapter = await req<any>('POST', '/chapters/', token, {
    name: 'Chapter 1',
    description: '',
    org_id: org.id,
    course_id: course.id,
  })
  const activity = await req<any>('POST', `/activities/?coursechapter_id=${chapter.id}&org_id=${org.id}`, token, {
    name: 'AI settings lesson',
    activity_type: 'TYPE_DYNAMIC',
    activity_sub_type: 'SUBTYPE_DYNAMIC_PAGE',
    chapter_id: chapter.id,
    published: true,
    content: {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Photosynthesis turns light into sugar.' }] }],
    },
  })
  await req('PUT', `/courses/${course.course_uuid}`, token, { public: true, published: true }).catch(() => {})

  const c = String(course.course_uuid).replace('course_', '')
  const a = String(activity.activity_uuid).replace('activity_', '')
  return {
    courseUuid: course.course_uuid,
    activityUuid: activity.activity_uuid,
    lessonPath: `/course/${c}/activity/${a}`,
    editorPath: `/course/${c}/activity/${a}/edit`,
  }
}

export async function deleteCourse(token: string, courseUuid: string): Promise<void> {
  await req('DELETE', `/courses/${courseUuid}`, token).catch(() => {})
}
