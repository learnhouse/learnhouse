/**
 * When the teacher enabled "show correct answers", a student sees the accepted
 * answer revealed after their submission is graded.
 */
import { test, expect } from '../../../core/fixtures'
import { setupScenario, Scenario } from '../scenario'
import { AssignmentPage } from '../pages/student'
import { TaskContents } from '../api'
import { STUDENT_STATE } from '../../../core/sharedAuth'

test.use({ storageState: STUDENT_STATE })

let s: Scenario

test.beforeAll(async () => {
  s = await setupScenario('showans', {
    courseName: 'E2E Show Answers Course',
    assignmentTitle: 'Show Answers Assignment',
    autoGrading: true,
    showCorrectAnswers: true,
    tasks: [
      {
        title: 'What is the capital of France?',
        assignment_type: 'SHORT_ANSWER',
        contents: TaskContents.shortAnswer(['Paris'], 'case_insensitive'),
      },
    ],
  })
})

test('graded student sees the accepted answer when show_correct_answers is on', async ({ page }) => {
  const assignment = new AssignmentPage(page)
  await assignment.open(s.bareCourseUuid, s.bareActivityUuid)

  // Answer wrong so the reveal is meaningful, then submit.
  await assignment.answerShort('London')
  await assignment.saveProgress()
  await assignment.submitForGrading()
  await assignment.expectGraded(0)

  // The accepted answer is revealed post-grading.
  await expect(page.getByText('Accepted answers', { exact: false }).first()).toBeVisible({
    timeout: 15_000,
  })
  await expect(page.getByText('Paris', { exact: false }).first()).toBeVisible()
})
