/**
 * Companies feature API: seeds a company space with one exclusive course
 * (course → chapter → dynamic page) and a member, via the REST API.
 */
import { req } from '../../core/client'
import type { Org } from '../../core/client'
import { API_URL } from '../../core/instance'

export { login, getOrg } from '../../core/client'
export type { Org } from '../../core/client'

/** True when the instance has company spaces (EE, Pro plan). */
export async function companiesAvailable(token: string, org: Org): Promise<boolean> {
  const res = await fetch(`${API_URL}/payments/${org.id}/companies`, { headers: { Authorization: `Bearer ${token}` } })
  return res.ok
}

async function createCourse(token: string, orgId: number, name: string): Promise<any> {
  const fd = new FormData()
  fd.set('name', name)
  fd.set('description', 'Seeded by E2E')
  fd.set('public', 'true')
  fd.set('about', 'Seeded by E2E')
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

export interface CompanySpace {
  companyUuid: string
  slug: string
  courseUuid: string
  activityUuid: string
}

/** A company with one exclusive, published course holding one dynamic page, and `memberEmail` as a member. */
export async function seedCompanySpace(token: string, org: Org, name: string, memberEmail: string): Promise<CompanySpace> {
  const company = await req<any>('POST', `/payments/${org.id}/companies`, token, { name, brand_color: '#2563eb' })
  const course = await createCourse(token, org.id, `${name} course`)
  const chapter = await req<any>('POST', '/chapters/', token, { name: 'Chapter 1', description: '', org_id: org.id, course_id: course.id })
  const activity = await req<any>('POST', `/activities/?coursechapter_id=${chapter.id}&org_id=${org.id}`, token, {
    name: 'Lesson one',
    activity_type: 'TYPE_DYNAMIC',
    activity_sub_type: 'SUBTYPE_DYNAMIC_PAGE',
    chapter_id: chapter.id,
    published: true,
  })
  await req('PUT', `/courses/${course.course_uuid}`, token, { published: true })
  await req('POST', `/payments/${org.id}/companies/${company.company_uuid}/courses`, token, { course_uuid: course.course_uuid, exclusive: true })
  await req('POST', `/payments/${org.id}/companies/${company.company_uuid}/members`, token, { emails: [memberEmail] })
  return { companyUuid: company.company_uuid, slug: company.slug, courseUuid: course.course_uuid, activityUuid: activity.activity_uuid }
}

/** Removes what seedCompanySpace created (the course; the company is cancelled). */
export async function cleanupCompanySpace(token: string, org: Org, space: CompanySpace): Promise<void> {
  await req('DELETE', `/payments/${org.id}/companies/${space.companyUuid}/courses/${space.courseUuid}`, token).catch(() => {})
  await req('DELETE', `/courses/${space.courseUuid}`, token).catch(() => {})
}
