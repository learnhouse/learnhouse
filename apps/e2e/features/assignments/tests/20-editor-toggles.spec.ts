/**
 * Goal: prove the Edit-modal grading-option TOGGLES persist — turning on
 * "Block copy & paste" and "Allow retries" and turning off "Automatic grading"
 * is saved to the assignment (verified via API). Uses the shared admin session.
 */
import { test, expect } from '../../../core/fixtures'
import { ADMIN_STATE } from '../../../core/sharedAuth'
import { login, getOrg, seedAssignment, getAssignment, TaskContents, Org } from '../api'
import { ADMIN_EMAIL, ADMIN_PASSWORD, BASE_URL } from '../../../core/instance'

test.use({ storageState: ADMIN_STATE })

let bare: string
let assignmentUuid: string
let token: string

test.beforeAll(async () => {
  token = await login(ADMIN_EMAIL, ADMIN_PASSWORD)
  const org: Org = await getOrg()
  const seeded = await seedAssignment(token, org, {
    courseName: 'E2E Toggles Course',
    assignmentTitle: 'Toggles Assignment',
    autoGrading: true, // starts ON so we can turn it OFF
    tasks: [
      { title: 'Q', assignment_type: 'SHORT_ANSWER', contents: TaskContents.shortAnswer(['x'], 'exact') },
    ],
  })
  assignmentUuid = seeded.assignmentUuid
  bare = assignmentUuid.replace(/^assignment_/, '')
})

test('Edit-modal toggles for anti-paste, auto-grading and retries persist', async ({ page }) => {
  // Baseline.
  const before = await getAssignment(token, assignmentUuid)
  expect(before.auto_grading).toBe(true)
  expect(before.anti_copy_paste).toBe(false)
  expect(before.allow_retries).toBe(false)

  await page.goto(`${BASE_URL}/dash/assignments/${bare}?subpage=editor`)
  await page.getByText('Edit', { exact: true }).first().click()
  const dialog = page.getByRole('dialog', { name: 'Edit Assignment' })
  await expect(dialog).toBeVisible({ timeout: 15_000 })

  // Each option row has an exact label paragraph; walk up to the nearest row
  // div that contains a button and click that (the row's single toggle).
  const toggle = (label: string) =>
    dialog
      .getByText(label, { exact: true })
      .locator('xpath=ancestor::div[.//button][1]')
      .getByRole('button')

  await toggle('Automatic grading').click() // ON → OFF
  await toggle('Block copy & paste').click() // OFF → ON
  await toggle('Allow retries').click() // OFF → ON

  await dialog.getByRole('button', { name: 'Save Changes' }).click()
  await expect(dialog).toBeHidden({ timeout: 10_000 })

  // All three flips persisted.
  const after = await getAssignment(token, assignmentUuid)
  expect(after.auto_grading).toBe(false)
  expect(after.anti_copy_paste).toBe(true)
  expect(after.allow_retries).toBe(true)
})
