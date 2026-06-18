/**
 * Goal: prove the submissions dashboard SORT control reorders rows — sorting by
 * Grade puts the higher-scoring student above the lower-scoring one. Seeds two
 * students (one fully correct → 100, one wrong → 0) and asserts their on-screen
 * order via vertical position. Uses the shared admin session.
 */
import { test, expect } from '../helpers/fixtures'
import { ADMIN_STATE } from '../helpers/sharedAuth'
import {
  login,
  getOrg,
  createStudent,
  seedAssignment,
  saveTaskSubmission,
  submitAssignment,
  SubmissionData,
  TaskContents,
  Org,
} from '../helpers/api'
import { ADMIN_EMAIL, ADMIN_PASSWORD, makeStudent } from '../helpers/instance'
import { sharedStudent } from '../helpers/sharedAuth'
import { TeacherSubmissionsPage } from '../helpers/teacher'

test.use({ storageState: ADMIN_STATE })

let bareAssignmentUuid: string
let topEmail: string // the 100-scorer
let bottomEmail: string // the 0-scorer

test.beforeAll(async () => {
  const token = await login(ADMIN_EMAIL, ADMIN_PASSWORD)
  const org: Org = await getOrg()
  const seeded = await seedAssignment(token, org, {
    courseName: 'E2E Sort Course',
    assignmentTitle: 'Sort Assignment',
    autoGrading: true,
    tasks: [
      { title: 'Q', assignment_type: 'SHORT_ANSWER', contents: TaskContents.shortAnswer(['Paris'], 'exact') },
    ],
  })
  bareAssignmentUuid = seeded.assignmentUuid.replace(/^assignment_/, '')

  // Two students in one assignment: the shared student answers correctly (→100),
  // and one freshly-created student answers wrong (→0). Reusing the shared
  // student for the high scorer keeps this to a single extra login.
  const shared = sharedStudent()
  const high = { email: shared.email, password: shared.password }
  const lowStu = makeStudent('sort-low')
  await createStudent(token, org.id, lowStu)

  for (const [stu, answer] of [
    [high, 'Paris'],
    [lowStu, 'Wrong'],
  ] as const) {
    const stoken = await login(stu.email, stu.password)
    await saveTaskSubmission(stoken, seeded.assignmentUuid, seeded.taskUuids[0], SubmissionData.shortAnswer(answer))
    await submitAssignment(stoken, seeded.assignmentUuid)
  }
  topEmail = high.email
  bottomEmail = lowStu.email
})

test('sorting submissions by Grade orders the higher score first', async ({ page }) => {
  const subs = new TeacherSubmissionsPage(page)
  await subs.open(bareAssignmentUuid)

  // Both graded submissions are present.
  expect(await subs.hasStudent(topEmail)).toBe(true)
  expect(await subs.hasStudent(bottomEmail)).toBe(true)

  // Open the Sort dropdown and sort by Grade (default direction = highest first).
  await page.getByRole('button', { name: /^Sort/ }).click()
  await page.getByRole('button', { name: 'Grade', exact: true }).click()
  await page.waitForTimeout(600)

  // The 100-scorer's row sits above the 0-scorer's row.
  const topY = (await page.getByText(topEmail).first().boundingBox())?.y ?? Infinity
  const bottomY = (await page.getByText(bottomEmail).first().boundingBox())?.y ?? -Infinity
  expect(topY).toBeLessThan(bottomY)
})
