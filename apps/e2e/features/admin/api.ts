/**
 * Admin / instructor sweep helpers: org members with a given role, courses
 * and raw status-returning calls for the permission matrix.
 *
 * Everything this module creates is named with the `e2e-admin-` prefix so a
 * rerun against a long-lived instance never collides with other modules.
 */
import { req, login, getOrg } from '../../core/client'
import { ADMIN_EMAIL, ADMIN_PASSWORD, API_URL, uniqueSuffix } from '../../core/instance'
import { MAILPIT_URL, latestMailTo, linkIn } from '../learner/mail'

export const PREFIX = 'e2e-admin-'
export const MEMBER_PASSWORD = 'E2eMember!234'

export type OrgRole = 'Admin' | 'Maintainer' | 'Instructor' | 'User'

export async function admin() {
  const token = await login(ADMIN_EMAIL, ADMIN_PASSWORD)
  const org = await getOrg()
  return { token, org }
}

/** Raw call that returns the status instead of throwing. */
export async function raw(method: string, path: string, token: string | null, body?: unknown) {
  const headers: Record<string, string> = {}
  if (token) headers.Authorization = `Bearer ${token}`
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const res = await fetch(`${API_URL}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  const text = await res.text()
  let data: any = text
  try { data = text ? JSON.parse(text) : null } catch { /* keep text */ }
  return { status: res.status, data }
}

/** The global role uuids (Admin, Maintainer, Instructor, User). */
export async function roleUuids(token: string, orgId: number): Promise<Record<OrgRole, string>> {
  const roles = await req<any[]>('GET', `/roles/org/${orgId}`, token)
  const out: Partial<Record<OrgRole, string>> = {}
  for (const r of roles) if (['Admin', 'Maintainer', 'Instructor', 'User'].includes(r.name) && !r.org_id) out[r.name as OrgRole] = r.role_uuid
  return out as Record<OrgRole, string>
}

export interface Member { id: number; email: string; username: string; password: string; token: string }

/** A new org member holding `role`, logged in. */
export async function member(adminToken: string, orgId: number, role: OrgRole, label: string): Promise<Member> {
  const sfx = uniqueSuffix()
  const email = `${PREFIX}${label}-${sfx}@e2e-tests.com`
  const username = `${PREFIX}${label}_${sfx}`.replace(/-/g, '_')
  const user = await req<any>('POST', `/users/${orgId}`, adminToken, { email, username, password: MEMBER_PASSWORD, first_name: label, last_name: 'E2E' })
  if (role !== 'User') {
    const uuids = await roleUuids(adminToken, orgId)
    await req('PUT', `/orgs/${orgId}/users/${user.id}/role/${uuids[role]}`, adminToken)
  }
  let token = ''
  try {
    token = await login(email, MEMBER_PASSWORD)
  } catch (e) {
    // Hosted (SaaS) installs make new members verify their email first.
    if (!/EMAIL_NOT_VERIFIED/.test(String(e)) || !MAILPIT_URL) throw e
    await verifyByMail(email, orgId)
    token = await login(email, MEMBER_PASSWORD)
  }
  return { id: user.id, email, username, password: MEMBER_PASSWORD, token }
}

/** Verify a member's email through the link the API mails (needs E2E_MAILPIT_URL). */
async function verifyByMail(email: string, orgId: number) {
  const since = Date.now()
  await req('POST', '/auth/resend-verification', null, { email, org_id: orgId })
  const link = new URL(linkIn(await latestMailTo(email, since), /verify/i))
  const q = link.searchParams
  await req('POST', '/auth/verify-email', null, {
    token: q.get('token'),
    user_uuid: q.get('user_uuid') ?? q.get('user'),
    org_uuid: q.get('org_uuid') ?? q.get('org'),
    email,
  })
}

/** A course (multipart create) with one chapter and one dynamic page. */
export async function course(token: string, orgId: number, name: string, isPublic = true) {
  const form = new FormData()
  form.set('name', `${PREFIX}${name}`)
  form.set('description', 'e2e')
  form.set('about', 'e2e')
  form.set('public', String(isPublic))
  form.set('learnings', '[]')
  form.set('tags', '[]')
  const res = await fetch(`${API_URL}/courses/?org_id=${orgId}`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form })
  if (!res.ok) throw new Error(`create course -> ${res.status}: ${await res.text()}`)
  const c = await res.json()
  const ch = await req<any>('POST', '/chapters/', token, { name: 'Chapter 1', description: '', org_id: orgId, course_id: c.id })
  const act = await req<any>('POST', '/activities/', token, {
    name: 'Lesson 1', chapter_id: ch.id, activity_type: 'TYPE_DYNAMIC', activity_sub_type: 'SUBTYPE_DYNAMIC_PAGE',
    content: {}, published: true, course_id: c.id, org_id: orgId,
  })
  return { course: c, chapter: ch, activity: act }
}

/** Delete every course this module created. */
export async function cleanup(token: string, orgId: number, orgSlug: string) {
  const list = await raw('GET', `/courses/org_slug/${orgSlug}/page/1/limit/100?include_unpublished=true`, token)
  for (const c of Array.isArray(list.data) ? list.data : []) {
    if (String(c.name || '').startsWith(PREFIX)) await raw('DELETE', `/courses/${c.course_uuid}`, token)
  }
}
