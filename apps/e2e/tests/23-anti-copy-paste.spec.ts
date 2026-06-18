/**
 * Goal: prove the anti-copy-paste deterrent works in the student UI — when the
 * assignment has anti_copy_paste enabled, pasting into a form blank is blocked
 * (the field stays empty) and an error toast is shown. The shared student
 * drives a FORM task activity.
 */
import { test, expect } from '../helpers/fixtures'
import { STUDENT_STATE } from '../helpers/sharedAuth'
import { AssignmentPage } from '../helpers/assignment'
import { login, getOrg, seedAssignment, TaskContents, Org } from '../helpers/api'
import { ADMIN_EMAIL, ADMIN_PASSWORD } from '../helpers/instance'

test.use({ storageState: STUDENT_STATE })

let s: Awaited<ReturnType<typeof seedAssignment>>

test.beforeAll(async () => {
  const token = await login(ADMIN_EMAIL, ADMIN_PASSWORD)
  const org: Org = await getOrg()
  s = await seedAssignment(token, org, {
    courseName: 'E2E Anti-Paste Course',
    assignmentTitle: 'Anti-Paste Assignment',
    autoGrading: true,
    antiCopyPaste: true, // the deterrent under test
    tasks: [{ title: 'Fill the blank', assignment_type: 'FORM', contents: TaskContents.form('Paris') }],
  })
})

test('pasting into a form blank is blocked when anti-copy-paste is on', async ({ page }) => {
  // Allow the page to use the clipboard so we can attempt a real paste.
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])

  const assignment = new AssignmentPage(page)
  await assignment.open(s.courseUuid.replace(/^course_/, ''), s.activityUuid.replace(/^activity_/, ''))

  const blank = page.locator('main input:not([placeholder])').first()
  await blank.click()
  await page.evaluate(() => navigator.clipboard.writeText('pasted-answer'))
  await page.keyboard.press('ControlOrMeta+V')

  // The paste is blocked: an error toast appears and the field stays empty.
  await expect(page.getByText(/Pasting is disabled/i)).toBeVisible({ timeout: 10_000 })
  await expect(blank).toHaveValue('')
})
