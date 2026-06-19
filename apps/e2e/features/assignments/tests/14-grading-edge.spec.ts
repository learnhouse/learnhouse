/**
 * Goal: prove auto-grading produces the RIGHT non-100 outcomes through the real
 * student UI, not just the happy path:
 *   - a quiz answered partially correct yields partial credit (50), and
 *   - a numeric answer outside the tolerance yields 0.
 * Both are verified in the UI result and in persisted server state.
 */
import { test, expect } from '../../../core/fixtures'
import { setupScenario, Scenario } from '../scenario'
import { AssignmentPage } from '../pages/student'
import { TaskContents, getUserSubmission } from '../api'
import { STUDENT_STATE } from '../../../core/sharedAuth'

test.use({ storageState: STUDENT_STATE })

test.describe('partial quiz credit', () => {
  let s: Scenario
  test.beforeAll(async () => {
    // One question, two options: A is correct (should be checked), B is wrong
    // (should stay unchecked). Checking BOTH ⇒ 1 of 2 options right ⇒ 50%.
    s = await setupScenario('quizpartial', {
      courseName: 'E2E Quiz Partial Course',
      assignmentTitle: 'Quiz Partial Assignment',
      tasks: [{ title: 'Pick only A', assignment_type: 'QUIZ', contents: TaskContents.quiz('a') }],
    })
  })

  test('checking a wrong option alongside the right one yields 50, not 100', async ({ page }) => {
    const assignment = new AssignmentPage(page)
    await assignment.open(s.bareCourseUuid, s.bareActivityUuid)

    await assignment.answerQuiz('A') // correct, checked
    await assignment.answerQuiz('B') // wrong, also checked → costs half the marks
    await assignment.saveProgress()
    await assignment.submitForGrading()

    await assignment.expectGraded(50)

    const submission = await getUserSubmission(s.seeded.assignmentUuid, s.studentId, s.adminToken)
    expect(submission.grade).toBe(50)
    expect(submission.submission_status).toBe('GRADED')
  })
})

test.describe('number outside tolerance', () => {
  let s: Scenario
  test.beforeAll(async () => {
    s = await setupScenario('numberwrong', {
      courseName: 'E2E Number Wrong Course',
      assignmentTitle: 'Number Wrong Assignment',
      tasks: [
        {
          title: 'What is 6 x 7?',
          assignment_type: 'NUMBER_ANSWER',
          contents: TaskContents.number(42, 0.5),
        },
      ],
    })
  })

  test('an answer outside the ±tolerance is graded 0', async ({ page }) => {
    const assignment = new AssignmentPage(page)
    await assignment.open(s.bareCourseUuid, s.bareActivityUuid)

    await assignment.answerNumber('50') // |50 - 42| = 8 ≫ 0.5 → wrong
    await assignment.saveProgress()
    await assignment.submitForGrading()

    await assignment.expectGraded(0)

    const submission = await getUserSubmission(s.seeded.assignmentUuid, s.studentId, s.adminToken)
    expect(submission.grade).toBe(0)
    expect(submission.submission_status).toBe('GRADED')
  })
})
