/**
 * Teacher rejects a submission from the grading modal: the submission is
 * deleted (the student can then resubmit).
 */
import { test, expect } from '../../../core/fixtures'
import { setupSubmittedScenario, Scenario } from '../scenario'
import { TeacherSubmissionsPage } from '../pages/teacher'
import { SubmissionData, TaskContents, getUserSubmission } from '../api'
import { ADMIN_EMAIL, ADMIN_PASSWORD } from '../../../core/instance'
import { ADMIN_STATE } from '../../../core/sharedAuth'

test.use({ storageState: ADMIN_STATE })

let s: Scenario

test.beforeAll(async () => {
  s = await setupSubmittedScenario(
    'reject',
    {
      courseName: 'E2E Reject Course',
      assignmentTitle: 'Reject Assignment',
      autoGrading: false,
      tasks: [
        {
          title: 'Q1',
          assignment_type: 'SHORT_ANSWER',
          contents: TaskContents.shortAnswer(['x'], 'exact'),
        },
      ],
    },
    [{ taskIndex: 0, data: SubmissionData.shortAnswer('first attempt') }],
  )
})

test('teacher rejects a submission and it is removed', async ({ page }) => {
  // Present and submitted to start.
  const before = await getUserSubmission(s.seeded.assignmentUuid, s.studentId, s.adminToken)
  expect(before.submission_status).toBe('SUBMITTED')

  const subs = new TeacherSubmissionsPage(page)
  await subs.open(s.bareAssignmentUuid)

  const modal = await subs.evaluateFirst()
  await modal.reject()

  // After reject the submission no longer exists (read-back throws).
  await expect(
    getUserSubmission(s.seeded.assignmentUuid, s.studentId, s.adminToken),
  ).rejects.toThrow()
})
