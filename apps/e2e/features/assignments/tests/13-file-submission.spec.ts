/**
 * Goal: prove a student can upload a file for a FILE_SUBMISSION task and submit,
 * and a teacher can then grade it manually (file tasks are never auto-graded).
 * The student drives the activity with the shared STUDENT session; the teacher
 * grades in a separate ADMIN-session context (one test, two roles).
 */
import { fileURLToPath } from 'node:url'
import { test, expect } from '../../../core/fixtures'
import { ADMIN_STATE, STUDENT_STATE } from '../../../core/sharedAuth'
import { setupScenario, Scenario } from '../scenario'
import { AssignmentPage } from '../pages/student'
import { TeacherSubmissionsPage } from '../pages/teacher'
import { getUserSubmission, getUserGrade } from '../api'

const FIXTURE = fileURLToPath(new URL('../fixtures/submission.png', import.meta.url))

// This test drives the student UI on `page` (shared student session).
test.use({ storageState: STUDENT_STATE })

let s: Scenario

test.beforeAll(async () => {
  s = await setupScenario('file', {
    courseName: 'E2E File Submission Course',
    assignmentTitle: 'File Submission Assignment',
    autoGrading: false, // files require manual review
    tasks: [
      {
        title: 'Upload your work',
        assignment_type: 'FILE_SUBMISSION' as any,
        contents: {},
      },
    ],
  })
})

test('student uploads a file and the teacher grades it manually', async ({ page, browser }) => {
  // Student (shared session on `page`) uploads + submits.
  const assignment = new AssignmentPage(page)
  await assignment.open(s.bareCourseUuid, s.bareActivityUuid)
  await assignment.uploadFile(FIXTURE)
  await assignment.saveProgress()
  await assignment.submitForGrading()

  // It lands as a submitted, ungraded submission for the teacher.
  const submitted = await getUserSubmission(s.seeded.assignmentUuid, s.studentId, s.adminToken)
  expect(submitted.submission_status).toBe('SUBMITTED')

  // Teacher grades it from a separate ADMIN-session context.
  const adminCtx = await browser.newContext({ storageState: ADMIN_STATE })
  try {
    const adminPage = await adminCtx.newPage()
    const subs = new TeacherSubmissionsPage(adminPage)
    await subs.open(s.bareAssignmentUuid)
    const modal = await subs.evaluateFirst()
    await modal.gradeFirstTask('Full')
    await modal.setOverallFeedback('Received — looks good.')
    await modal.finalizeAndComplete()
  } finally {
    await adminCtx.close()
  }

  const grade = await getUserGrade(s.seeded.assignmentUuid, s.studentId, s.adminToken)
  expect(grade.percentage).toBe(100)
  expect(grade.passed).toBe(true)
})
