/**
 * Teacher assignment EDITOR: the Edit modal (grading type), the publish toggle,
 * and adding a task — all driven through the dashboard UI and verified via API.
 */
import { test, expect } from '../helpers/fixtures'
import { setupScenario, Scenario } from '../helpers/scenario'
import { AssignmentEditorPage } from '../helpers/teacher'
import { TaskContents, getAssignment, getTaskCount } from '../helpers/api'
import { ADMIN_EMAIL, ADMIN_PASSWORD } from '../helpers/instance'
import { ADMIN_STATE } from '../helpers/sharedAuth'

test.use({ storageState: ADMIN_STATE })

let s: Scenario

test.beforeAll(async () => {
  s = await setupScenario('editor', {
    courseName: 'E2E Editor Course',
    assignmentTitle: 'Editor Assignment',
    gradingType: 'NUMERIC',
    tasks: [
      {
        title: 'Seed task',
        assignment_type: 'SHORT_ANSWER',
        contents: TaskContents.shortAnswer(['x'], 'exact'),
      },
    ],
  })
})

test('teacher edits grading type, toggles publish, and adds a task via the editor UI', async ({
  page,
}) => {
  const editor = new AssignmentEditorPage(page)
  await editor.open(s.bareAssignmentUuid)

  // 1) Change grading type NUMERIC → PERCENTAGE via the Edit modal.
  await editor.editGradingType('Percentage')
  expect((await getAssignment(s.adminToken, s.seeded.assignmentUuid)).grading_type).toBe(
    'PERCENTAGE',
  )

  // 2) Publish toggle: unpublish then republish.
  await editor.unpublish()
  expect((await getAssignment(s.adminToken, s.seeded.assignmentUuid)).published).toBe(false)
  await editor.publish()
  expect((await getAssignment(s.adminToken, s.seeded.assignmentUuid)).published).toBe(true)

  // 3) Add a Quiz task — task count goes from 1 to 2.
  const before = await getTaskCount(s.adminToken, s.seeded.assignmentUuid)
  await editor.addTask('Quiz')
  await expect
    .poll(() => getTaskCount(s.adminToken, s.seeded.assignmentUuid), { timeout: 10_000 })
    .toBe(before + 1)
})
