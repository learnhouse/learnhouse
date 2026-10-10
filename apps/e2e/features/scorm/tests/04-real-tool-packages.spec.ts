/**
 * Real-authoring-tool-shaped packages must import AND have their launch content
 * actually resolve: Articulate Rise's "./scormcontent/index.html" and a resource
 * whose entry point is a nested <file> (no href attribute).
 */
import { test, expect } from '../../../core/fixtures'
import { ADMIN_EMAIL, ADMIN_PASSWORD, API_URL } from '../../../core/instance'
import { login, getOrg, seedScorm } from '../api'

async function assertContentLoads(token: string, activityUuid: string, path: string) {
  // Content is served under a launch token, not the session.
  const launch = await fetch(`${API_URL}/scorm/${activityUuid}/launch`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ host: 'localhost' }),
  })
  expect(launch.status, 'launch should 200').toBe(200)
  const { content_base } = await launch.json()

  const res = await fetch(`${API_URL}/scorm/${content_base}${path}`)
  expect(res.status, `content ${path} should 200`).toBe(200)
  expect(res.headers.get('content-security-policy') ?? '').toMatch(/^sandbox /)
  const body = await res.text()
  expect(body).toContain('lhComplete') // our SCO html marker
  expect(body).toContain('data-lh-scorm-seed') // runtime seed for the API shim
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
