/**
 * Goal: prove the formative-assessment flow end to end — a learner deposits a
 * document, that hand-in unlocks the model answer ("corrigé") for them right
 * away, and no grade exists anywhere in the process.
 *
 * The teacher configures it through the real Edit-Assignment form (formative
 * mode + model answer + "unlocks on hand-in"), which is the surface a customer
 * would use. The student then drives the activity, and the API is read back to
 * confirm the two invariants that matter:
 *   - the corrigé is withheld server-side until the learner hands in, so it is
 *     never merely hidden by the UI, and
 *   - the submission settles on SUBMITTED with grade 0 and is never GRADED.
 */
import { fileURLToPath } from 'node:url'
import { test, expect } from '../../../core/fixtures'
import { ADMIN_STATE, STUDENT_STATE } from '../../../core/sharedAuth'
import { setupScenario, Scenario } from '../scenario'
import { AssignmentPage } from '../pages/student'
import { AssignmentEditorPage, TeacherSubmissionsPage } from '../pages/teacher'
import {
  enableRetries,
  getAssignment,
  getUserSubmission,
  login,
  saveTaskSubmission,
  setFormative,
  submitAssignment,
} from '../api'

const FIXTURE = fileURLToPath(new URL('../fixtures/submission.png', import.meta.url))
const SOLUTION = 'Corrige: restate the brief, then cite two sources for each claim.'

test.use({ storageState: STUDENT_STATE })

let s: Scenario

test.beforeAll(async () => {
  s = await setupScenario('formative', {
    courseName: 'E2E Formative Course',
    assignmentTitle: 'Formative Deposit Assignment',
    autoGrading: false,
    tasks: [
      {
        title: 'Deposit your document',
        assignment_type: 'FILE_SUBMISSION',
        contents: {},
      },
    ],
  })
})

test('handing in a document unlocks the model answer, and nothing is graded', async ({
  page,
  browser,
}) => {
  // --- Teacher: switch the assignment to formative and author the corrigé ----
  const adminCtx = await browser.newContext({ storageState: ADMIN_STATE })
  try {
    const adminPage = await adminCtx.newPage()
    const editor = new AssignmentEditorPage(adminPage)
    await editor.open(s.bareAssignmentUuid)
    await editor.configureFormative({ solution: SOLUTION, reveal: 'On hand-in' })
  } finally {
    await adminCtx.close()
  }

  const configured = await getAssignment(s.adminToken, s.seeded.assignmentUuid)
  expect(configured.ungraded).toBe(true)
  expect(configured.solution_reveal).toBe('ON_SUBMISSION')
  expect(configured.solution).toContain('restate the brief')

  // --- Student: before handing in, the corrigé is withheld ------------------
  const studentToken = await login(s.student.email, s.student.password)
  const beforeHandIn = await getAssignment(studentToken, s.seeded.assignmentUuid)
  // Withheld by the server, not just hidden by the UI — but the learner is
  // still told a model answer exists, which is what makes the hand-in worth it.
  expect(beforeHandIn.solution).toBeNull()
  expect(beforeHandIn.has_solution).toBe(true)
  expect(beforeHandIn.solution_unlocked).toBe(false)

  const assignment = new AssignmentPage(page)
  await assignment.open(s.bareCourseUuid, s.bareActivityUuid)
  await assignment.expectSolutionLocked()

  // --- Student: deposit the document and hand it in -------------------------
  await assignment.uploadFile(FIXTURE)
  await assignment.saveProgress()
  await assignment.handIn()

  // --- The corrigé is now theirs, and there is no grade anywhere ------------
  await assignment.expectHandedIn()
  await assignment.expectSolutionVisible(SOLUTION)
  await assignment.expectNoGradeShown()

  const afterHandIn = await getAssignment(studentToken, s.seeded.assignmentUuid)
  expect(afterHandIn.solution_unlocked).toBe(true)
  expect(afterHandIn.solution).toContain('restate the brief')

  const submitted = await getUserSubmission(s.seeded.assignmentUuid, s.studentId, s.adminToken)
  expect(submitted.submission_status).toBe('SUBMITTED')
  expect(submitted.grade).toBe(0)

  // --- Teacher: the review modal offers no grading at all -------------------
  const reviewCtx = await browser.newContext({ storageState: ADMIN_STATE })
  try {
    const reviewPage = await reviewCtx.newPage()
    const subs = new TeacherSubmissionsPage(reviewPage)
    await subs.open(s.bareAssignmentUuid)
    const modal = await subs.evaluateFirst()
    await expect(reviewPage.getByText('Formative — not graded').first()).toBeVisible({
      timeout: 15_000,
    })
    await expect(reviewPage.getByRole('button', { name: 'Set final grade' })).toHaveCount(0)
    await expect(reviewPage.getByRole('button', { name: 'Finalize & Complete' })).toHaveCount(0)
    void modal
  } finally {
    await reviewCtx.close()
  }
})

test('a retry re-locks the model answer until the next hand-in', async ({ page }) => {
  // Its own assignment: the shared student already handed the one above in, and
  // a submission is unique per (learner, assignment).
  const r = await setupScenario('formative-retry', {
    courseName: 'E2E Formative Retry Course',
    assignmentTitle: 'Formative Retry Assignment',
    autoGrading: false,
    ungraded: true,
    solution: SOLUTION,
    solutionReveal: 'ON_SUBMISSION',
    allowRetries: true,
    tasks: [{ title: 'Deposit your document', assignment_type: 'FILE_SUBMISSION', contents: {} }],
  })
  // Retries with no cap, so the learner always has an attempt left — the case
  // where a *graded* assignment would deliberately withhold the answer key.
  await enableRetries(r.adminToken, r.seeded.assignmentUuid, 0)
  await setFormative(r.adminToken, r.seeded.assignmentUuid, { ungraded: true })

  const studentToken = await login(r.student.email, r.student.password)
  await saveTaskSubmission(studentToken, r.seeded.assignmentUuid, r.seeded.taskUuids[0], {
    fileUUID: 'seeded-by-e2e',
  })
  await submitAssignment(studentToken, r.seeded.assignmentUuid)

  // Formative overrides the retry guard: the corrigé is readable even though an
  // attempt remains, because there is no score to game.
  expect((await getAssignment(studentToken, r.seeded.assignmentUuid)).solution_unlocked).toBe(true)

  const assignment = new AssignmentPage(page)
  await assignment.open(r.bareCourseUuid, r.bareActivityUuid)
  await assignment.expectSolutionVisible(SOLUTION)
  await assignment.retry()

  // Back to a fresh attempt — and the corrigé is withheld again until it is
  // earned a second time.
  await assignment.expectSolutionLocked()
  expect((await getAssignment(studentToken, r.seeded.assignmentUuid)).solution).toBeNull()
})
