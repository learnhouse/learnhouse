/**
 * Full human lifecycle, all four core task types in one assignment:
 *   admin seeds a published course + assignment (via API)  ->
 *   a real student logs in through the UI, answers every task, saves, submits ->
 *   the UI auto-grades to 100  ->  the teacher (admin) and student both see the
 *   graded submission via the API.
 */
import { test, expect } from '../helpers/fixtures'
import { setupScenario, Scenario } from '../helpers/scenario'
import { AssignmentPage } from '../helpers/assignment'
import { TaskContents, getUserSubmission, getUserGrade } from '../helpers/api'
import { STUDENT_STATE } from '../helpers/sharedAuth'

test.use({ storageState: STUDENT_STATE })

let s: Scenario

test.beforeAll(async () => {
  s = await setupScenario('lifecycle', {
    courseName: 'E2E Lifecycle Course',
    assignmentTitle: 'All Task Types',
    tasks: [
      { title: 'Quiz: pick A', assignment_type: 'QUIZ', contents: TaskContents.quiz('a') },
      {
        title: 'Short: capital of France',
        assignment_type: 'SHORT_ANSWER',
        contents: TaskContents.shortAnswer(['Paris'], 'case_insensitive'),
      },
      {
        title: 'Number: 6 x 7',
        assignment_type: 'NUMBER_ANSWER',
        contents: TaskContents.number(42, 0.5),
      },
      { title: 'Form: fill Paris', assignment_type: 'FORM', contents: TaskContents.form('Paris') },
    ],
  })
})

test('a student completes an all-types assignment and it is auto-graded, visible to the teacher', async ({
  page,
}) => {

  const assignment = new AssignmentPage(page)
  await assignment.open(s.bareCourseUuid, s.bareActivityUuid)

  // Answer every task the way a learner would.
  await assignment.answerQuiz('A')
  await assignment.answerShort('paris')
  await assignment.answerNumber('41.6')
  await assignment.answerForm('Paris')

  await assignment.saveProgress()
  await assignment.submitForGrading()

  // All four tasks correct -> 100/100 shown in the UI.
  const uiGrade = await assignment.expectGraded(100)
  expect(uiGrade).toBe(100)

  // Server state agrees. The persisted AssignmentUserSubmission.grade is the
  // sum of the per-task grades clamped to the assignment max (here 4 tasks ×
  // 100 = 400, which equals the max, so it stores 400); the grade endpoint
  // normalizes that to a percentage.
  const teacherView = await getUserSubmission(s.seeded.assignmentUuid, s.studentId, s.adminToken)
  expect(teacherView.submission_status).toBe('GRADED')
  expect(teacherView.grade).toBe(400)

  const grade = await getUserGrade(s.seeded.assignmentUuid, s.studentId, s.adminToken)
  expect(grade.percentage).toBe(100)
  expect(grade.passed).toBe(true)
})
