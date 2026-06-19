/**
 * Goal: prove the teacher can OVERRIDE a per-task grade in the grading modal —
 * both a custom numeric value and the Half/Zero shortcuts — and have it persist
 * as the finalized grade. Auto-grading is OFF and submissions are seeded as
 * SUBMITTED via API; the teacher grades through the dashboard UI (shared admin).
 */
import { test, expect } from '../../../core/fixtures'
import { ADMIN_STATE } from '../../../core/sharedAuth'
import {
  login,
  getOrg,
  seedAssignment,
  saveTaskSubmission,
  submitAssignment,
  getUserGrade,
  SubmissionData,
  TaskContents,
  Org,
} from '../api'
import { ADMIN_EMAIL, ADMIN_PASSWORD } from '../../../core/instance'
import { sharedStudent } from '../../../core/sharedAuth'
import { TeacherSubmissionsPage } from '../pages/teacher'

test.use({ storageState: ADMIN_STATE })

let token: string
let org: Org

test.beforeAll(async () => {
  token = await login(ADMIN_EMAIL, ADMIN_PASSWORD)
  org = await getOrg()
})

/** Seed a manual-grade assignment with the shared student SUBMITTED, return ids.
 * Each test uses its own assignment, so reusing the one shared student is safe
 * (submissions are per-assignment) and adds no extra logins. */
async function seedSubmitted(title: string) {
  const seeded = await seedAssignment(token, org, {
    courseName: 'E2E Override Course',
    assignmentTitle: title,
    autoGrading: false,
    tasks: [
      { title: 'Essay', assignment_type: 'SHORT_ANSWER', contents: TaskContents.shortAnswer(['unused'], 'exact') },
    ],
  })
  const stu = sharedStudent()
  const stoken = await login(stu.email, stu.password)
  await saveTaskSubmission(stoken, seeded.assignmentUuid, seeded.taskUuids[0], SubmissionData.shortAnswer('an essay'))
  await submitAssignment(stoken, seeded.assignmentUuid)
  return { seeded, studentId: stu.id }
}

test('teacher sets a custom numeric per-task grade (70) and it persists', async ({ page }) => {
  const { seeded, studentId } = await seedSubmitted('Override Custom')
  const subs = new TeacherSubmissionsPage(page)
  await subs.open(seeded.assignmentUuid.replace(/^assignment_/, ''))
  const modal = await subs.evaluateFirst()
  await modal.gradeFirstTaskNumeric(70)
  await modal.finalizeAndComplete()

  const grade = await getUserGrade(seeded.assignmentUuid, studentId, token)
  expect(grade.percentage).toBe(70)
})

test('teacher uses the Half shortcut → 50', async ({ page }) => {
  const { seeded, studentId } = await seedSubmitted('Override Half')
  const subs = new TeacherSubmissionsPage(page)
  await subs.open(seeded.assignmentUuid.replace(/^assignment_/, ''))
  const modal = await subs.evaluateFirst()
  await modal.gradeFirstTask('Half')
  await modal.finalizeAndComplete()

  const grade = await getUserGrade(seeded.assignmentUuid, studentId, token)
  expect(grade.percentage).toBe(50)
})

test('teacher uses the Zero shortcut → 0', async ({ page }) => {
  const { seeded, studentId } = await seedSubmitted('Override Zero')
  const subs = new TeacherSubmissionsPage(page)
  await subs.open(seeded.assignmentUuid.replace(/^assignment_/, ''))
  const modal = await subs.evaluateFirst()
  await modal.gradeFirstTask('Zero')
  await modal.finalizeAndComplete()

  const grade = await getUserGrade(seeded.assignmentUuid, studentId, token)
  expect(grade.percentage).toBe(0)
})
