import { test, expect } from '../../../core/fixtures'
import { API_URL } from '../../../core/instance'
import { admin, cleanup, course, member, raw, roleUuids, type Member, type OrgRole } from '../api'

/**
 * The org role matrix, through the API every dashboard screen calls: what an
 * Admin, Maintainer, Instructor and learner (User) may and may not do. A
 * permission regression shows up here as a changed status, before any UI.
 */
test.describe.configure({ mode: 'serial' })

let token = ''
let orgId = 0
let orgSlug = ''
const people: Partial<Record<OrgRole, Member>> = {}
let seed: Awaited<ReturnType<typeof course>>

test.beforeAll(async () => {
  const a = await admin()
  token = a.token
  orgId = a.org.id
  orgSlug = a.org.slug
  await cleanup(token, orgId, orgSlug)
  for (const role of ['Maintainer', 'Instructor', 'User'] as OrgRole[]) people[role] = await member(token, orgId, role, role.toLowerCase())
  seed = await course(token, orgId, 'matrix-seed')
})
test.afterAll(async () => cleanup(token, orgId, orgSlug))

const ok = (s: number) => s >= 200 && s < 300

test('course authoring follows the role and ownership', async () => {
  for (const role of ['Maintainer', 'Instructor', 'User'] as OrgRole[]) {
    const t = people[role]!.token
    const form = new FormData()
    for (const [k, v] of Object.entries({ name: `e2e-admin-${role}`, description: 'd', about: 'a', public: 'true', learnings: '[]', tags: '[]' })) form.set(k, v)
    const res = await fetch(`${API_URL}/courses/?org_id=${orgId}`, { method: 'POST', headers: { Authorization: `Bearer ${t}` }, body: form })
    expect(ok(res.status), `${role} creates a course`).toBe(role !== 'User')

    // Someone else's course: only Admin/Maintainer may change it.
    const other = await raw('PUT', `/courses/${seed.course.course_uuid}`, t, { name: 'e2e-admin-matrix-seed' })
    expect(ok(other.status), `${role} edits another author's course`).toBe(role === 'Maintainer')
    const act = await raw('PUT', `/activities/${seed.activity.activity_uuid}`, t, { name: 'Lesson 1' })
    expect(ok(act.status), `${role} edits another author's lesson`).toBe(role === 'Maintainer')
  }
})

test('an instructor edits their own course end to end', async () => {
  const t = people.Instructor!.token
  const own = await course(t, orgId, 'instructor-own')
  expect((await raw('PUT', `/activities/${own.activity.activity_uuid}`, t, { name: 'Renamed' })).status).toBe(200)
  expect((await raw('PUT', `/chapters/${own.chapter.id}`, t, { name: 'Renamed chapter' })).status).toBe(200)
  expect((await raw('PUT', `/courses/${own.course.course_uuid}`, t, { name: 'e2e-admin-instructor-own-2' })).status).toBe(200)
})

test('org administration is limited to admins and maintainers', async () => {
  for (const role of ['Maintainer', 'Instructor', 'User'] as OrgRole[]) {
    const t = people[role]!.token
    const staff = role === 'Maintainer'
    expect(ok((await raw('GET', `/orgs/${orgId}/users`, t)).status), `${role} lists members`).toBe(staff)
    expect(ok((await raw('POST', '/usergroups/', t, { name: `e2e-admin-${role}`, description: '', org_id: orgId })).status), `${role} creates a group`).toBe(staff)
    // Custom roles are Admin-only.
    expect(ok((await raw('POST', `/roles/org/${orgId}`, t, { name: `e2e-admin-${role}`, description: 'x', rights: {} })).status), `${role} creates a role`).toBe(false)
  }
})

test('a maintainer cannot hand out or take away admin rights', async () => {
  const uuids = await roleUuids(token, orgId)
  const m = people.Maintainer!.token
  const promote = await raw('PUT', `/orgs/${orgId}/users/${people.Instructor!.id}/role/${uuids.Admin}`, m)
  expect(promote.status).toBe(403)
  const demote = await raw('PUT', `/orgs/${orgId}/users/${people.Maintainer!.id}/role/${uuids.User}`, people.Instructor!.token)
  expect(demote.status).toBe(403)
  // A maintainer may still move a learner between non-admin roles.
  expect((await raw('PUT', `/orgs/${orgId}/users/${people.User!.id}/role/${uuids.User}`, m)).status).toBe(200)
})

test('a learner cannot read an unpublished course', async () => {
  const draft = await course(token, orgId, 'draft', false)
  const t = people.User!.token
  expect([403, 404]).toContain((await raw('GET', `/courses/${draft.course.course_uuid}/meta`, t)).status)
  expect([403, 404]).toContain((await raw('GET', `/activities/${draft.activity.activity_uuid}`, t)).status)
})
