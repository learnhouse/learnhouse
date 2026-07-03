/**
 * SCORM feature API — drives the EE SCORM endpoints over REST so the specs can
 * exercise the full upload → analyze → import → runtime → reporting flow against
 * a running EE instance. Requires SCORM (Enterprise Edition); see README.
 *
 * Field names mirror the backend (ee/routers/scorm.py, ee/db/scorm.py).
 */
import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'node:url'

import { req } from '../../core/client'
import type { Org } from '../../core/client'
import { API_URL } from '../../core/instance'

export { login, getOrg, createStudent } from '../../core/client'
export type { Org } from '../../core/client'

const HERE = path.dirname(fileURLToPath(import.meta.url))
export const FIXTURES_DIR = path.join(HERE, 'fixtures')

export interface ScormSco {
  identifier: string
  title: string
  launch_path: string
}
export interface ScormAnalysis {
  temp_package_id: string
  scorm_version: 'SCORM_12' | 'SCORM_2004'
  package_title: string
  scos: ScormSco[]
}
export interface ScormSeed {
  org: Org
  courseId: number
  courseUuid: string
  chapterId: number
  activities: { activity_uuid: string; name: string }[]
}

/** Create a public, published course (multipart, mirrors assignments seed). */
async function createCourse(token: string, orgId: number, name: string): Promise<any> {
  const fd = new FormData()
  fd.set('name', name)
  fd.set('description', 'SCORM E2E')
  fd.set('public', 'true')
  fd.set('about', 'SCORM E2E')
  fd.set('learnings', '[]')
  fd.set('tags', '')
  const res = await fetch(`${API_URL}/courses/?org_id=${orgId}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: fd,
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`createCourse -> ${res.status}: ${text}`)
  return JSON.parse(text)
}

/** Upload + analyze a SCORM .zip from the fixtures dir. */
export async function analyzeScorm(
  token: string,
  courseUuid: string,
  fixtureName: string,
): Promise<ScormAnalysis> {
  const buf = fs.readFileSync(path.join(FIXTURES_DIR, fixtureName))
  const fd = new FormData()
  fd.set('scorm_file', new Blob([buf], { type: 'application/zip' }), fixtureName)
  const res = await fetch(`${API_URL}/scorm/analyze/${courseUuid}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: fd,
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`analyzeScorm -> ${res.status}: ${text}`)
  return JSON.parse(text)
}

/** Import every SCO of an analyzed package into a chapter as activities. */
export async function importScorm(
  token: string,
  courseUuid: string,
  chapterId: number,
  analysis: ScormAnalysis,
): Promise<{ activity_uuid: string; name: string }[]> {
  const activities = await req<any[]>('POST', `/scorm/import/${courseUuid}`, token, {
    temp_package_id: analysis.temp_package_id,
    sco_assignments: analysis.scos.map((s) => ({
      sco_identifier: s.identifier,
      chapter_id: chapterId,
      activity_name: s.title,
    })),
  })
  return activities.map((a) => ({ activity_uuid: a.activity_uuid, name: a.name }))
}

/** Full seed: public course → chapter → analyze + import a fixture package. */
export async function seedScorm(
  adminToken: string,
  org: Org,
  courseName: string,
  fixtureName: string,
): Promise<ScormSeed> {
  const course = await createCourse(adminToken, org.id, courseName)
  const chapter = await req<any>('POST', '/chapters/', adminToken, {
    name: 'Chapter 1', description: '', org_id: org.id, course_id: course.id,
  })
  const analysis = await analyzeScorm(adminToken, course.course_uuid, fixtureName)
  const activities = await importScorm(adminToken, course.course_uuid, chapter.id, analysis)
  await req('PUT', `/courses/${course.course_uuid}`, adminToken,
    { public: true, published: true }).catch(() => {})
  return {
    org, courseId: course.id, courseUuid: course.course_uuid,
    chapterId: chapter.id, activities,
  }
}

// ---- Runtime ----

export function runtimeInitialize(token: string, activityUuid: string): Promise<any> {
  return req('POST', `/scorm/${activityUuid}/runtime/initialize`, token, {})
}
export function runtimeCommit(token: string, activityUuid: string, cmi: Record<string, string>): Promise<any> {
  return req('POST', `/scorm/${activityUuid}/runtime/commit`, token, cmi)
}
export function runtimeTerminate(token: string, activityUuid: string, cmi: Record<string, string> = {}): Promise<any> {
  return req('POST', `/scorm/${activityUuid}/runtime/terminate`, token, cmi)
}
export function getRuntimeData(token: string, activityUuid: string): Promise<any> {
  return req('GET', `/scorm/${activityUuid}/runtime/data`, token)
}
export function getResults(token: string, activityUuid: string): Promise<any[]> {
  return req('GET', `/scorm/${activityUuid}/results`, token)
}
