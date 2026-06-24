/**
 * Browser smoke: a real learner logs in, opens a SCORM activity, and the player
 * mounts the content iframe (i.e. runtime init + API injection succeeded).
 */
import { test, expect } from '../../../core/fixtures'
import { ADMIN_EMAIL, ADMIN_PASSWORD, BASE_URL, makeStudent } from '../../../core/instance'
import { uiLogin } from '../../../core/auth'
import { login, getOrg, createStudent, seedScorm } from '../api'

test('SCORM player renders the content iframe for a learner', async ({ page }) => {
  const admin = await login(ADMIN_EMAIL, ADMIN_PASSWORD)
  const org = await getOrg()
  const seed = await seedScorm(admin, org, `SCORM Player ${Date.now()}`, 'valid_12_single.zip')
  const bareCourse = seed.courseUuid.replace(/^course_/, '')
  const bareActivity = seed.activities[0].activity_uuid.replace(/^activity_/, '')

  const student = makeStudent('player')
  await createStudent(admin, org.id, {
    email: student.email, username: student.username, password: student.password,
    first_name: student.firstName, last_name: student.lastName,
  })

  await uiLogin(page, student.email, student.password)
  await page.goto(`${BASE_URL}/course/${bareCourse}/activity/${bareActivity}`)

  // The player mounts an iframe once the runtime initializes + the API is injected.
  await expect(page.locator('iframe[title]').first()).toBeVisible({ timeout: 20000 })
})
