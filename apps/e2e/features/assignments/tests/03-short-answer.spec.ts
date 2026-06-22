/**
 * Goal: prove the SHORT_ANSWER task type works end-to-end — a student typing an
 * accepted answer (in different casing than stored) is auto-graded 100 under
 * the case_insensitive match mode, in the UI and in persisted server state.
 */
import { test, expect } from '../../../core/fixtures'
import { setupScenario, Scenario } from '../scenario'
import { AssignmentPage } from '../pages/student'
import { TaskContents, getUserSubmission } from '../api'
import { STUDENT_STATE } from '../../../core/sharedAuth'

test.use({ storageState: STUDENT_STATE })

let s: Scenario

test.beforeAll(async () => {
  s = await setupScenario('short', {
    courseName: 'E2E Short Answer Course',
    assignmentTitle: 'Short Answer Assignment',
    tasks: [
      {
        title: 'Capital of France?',
        assignment_type: 'SHORT_ANSWER',
        contents: TaskContents.shortAnswer(['Paris'], 'case_insensitive'),
      },
    ],
  })
})

test('student types a correct short answer and is auto-graded 100', async ({ page }) => {

  const assignment = new AssignmentPage(page)
  await assignment.open(s.bareCourseUuid, s.bareActivityUuid)

  // Lower-case on purpose: case_insensitive match must still award full marks.
  await assignment.answerShort('paris')
  await assignment.saveProgress()
  await assignment.submitForGrading()

  await assignment.expectGraded(100)

  const submission = await getUserSubmission(s.seeded.assignmentUuid, s.studentId, s.adminToken)
  expect(submission.grade).toBe(100)
  expect(submission.submission_status).toBe('GRADED')
})
