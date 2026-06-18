/**
 * Teacher analytics subpage renders KPIs and charts once there are graded
 * submissions.
 */
import { test, expect } from '../helpers/fixtures'
import { setupSubmittedScenario, Scenario } from '../helpers/scenario'
import { SubmissionData, TaskContents } from '../helpers/api'
import { ADMIN_EMAIL, ADMIN_PASSWORD, BASE_URL } from '../helpers/instance'
import { ADMIN_STATE } from '../helpers/sharedAuth'

test.use({ storageState: ADMIN_STATE })

let s: Scenario

test.beforeAll(async () => {
  // Auto-graded correct answer → a graded (passing) submission feeds analytics.
  s = await setupSubmittedScenario(
    'analytics',
    {
      courseName: 'E2E Analytics Course',
      assignmentTitle: 'Analytics Assignment',
      autoGrading: true,
      tasks: [
        {
          title: 'What is 2+2?',
          assignment_type: 'SHORT_ANSWER',
          contents: TaskContents.shortAnswer(['4'], 'exact'),
        },
      ],
    },
    [{ taskIndex: 0, data: SubmissionData.shortAnswer('4') }],
  )
})

test('analytics subpage shows KPIs and charts for graded submissions', async ({ page }) => {
  await page.goto(`${BASE_URL}/dash/assignments/${s.bareAssignmentUuid}?subpage=analytics`)

  // KPI cards.
  await expect(page.getByText('Class Average', { exact: true })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText('Pass Rate', { exact: true })).toBeVisible()
  await expect(page.getByText('On-Time Rate', { exact: true })).toBeVisible()

  // Charts / sections.
  await expect(page.getByRole('heading', { name: 'Grade distribution' })).toBeVisible()
  await expect(page.getByRole('heading', { name: /Top performers/ })).toBeVisible()

  // The single passing submission yields a 100% pass rate — read the Pass Rate
  // KPI card's own value (not just any "100%" on the page).
  const passRateValue = page
    .locator('p', { hasText: /^Pass Rate$/ })
    .first()
    .locator('xpath=following-sibling::p[1]')
  await expect(passRateValue).toHaveText('100%')
})
