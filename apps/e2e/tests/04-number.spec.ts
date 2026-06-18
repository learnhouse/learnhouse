/**
 * Goal: prove the NUMBER_ANSWER task type works end-to-end — a numeric answer
 * within the configured tolerance is auto-graded 100, in the UI and in
 * persisted server state.
 */
import { test, expect } from '../helpers/fixtures'
import { setupScenario, Scenario } from '../helpers/scenario'
import { AssignmentPage } from '../helpers/assignment'
import { TaskContents, getUserSubmission } from '../helpers/api'
import { STUDENT_STATE } from '../helpers/sharedAuth'

test.use({ storageState: STUDENT_STATE })

let s: Scenario

test.beforeAll(async () => {
  s = await setupScenario('number', {
    courseName: 'E2E Number Course',
    assignmentTitle: 'Number Assignment',
    tasks: [
      {
        title: 'What is 6 x 7?',
        assignment_type: 'NUMBER_ANSWER',
        contents: TaskContents.number(42, 0.5),
      },
    ],
  })
})

test('student enters a number within tolerance and is auto-graded 100', async ({ page }) => {

  const assignment = new AssignmentPage(page)
  await assignment.open(s.bareCourseUuid, s.bareActivityUuid)

  // 41.6 is within the ±0.5 tolerance of 42 → full marks.
  await assignment.answerNumber('41.6')
  await assignment.saveProgress()
  await assignment.submitForGrading()

  await assignment.expectGraded(100)

  const submission = await getUserSubmission(s.seeded.assignmentUuid, s.studentId, s.adminToken)
  expect(submission.grade).toBe(100)
  expect(submission.submission_status).toBe('GRADED')
})
