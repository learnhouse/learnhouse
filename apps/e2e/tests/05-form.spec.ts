/**
 * Goal: prove the FORM (fill-in-the-blank) task type works end-to-end — a
 * student filling a blank with the correct value is auto-graded 100, in the UI
 * and in persisted server state.
 */
import { test, expect } from '../helpers/fixtures'
import { setupScenario, Scenario } from '../helpers/scenario'
import { AssignmentPage } from '../helpers/assignment'
import { TaskContents, getUserSubmission } from '../helpers/api'
import { STUDENT_STATE } from '../helpers/sharedAuth'

test.use({ storageState: STUDENT_STATE })

let s: Scenario

test.beforeAll(async () => {
  s = await setupScenario('form', {
    courseName: 'E2E Form Course',
    assignmentTitle: 'Form Assignment',
    tasks: [
      {
        title: 'Fill the blank',
        assignment_type: 'FORM',
        contents: TaskContents.form('Paris'),
      },
    ],
  })
})

test('student fills a form blank correctly and is auto-graded 100', async ({ page }) => {

  const assignment = new AssignmentPage(page)
  await assignment.open(s.bareCourseUuid, s.bareActivityUuid)

  await assignment.answerForm('Paris')
  await assignment.saveProgress()
  await assignment.submitForGrading()

  await assignment.expectGraded(100)

  const submission = await getUserSubmission(s.seeded.assignmentUuid, s.studentId, s.adminToken)
  expect(submission.grade).toBe(100)
  expect(submission.submission_status).toBe('GRADED')
})
