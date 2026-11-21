import { test, expect } from '../../../core/fixtures'
import { admin, cleanup, course, member, raw, type Member } from '../api'

/**
 * A course's life from the instructor's side: contributors, visibility,
 * cloning and deletion. Each step goes through the same API the course
 * dashboard calls.
 */
test.describe.configure({ mode: 'serial' })

let token = ''
let orgId = 0
let orgSlug = ''
let owner: Member
let helper: Member
let learner: Member

test.beforeAll(async () => {
  const a = await admin()
  token = a.token
  orgId = a.org.id
  orgSlug = a.org.slug
  await cleanup(token, orgId, orgSlug)
  owner = await member(token, orgId, 'Instructor', 'owner')
  helper = await member(token, orgId, 'Instructor', 'helper')
  learner = await member(token, orgId, 'User', 'learner')
})
test.afterAll(async () => cleanup(token, orgId, orgSlug))

test('a contributor edits the course but cannot delete it', async () => {
  const own = await course(owner.token, orgId, 'contrib')
  const uuid = own.course.course_uuid

  // Not a contributor yet: no edits.
  expect((await raw('PUT', `/activities/${own.activity.activity_uuid}`, helper.token, { name: 'Early' })).status).toBe(403)

  expect((await raw('POST', `/courses/${uuid}/bulk-add-contributors`, owner.token, [helper.username])).status).toBe(200)
  const activate = await raw(
    'PUT',
    `/courses/${uuid}/contributors/${helper.id}?authorship=CONTRIBUTOR&authorship_status=ACTIVE`,
    owner.token,
  )
  expect(activate.status).toBe(200)

  expect((await raw('PUT', `/activities/${own.activity.activity_uuid}`, helper.token, { name: 'Edited by helper' })).status).toBe(200)
  const rights = await raw('GET', `/courses/${uuid}/rights`, helper.token)
  expect(rights.status).toBe(200)
  expect(rights.data.permissions.update).toBe(true)
  expect(rights.data.permissions.delete).toBe(false)

  expect((await raw('DELETE', `/courses/${uuid}`, helper.token)).status).toBe(403)
  expect((await raw('GET', `/courses/${uuid}/meta`, owner.token)).status).toBe(200)

  // The owner (creator) still can.
  expect((await raw('DELETE', `/courses/${uuid}`, owner.token)).status).toBe(200)
})

test('a private course stays hidden from learners until it is public', async () => {
  const draft = await course(owner.token, orgId, 'visibility', false)
  const uuid = draft.course.course_uuid
  expect([403, 404]).toContain((await raw('GET', `/courses/${uuid}/meta`, learner.token)).status)

  expect((await raw('PUT', `/courses/${uuid}`, owner.token, { public: true, published: true })).status).toBe(200)
  expect((await raw('GET', `/courses/${uuid}/meta`, learner.token)).status).toBe(200)
  // Learners never get to edit it.
  expect((await raw('PUT', `/courses/${uuid}`, learner.token, { name: 'e2e-admin-hijack' })).status).toBe(403)
})

test('a clone keeps its content after the original is deleted', async () => {
  const src = await course(owner.token, orgId, 'clone-src')
  const clone = await raw('POST', `/courses/${src.course.course_uuid}/clone`, owner.token)
  expect(clone.status).toBe(200)
  const cloneUuid = clone.data.course_uuid
  expect(cloneUuid).toBeTruthy()
  expect(cloneUuid).not.toBe(src.course.course_uuid)

  expect((await raw('DELETE', `/courses/${src.course.course_uuid}`, owner.token)).status).toBe(200)
  const meta = await raw('GET', `/courses/${cloneUuid}/meta`, owner.token)
  expect(meta.status).toBe(200)
  const chapters = meta.data.chapters ?? []
  expect(chapters.length).toBeGreaterThan(0)
  expect((chapters[0].activities ?? []).length).toBeGreaterThan(0)
})
