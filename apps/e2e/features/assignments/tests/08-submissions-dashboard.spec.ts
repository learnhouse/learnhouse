/**
 * Goal: prove the teacher submissions dashboard works — stats reflect a
 * submitted-but-ungraded submission, the status filters segment by state, and
 * search narrows to a student (and clears for a bogus query). Uses the shared
 * admin session and auto-retrying assertions so it is stable under suite load.
 */
import { test, expect } from '../../../core/fixtures'
import { ADMIN_STATE } from '../../../core/sharedAuth'
import { setupSubmittedScenario, Scenario } from '../scenario'
import { TeacherSubmissionsPage } from '../pages/teacher'
import { SubmissionData, TaskContents } from '../api'

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

  // Stats reflect one submitted, none graded yet (poll — the stat cards render
  // asynchronously after the submissions load).
  await expect.poll(() => subs.statCount('Total'), { timeout: 15_000 }).toBeGreaterThanOrEqual(1)
  await expect.poll(() => subs.statCount('Submitted'), { timeout: 15_000 }).toBeGreaterThanOrEqual(1)

  // Filter to SUBMITTED → our student is shown (auto-retry until the list settles).
  await subs.filter('Submitted')
  await expect(studentRow.first()).toBeVisible()

  // Filter to GRADED → nothing graded yet, our student should not appear.
  await subs.filter('Graded')
  await expect(studentRow).toHaveCount(0)

  // Back to ALL, then search narrows to the student and a bogus query clears it.
  await subs.filter('All')
  await subs.search(email)
  await expect(studentRow.first()).toBeVisible()

  await subs.search('zzz-no-such-student-zzz')
  await expect(page.getByText('Evaluate', { exact: true })).toHaveCount(0)
})
