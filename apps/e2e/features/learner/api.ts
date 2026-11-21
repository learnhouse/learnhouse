/**
 * Learner feature API: seeds the content a learner walks through (courses,
 * chapters, every activity type) and reads back learner state (trail,
 * progress) via the REST API. Builds on the generic client in core/.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { login as coreLogin, req } from '../../core/client'
import { AUTH_DIR } from '../../core/sharedAuth'
import type { Org } from '../../core/client'
import { API_URL, uniqueSuffix } from '../../core/instance'
import { everyBlockDoc, shortDoc } from './content'

export { getOrg, createStudent, req } from '../../core/client'

// The API allows 30 logins per IP per window. Every spec file runs in its own
// worker with its own in-memory token cache, so share tokens across workers
// through a file for the length of a run.
const TOKENS_FILE = join(AUTH_DIR, 'learner-tokens.json')
const TOKEN_TTL_MS = 20 * 60 * 1000

function readTokens(): Record<string, { token: string; at: number }> {
  try {
    return existsSync(TOKENS_FILE) ? JSON.parse(readFileSync(TOKENS_FILE, 'utf8')) : {}
  } catch {
    return {}
  }
}

export async function login(email: string, password: string): Promise<string> {
  const hit = readTokens()[email]
  if (hit && Date.now() - hit.at < TOKEN_TTL_MS) return hit.token
  const token = await coreLogin(email, password)
  try {
    writeFileSync(TOKENS_FILE, JSON.stringify({ ...readTokens(), [email]: { token, at: Date.now() } }))
  } catch {
    /* best effort */
  }
  return token
}
export type { Org } from '../../core/client'

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url))
export const fixture = (name: string) => `${FIXTURES}${name}`

async function multipart(token: string, path: string, fd: FormData, method = 'POST'): Promise<any> {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}` },
    body: fd,
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text}`)
  return text ? JSON.parse(text) : undefined
}

/** `course_abc` → `abc`: the web routes drop the type prefix. */
export const stripPrefix = (uuid: string) => uuid.replace(/^(course|activity|collection|path|community|discussion)_/, '')
export const coursePath = (courseUuid: string) => `/course/${stripPrefix(courseUuid)}`
export const activityPath = (courseUuid: string, activityUuid: string) =>
  `${coursePath(courseUuid)}/activity/${stripPrefix(activityUuid)}`

export interface CourseOpts {
  name?: string
  description?: string
  public?: boolean
  published?: boolean
}

export async function createCourse(token: string, org: Org, opts: CourseOpts = {}): Promise<any> {
  const fd = new FormData()
  fd.set('name', opts.name ?? `Learner course ${uniqueSuffix()}`)
  fd.set('description', opts.description ?? 'Seeded by the learner E2E suite')
  fd.set('public', String(opts.public ?? true))
  fd.set('about', 'What you will learn in this course.')
  fd.set('learnings', '[]')
  fd.set('tags', '')
  const course = await multipart(token, `/courses/?org_id=${org.id}`, fd)
  await req('PUT', `/courses/${course.course_uuid}`, token, {
    public: opts.public ?? true,
    published: opts.published ?? true,
  })
  return course
}

export async function createChapter(token: string, org: Org, courseId: number, name = 'Chapter 1'): Promise<any> {
  return req('POST', '/chapters/', token, { name, description: '', org_id: org.id, course_id: courseId })
}

export async function createDynamicActivity(
  token: string,
  org: Org,
  chapterId: number,
  name: string,
  content: Record<string, unknown>,
): Promise<any> {
  const act = await req<any>('POST', `/activities/?coursechapter_id=${chapterId}&org_id=${org.id}`, token, {
    name,
    activity_type: 'TYPE_DYNAMIC',
    activity_sub_type: 'SUBTYPE_DYNAMIC_PAGE',
    chapter_id: chapterId,
    published: true,
    content,
  })
  // Content on create is not always kept; set it explicitly.
  await req('PUT', `/activities/${act.activity_uuid}`, token, { content, published: true })
  return act
}

export async function createVideoActivity(token: string, chapterId: number, name = 'Hosted video'): Promise<any> {
  const fd = new FormData()
  fd.set('name', name)
  fd.set('chapter_id', String(chapterId))
  fd.set('details', JSON.stringify({ startTime: 0, endTime: null, autoplay: false, muted: false }))
  fd.set('video_file', new Blob([readFileSync(fixture('sample.mp4'))], { type: 'video/mp4' }), 'sample.mp4')
  const act = await multipart(token, '/activities/video', fd)
  await req('PUT', `/activities/${act.activity_uuid}`, token, { published: true })
  return act
}

export async function createYoutubeActivity(token: string, chapterId: number, name = 'YouTube video'): Promise<any> {
  const act = await req<any>('POST', '/activities/external_video', token, {
    name,
    uri: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    type: 'youtube',
    chapter_id: chapterId,
    details: '{}',
  })
  await req('PUT', `/activities/${act.activity_uuid}`, token, { published: true })
  return act
}

export async function createPdfActivity(token: string, chapterId: number, name = 'PDF document'): Promise<any> {
  const fd = new FormData()
  fd.set('name', name)
  fd.set('chapter_id', String(chapterId))
  fd.set('pdf_file', new Blob([readFileSync(fixture('sample.pdf'))], { type: 'application/pdf' }), 'sample.pdf')
  const act = await multipart(token, '/activities/documentpdf', fd)
  await req('PUT', `/activities/${act.activity_uuid}`, token, { published: true })
  return act
}

