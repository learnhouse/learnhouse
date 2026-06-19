/**
 * Teacher MANUAL grading through the dashboard.
 *
 * Auto-grading is OFF and the student's short answer would NOT match the
 * accepted answer, so the only way to a passing grade is the teacher's manual
 * override. The teacher opens the submissions dashboard, evaluates, awards
 * Full marks, leaves overall feedback, and finalizes. We then assert the grade
 * + feedback persisted and the student sees them.
 *
 * NOTE: this exercises the fix for the bug where server-side re-verification
 * clobbered a teacher's manual grade on submit (see
 * apps/api/src/tests/services/test_assignment_manual_grading.py). It requires
 * that fix to be present in the running instance.
 */
import { test, expect } from '../../../core/fixtures'
import { setupSubmittedScenario, Scenario } from '../scenario'
import { TeacherSubmissionsPage } from '../pages/teacher'
import {
  login,
  getMySubmission,
  getUserSubmission,
  getUserGrade,
  SubmissionData,
  TaskContents,
} from '../api'
import { ADMIN_EMAIL, ADMIN_PASSWORD } from '../../../core/instance'
import { ADMIN_STATE } from '../../../core/sharedAuth'

test.use({ storageState: ADMIN_STATE })

let s: Scenario

test.beforeAll(async () => {
  s = await setupSubmittedScenario(
    'manualgrade',
    {
      courseName: 'E2E Manual Grading Course',
      assignmentTitle: 'Manual Grading Assignment',
      autoGrading: false, // teacher grades by hand
      tasks: [
        {
          title: 'Explain your reasoning',
          assignment_type: 'SHORT_ANSWER',
          // Accepted answer the student deliberately will NOT match.
          contents: TaskContents.shortAnswer(['exactly-this'], 'exact'),
        },
      ],
    },
    [{ taskIndex: 0, data: SubmissionData.shortAnswer('A thoughtful essay that does not match') }],
  )
})

test('teacher manually grades a submission to full marks and finalizes', async ({ page }) => {
  // Sanity: the submission starts ungraded.
  const before = await getUserSubmission(s.seeded.assignmentUuid, s.studentId, s.adminToken)
  expect(before.submission_status).toBe('SUBMITTED')

  // Teacher logs in and grades through the dashboard.
  const submissions = new TeacherSubmissionsPage(page)
  await submissions.open(s.bareAssignmentUuid)

  expect(await submissions.statCount('Submitted')).toBeGreaterThanOrEqual(1)

  const modal = await submissions.evaluateFirst()
  await modal.gradeFirstTask('Full')
  await modal.setOverallFeedback('Credit awarded for sound reasoning.')
  await modal.finalizeAndComplete()

  // The teacher's manual grade must survive (not be re-derived to 0).
  const grade = await getUserGrade(s.seeded.assignmentUuid, s.studentId, s.adminToken)
  expect(grade.percentage).toBe(100)
  expect(grade.passed).toBe(true)
  expect(grade.overall_feedback).toBe('Credit awarded for sound reasoning.')

  const after = await getUserSubmission(s.seeded.assignmentUuid, s.studentId, s.adminToken)
  expect(after.submission_status).toBe('GRADED')

  // The student themselves can read their now-graded submission (proves the
  // grade is visible to the student, not just the teacher).
  const studentToken = await login(s.student.email, s.student.password)
  const mine = await getMySubmission(s.seeded.assignmentUuid, studentToken)
  expect(mine.submission_status).toBe('GRADED')
  expect(mine.grade).toBe(100)
})
