/**
 * Real-authoring-tool-shaped packages must import AND have their launch content
 * actually resolve: Articulate Rise's "./scormcontent/index.html" and a resource
 * whose entry point is a nested <file> (no href attribute).
 */
import { test, expect } from '../../../core/fixtures'
import { ADMIN_EMAIL, ADMIN_PASSWORD, API_URL } from '../../../core/instance'
import { login, getOrg, seedScorm } from '../api'

async function assertContentLoads(token: string, activityUuid: string, path: string) {
  const res = await fetch(`${API_URL}/scorm/${activityUuid}/content/${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  expect(res.status, `content ${path} should 200`).toBe(200)
  const body = await res.text()
  expect(body).toContain('lhComplete') // our SCO html marker
}

test('Articulate Rise-style (./scormcontent) imports and content resolves', async () => {
  const admin = await login(ADMIN_EMAIL, ADMIN_PASSWORD)
  const org = await getOrg()
  const seed = await seedScorm(admin, org, `Rise ${Date.now()}`, 'valid_rise_style.zip')
  expect(seed.activities.length).toBe(1)
  await assertContentLoads(admin, seed.activities[0].activity_uuid, 'scormcontent/index.html')
})

test('Resource with nested-<file> entry point imports and content resolves', async () => {
  const admin = await login(ADMIN_EMAIL, ADMIN_PASSWORD)
  const org = await getOrg()
  const seed = await seedScorm(admin, org, `NestedFile ${Date.now()}`, 'valid_nested_file.zip')
  expect(seed.activities.length).toBe(1)
  await assertContentLoads(admin, seed.activities[0].activity_uuid, 'launch/index.html')
})
