/**
 * Goal: prove the teacher submissions dashboard works — stats reflect a
 * submitted-but-ungraded submission, the status filters segment by state, and
 * search narrows to a student (and clears for a bogus query). Uses the shared
 * admin session and auto-retrying assertions so it is stable under suite load.
 */
import { test, expect } from '../helpers/fixtures'
import { ADMIN_STATE } from '../helpers/sharedAuth'
import { setupSubmittedScenario, Scenario } from '../helpers/scenario'
import { TeacherSubmissionsPage } from '../helpers/teacher'
import { SubmissionData, TaskContents } from '../helpers/api'

test.use({ storageState: ADMIN_STATE })

let s: Scenario

test.beforeAll(async () => {
  s = await setupSubmittedScenario(
    'subsdash',
    {
      courseName: 'E2E Submissions Dashboard Course',
      assignmentTitle: 'Submissions Dashboard Assignment',
      autoGrading: false,
      tasks: [
        {
          title: 'Q1',
          assignment_type: 'SHORT_ANSWER',
          contents: TaskContents.shortAnswer(['x'], 'exact'),
        },
      ],
    },
    [{ taskIndex: 0, data: SubmissionData.shortAnswer('an answer') }],
  )
})

test('submissions dashboard shows stats, filters, and search', async ({ page }) => {
  const subs = new TeacherSubmissionsPage(page)
  await subs.open(s.bareAssignmentUuid)
  const email = s.student.email
  const studentRow = page.getByText(email, { exact: false })

  // Stats reflect one submitted, none graded yet.
  expect(await subs.statCount('Total')).toBeGreaterThanOrEqual(1)
  expect(await subs.statCount('Submitted')).toBeGreaterThanOrEqual(1)

  // Filter to SUBMITTED → our student is shown (auto-retry until the list settles).
  await subs.filter('Submitted')
  await expect(studentRow).toBeVisible()

  // Filter to GRADED → nothing graded yet, our student should not appear.
  await subs.filter('Graded')
  await expect(studentRow).toHaveCount(0)

  // Back to ALL, then search narrows to the student and a bogus query clears it.
  await subs.filter('All')
  await subs.search(email)
  await expect(studentRow).toBeVisible()

  await subs.search('zzz-no-such-student-zzz')
  await expect(page.getByText('Evaluate', { exact: true })).toHaveCount(0)
})
