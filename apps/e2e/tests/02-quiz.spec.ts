/**
 * Goal: prove the QUIZ task type works end-to-end for a student — selecting the
 * correct option, saving, and submitting yields a fully auto-graded 100, both
 * in the UI and in persisted server state.
 */
import { test, expect } from '../helpers/fixtures'
import { setupScenario, Scenario } from '../helpers/scenario'
import { AssignmentPage } from '../helpers/assignment'
import { TaskContents, getUserSubmission } from '../helpers/api'
import { STUDENT_STATE } from '../helpers/sharedAuth'

test.use({ storageState: STUDENT_STATE })

let s: Scenario

test.beforeAll(async () => {
  s = await setupScenario('quiz', {
    courseName: 'E2E Quiz Course',
    assignmentTitle: 'Quiz Assignment',
    tasks: [{ title: 'Pick A', assignment_type: 'QUIZ', contents: TaskContents.quiz('a') }],
  })
})

test('student takes a quiz, picks the right answer, and is auto-graded 100', async ({ page }) => {

  const assignment = new AssignmentPage(page)
  await assignment.open(s.bareCourseUuid, s.bareActivityUuid)

  await assignment.answerQuiz('A')
  await assignment.saveProgress()
  await assignment.submitForGrading()

  // UI shows the auto-grade.
  await assignment.expectGraded(100)

  // Server agrees (read back with the cached admin token — no extra login).
  const submission = await getUserSubmission(s.seeded.assignmentUuid, s.studentId, s.adminToken)
  expect(submission.grade).toBe(100)
  expect(submission.submission_status).toBe('GRADED')
})
