/**
 * Goal: prove the student sees the right GRADE DISPLAY for each grading type
 * after a correct (100%) auto-graded submission: PASS_FAIL → "Pass", ALPHABET →
 * "A", GPA_SCALE → "4.0". The shared student answers through the UI; the
 * displayed grade is confirmed via the API grade endpoint (display_grade), and
 * for PASS_FAIL the word "Pass" is asserted directly in the UI.
 */
import { test, expect } from '../../../core/fixtures'
import { STUDENT_STATE, sharedStudent } from '../../../core/sharedAuth'
import { AssignmentPage } from '../pages/student'
import { login, getOrg, seedAssignment, getUserGrade, TaskContents, Org } from '../api'
import { ADMIN_EMAIL, ADMIN_PASSWORD } from '../../../core/instance'

test.use({ storageState: STUDENT_STATE })

let token: string
let org: Org

test.beforeAll(async () => {
  token = await login(ADMIN_EMAIL, ADMIN_PASSWORD)
  org = await getOrg()
})

async function seedTyped(gradingType: 'PASS_FAIL' | 'ALPHABET' | 'GPA_SCALE', title: string) {
  return seedAssignment(token, org, {
    courseName: 'E2E Grading Display Course',
    assignmentTitle: title,
    autoGrading: true,
    gradingType,
    tasks: [
      { title: 'Q', assignment_type: 'SHORT_ANSWER', contents: TaskContents.shortAnswer(['Paris'], 'exact') },
    ],
  })
}

async function answerCorrect(page: any, s: { courseUuid: string; activityUuid: string }) {
  const a = new AssignmentPage(page)
  await a.open(s.courseUuid.replace(/^course_/, ''), s.activityUuid.replace(/^activity_/, ''))
  await a.answerShort('Paris')
  await a.saveProgress()
  await a.submitForGrading()
  await a.waitGraded()
  return a
}

test('PASS_FAIL grading shows "Pass" to a passing student', async ({ page }) => {
  const s = await seedTyped('PASS_FAIL', 'Display Pass/Fail')
  await answerCorrect(page, s)
  // UI surfaces the pass result.
  await expect(page.getByText('Pass', { exact: true }).first()).toBeVisible()
  const grade = await getUserGrade(s.assignmentUuid, sharedStudent().id, token)
  expect(grade.display_grade).toBe('Pass')
  expect(grade.passed).toBe(true)
})

test('ALPHABET grading yields letter grade "A" for 100%', async ({ page }) => {
  const s = await seedTyped('ALPHABET', 'Display Alphabet')
  await answerCorrect(page, s)
  const grade = await getUserGrade(s.assignmentUuid, sharedStudent().id, token)
  expect(grade.display_grade).toBe('A')
  expect(grade.passed).toBe(true)
})

test('GPA_SCALE grading yields "4.0" for 100%', async ({ page }) => {
  const s = await seedTyped('GPA_SCALE', 'Display GPA')
  await answerCorrect(page, s)
  const grade = await getUserGrade(s.assignmentUuid, sharedStudent().id, token)
  expect(grade.display_grade).toBe('4.0')
  expect(grade.passed).toBe(true)
})
