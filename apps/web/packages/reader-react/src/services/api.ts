import type { Activity, CourseStructure } from '../types/activity'
import {
  activityIdWithPrefix,
  courseUuidWithPrefix,
  normalizeBaseUrl,
} from './urls'

function authHeaders(accessToken?: string): HeadersInit {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`
  return headers
}

export async function fetchActivity(
  baseApiUrl: string,
  activityId: string,
  accessToken?: string,
): Promise<Activity> {
  const base = normalizeBaseUrl(baseApiUrl)
  const id = activityIdWithPrefix(activityId)
  const res = await fetch(`${base}activities/${id}`, {
    method: 'GET',
    headers: authHeaders(accessToken),
    redirect: 'follow',
    credentials: 'omit',
  })
  return res.json()
}

export async function fetchCourseMeta(
  baseApiUrl: string,
  courseUuid: string,
  accessToken?: string,
  slim = true,
): Promise<CourseStructure> {
  const base = normalizeBaseUrl(baseApiUrl)
  const uuid = courseUuidWithPrefix(courseUuid)
  const qs = slim ? '?slim=true' : ''
  const res = await fetch(`${base}courses/${uuid}/meta${qs}`, {
    method: 'GET',
    headers: authHeaders(accessToken),
    redirect: 'follow',
    credentials: 'omit',
  })
  return res.json()
}