export interface LearnerCourse {
  course: any
  chapterId: number
  chapter2Id: number
  blocks: any
  video: any
  pdf: any
  youtube: any
  pages: any[]
}

/**
 * A public, published course with one of everything a learner can open:
 * a dynamic page holding every block type, a hosted video, a YouTube video,
 * a PDF, and three short pages (for progress / resume).
 */
export async function seedLearnerCourse(token: string, org: Org, name?: string): Promise<LearnerCourse> {
  const course = await createCourse(token, org, { name: name ?? `Every activity ${uniqueSuffix()}` })
  const ch1 = await createChapter(token, org, course.id, 'Getting started')
  const ch2 = await createChapter(token, org, course.id, 'Going further')
  const blocks = await createDynamicActivity(token, org, ch1.id, 'Every block', everyBlockDoc())
  const video = await createVideoActivity(token, ch1.id)
  const pdf = await createPdfActivity(token, ch1.id)
  const youtube = await createYoutubeActivity(token, ch1.id)
  const pages = []
  for (const t of ['Lesson one', 'Lesson two', 'Lesson three']) {
    pages.push(await createDynamicActivity(token, org, ch2.id, t, shortDoc(t)))
  }
  return { course, chapterId: ch1.id, chapter2Id: ch2.id, blocks, video, pdf, youtube, pages }
}

/** A minimal course with N short pages. */
export async function seedShortCourse(
  token: string,
  org: Org,
  opts: CourseOpts & { pages?: number } = {},
): Promise<{ course: any; chapterId: number; pages: any[] }> {
  const course = await createCourse(token, org, opts)
  const ch = await createChapter(token, org, course.id)
  const pages = []
  for (let i = 1; i <= (opts.pages ?? 2); i++) {
    pages.push(await createDynamicActivity(token, org, ch.id, `Page ${i}`, shortDoc(`Page ${i}`)))
  }
  return { course, chapterId: ch.id, pages }
}

// ── learner state ──────────────────────────────────────────────────────────

export async function enroll(token: string, courseUuid: string): Promise<void> {
  await req('POST', `/trail/add_course/${courseUuid}`, token, {})
}

export async function completeActivity(token: string, activityUuid: string): Promise<void> {
  await req('POST', `/trail/add_activity/${activityUuid}`, token, {})
}

export async function getTrail(token: string): Promise<any> {
  return req('GET', '/trail/', token)
}

/** The trail run for one course (or undefined if not enrolled). */
export async function getRun(token: string, courseUuid: string): Promise<any | undefined> {
  const trail = await getTrail(token)
  return (trail?.runs ?? []).find((r: any) => r?.course?.course_uuid === courseUuid || r?.course_uuid === courseUuid)
}

// ── access control, certificates, paths, communities ──────────────────────

export async function createUsergroup(token: string, org: Org, name: string): Promise<any> {
  return req('POST', '/usergroups/', token, { name, description: 'E2E group', org_id: org.id })
}

export async function addUsersToGroup(token: string, groupId: number, userIds: number[]): Promise<void> {
  await req('POST', `/usergroups/${groupId}/add_users?user_ids=${userIds.join(',')}`, token, {})
}

export async function linkResourceToGroup(token: string, groupId: number, resourceUuid: string): Promise<void> {
  await req('POST', `/usergroups/${groupId}/add_resources?resource_uuids=${resourceUuid}`, token, {})
}

export async function createCertification(token: string, courseId: number, name: string): Promise<any> {
  return req('POST', '/certifications/', token, {
    course_id: courseId,
    config: {
      certification_name: name,
      certification_description: 'Awarded by the learner E2E suite',
      certification_type: 'completion',
    },
  })
}

export async function myCertificates(token: string, org: Org): Promise<any[]> {
  const res = await req<any>('GET', `/certifications/user/all?org_id=${org.id}`, token)
  return Array.isArray(res) ? res : res?.items ?? []
}

export async function createPath(token: string, org: Org, name: string, courseUuids: string[]): Promise<any> {
  const path = await req<any>('POST', '/paths/', token, { name, org_id: org.id, description: 'E2E path', public: true })
  await req('PUT', `/paths/${path.path_uuid}/courses`, token, {
    courses: courseUuids.map((course_uuid) => ({ course_uuid, required: true })),
  })
  await req('PUT', `/paths/${path.path_uuid}`, token, { published: true })
  return path
}

export async function createCommunity(token: string, org: Org, name: string, courseId?: number): Promise<any> {
  return req('POST', `/communities/?org_id=${org.id}`, token, {
    name,
    description: 'E2E community',
    public: true,
    ...(courseId ? { course_id: courseId } : {}),
  })
}

export async function createDiscussion(token: string, communityUuid: string, title: string, content = 'Hello'): Promise<any> {
  return req('POST', `/communities/${communityUuid}/discussions`, token, { title, content, label: 'question' })
}

export async function setDrip(token: string, courseUuid: string, lockedChapterUuid: string): Promise<void> {
  await req('PUT', `/courses/${courseUuid}/drip`, token, {
    settings: { enabled: true, anchor: 'enrollment', notify_email: false, early_access_usergroups: [] },
    chapters: [{ chapter_uuid: lockedChapterUuid, rule: { mode: 'delay', delay_days: 30, require_previous: false } }],
  })
}

/** A brand-new student (own credentials) for flows that change the account. */
export async function freshStudent(adminToken: string, org: Org, label: string) {
  const { makeStudent } = await import('../../core/instance')
  const { createStudent } = await import('../../core/client')
  const s = makeStudent(label)
  const id = await createStudent(adminToken, org.id, s)
  return { ...s, id }
}
