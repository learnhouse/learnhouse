/**
 * Goal: prove the student-facing auxiliary UI works: the Hint button reveals
 * the hint, a Reference Document link appears when the teacher attached one,
 * the Due Date is shown, and the attempt counter reflects a retry. The shared
 * student drives the activity UI; data is seeded via API.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test, expect } from '../helpers/fixtures'
import { STUDENT_STATE, sharedStudent } from '../helpers/sharedAuth'
import { AssignmentPage } from '../helpers/assignment'
import {
  login,
  getOrg,
  seedAssignment,
  uploadTaskRefFile,
  saveTaskSubmission,
  submitAssignment,
  retryMe,
  enableRetries,
  SubmissionData,
  TaskContents,
  Org,
} from '../helpers/api'
import { ADMIN_EMAIL, ADMIN_PASSWORD } from '../helpers/instance'

test.use({ storageState: STUDENT_STATE })

const FIXTURE = fileURLToPath(new URL('../fixtures/submission.png', import.meta.url))
let token: string
let org: Org

test.beforeAll(async () => {
  token = await login(ADMIN_EMAIL, ADMIN_PASSWORD)
  org = await getOrg()
})

function open(page: any, s: { courseUuid: string; activityUuid: string }) {
  const a = new AssignmentPage(page)
  return a
    .open(s.courseUuid.replace(/^course_/, ''), s.activityUuid.replace(/^activity_/, ''))
    .then(() => a)
}

test('the Hint button reveals the teacher hint', async ({ page }) => {
  const s = await seedAssignment(token, org, {
    courseName: 'E2E Aux Course',
    assignmentTitle: 'Aux Hint',
    tasks: [
      {
        title: 'Q',
        assignment_type: 'SHORT_ANSWER',
        hint: 'Think of the Eiffel Tower city',
        contents: TaskContents.shortAnswer(['Paris'], 'exact'),
      },
    ],
  })
  await open(page, s)
  await page.getByText('Hint', { exact: true }).first().click()
  await expect(page.getByText('Think of the Eiffel Tower city')).toBeVisible({ timeout: 10_000 })
})

test('a Reference Document link appears when the teacher attached a file', async ({ page }) => {
  const s = await seedAssignment(token, org, {
    courseName: 'E2E Aux Course',
    assignmentTitle: 'Aux Reference',
    tasks: [
      { title: 'Q', assignment_type: 'SHORT_ANSWER', contents: TaskContents.shortAnswer(['Paris'], 'exact') },
    ],
  })
  await uploadTaskRefFile(token, s.assignmentUuid, s.taskUuids[0], readFileSync(FIXTURE))
  await open(page, s)
  await expect(page.getByText('Reference Document', { exact: false }).first()).toBeVisible({
    timeout: 10_000,
  })
})

test('the Due Date is shown on the activity', async ({ page }) => {
  const s = await seedAssignment(token, org, {
    courseName: 'E2E Aux Course',
    assignmentTitle: 'Aux Due Date',
    tasks: [
      { title: 'Q', assignment_type: 'SHORT_ANSWER', contents: TaskContents.shortAnswer(['Paris'], 'exact') },
    ],
  })
  await open(page, s)
  await expect(page.getByText('Due Date', { exact: false }).first()).toBeVisible()
  await expect(page.getByText('2099-12-31').first()).toBeVisible()
})

test('the attempt counter shows "Attempt 2" after a retry', async ({ page }) => {
  const s = await seedAssignment(token, org, {
    courseName: 'E2E Aux Course',
    assignmentTitle: 'Aux Attempts',
    autoGrading: true,
    allowRetries: true,
    tasks: [
      { title: 'Q', assignment_type: 'SHORT_ANSWER', contents: TaskContents.shortAnswer(['Paris'], 'exact') },
    ],
  })
  await enableRetries(token, s.assignmentUuid)
  // Shared student submits (wrong → graded), then retries → attempt 2.
  const stoken = await login(sharedStudent().email, sharedStudent().password)
  await saveTaskSubmission(stoken, s.assignmentUuid, s.taskUuids[0], SubmissionData.shortAnswer('Wrong'))
  await submitAssignment(stoken, s.assignmentUuid)
  await retryMe(stoken, s.assignmentUuid)

  await open(page, s)
  await expect(page.getByText(/Attempt\s*2/).first()).toBeVisible({ timeout: 10_000 })
})
