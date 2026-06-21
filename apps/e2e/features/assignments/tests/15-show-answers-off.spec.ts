/**
 * Goal: prove the "reveal correct answers after grading" setting is honored in
 * the NEGATIVE case — when show_correct_answers is OFF, a graded student must
 * NOT see the accepted answer. (The positive case is 11-show-correct-answers.)
 */
import { test, expect } from '../../../core/fixtures'
import { setupScenario, Scenario } from '../scenario'
import { AssignmentPage } from '../pages/student'
import { TaskContents, getUserSubmission } from '../api'
import { STUDENT_STATE } from '../../../core/sharedAuth'

test.use({ storageState: STUDENT_STATE })

let s: Scenario

test.beforeAll(async () => {
  s = await setupScenario('showoff', {
    courseName: 'E2E Show Answers Off Course',
    assignmentTitle: 'Show Answers Off Assignment',
    autoGrading: true,
    showCorrectAnswers: false, // the setting under test
    tasks: [
      {
        title: 'What is the capital of France?',
        assignment_type: 'SHORT_ANSWER',
        contents: TaskContents.shortAnswer(['Paris'], 'case_insensitive'),
      },
    ],
  })
})

test('a graded student does NOT see the accepted answer when the reveal setting is off', async ({
  page,
}) => {
  const assignment = new AssignmentPage(page)
  await assignment.open(s.bareCourseUuid, s.bareActivityUuid)

  await assignment.answerShort('London') // wrong, so a reveal would be tempting
  await assignment.saveProgress()
  await assignment.submitForGrading()
  await assignment.expectGraded(0)

  // Server confirms it is graded...
  const submission = await getUserSubmission(s.seeded.assignmentUuid, s.studentId, s.adminToken)
  expect(submission.submission_status).toBe('GRADED')

  // ...but the accepted answer must NOT be revealed in the student UI.
  await expect(page.getByText('Accepted answers', { exact: false })).toHaveCount(0)
  await expect(page.getByText('Paris', { exact: false })).toHaveCount(0)
})
