/**
 * Student retry flow.
 *
 * A graded (wrong) submission can be retried when the teacher enabled
 * allow_retries. Clicking "Try again" resets the submission to a fresh,
 * re-answerable attempt (the attempt counter increments and status returns to
 * PENDING).
 *
 * NOTE on scope: the *reset* is asserted here because it is observable against
 * any running instance. The follow-on "resubmit for a better grade" path
 * depends on the fix in apps/web/.../AssignmentBoxUI.tsx (the student "Save
 * your progress" control was hidden on retries because it was gated on the
 * existence of an AssignmentUserSubmission row, which a retry keeps in place —
 * so students could not save new answers and always re-scored 0). Once that
 * fixed web image is running, extend this spec to re-answer + resubmit and
 * assert grade 100.
 */
import { test, expect } from '../helpers/fixtures'
import { setupScenario, Scenario } from '../helpers/scenario'
import { AssignmentPage } from '../helpers/assignment'
import { TaskContents, getUserSubmission, enableRetries } from '../helpers/api'
import { STUDENT_STATE } from '../helpers/sharedAuth'

test.use({ storageState: STUDENT_STATE })

let s: Scenario

test.beforeAll(async () => {
  s = await setupScenario('retry', {
    courseName: 'E2E Retry Course',
    assignmentTitle: 'Retry Assignment',
    autoGrading: true,
    allowRetries: true,
    tasks: [
      {
        title: 'What is 2+2?',
        assignment_type: 'SHORT_ANSWER',
        contents: TaskContents.shortAnswer(['4'], 'exact'),
      },
    ],
  })
  await enableRetries(s.adminToken, s.seeded.assignmentUuid)
})

test('a graded submission can be retried and is reset to a fresh attempt', async ({ page }) => {
  const assignment = new AssignmentPage(page)
  await assignment.open(s.bareCourseUuid, s.bareActivityUuid)

  // First attempt: wrong answer → graded 0, attempt 1.
  await assignment.answerShort('5')
  await assignment.saveProgress()
  await assignment.submitForGrading()
  expect(await assignment.expectGraded()).toBe(0)

  const first = await getUserSubmission(s.seeded.assignmentUuid, s.studentId, s.adminToken)
  expect(first.submission_status).toBe('GRADED')
  expect(first.attempt_number).toBe(1)

  // Retry resets the submission for a fresh attempt.
  await assignment.retry()

  const afterRetry = await getUserSubmission(s.seeded.assignmentUuid, s.studentId, s.adminToken)
  expect(afterRetry.attempt_number).toBe(2)
  expect(afterRetry.submission_status).not.toBe('GRADED')
})
