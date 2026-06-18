/**
 * Goal: prove a teacher can AUTHOR task content through the editor UI (not just
 * "Add Task"): set a task's General fields (title/hint) and its Content
 * (a short-answer prompt + accepted answer + match mode), and DELETE a task —
 * each verified against the persisted API state. Uses the shared admin session.
 */
import { test, expect } from '../helpers/fixtures'
import { ADMIN_STATE } from '../helpers/sharedAuth'
import { login, getOrg, seedAssignment, getTaskCount, TaskContents, Org } from '../helpers/api'
import { ADMIN_EMAIL, ADMIN_PASSWORD, BASE_URL, API_URL } from '../helpers/instance'

test.use({ storageState: ADMIN_STATE })

let token: string
let org: Org

test.beforeAll(async () => {
  token = await login(ADMIN_EMAIL, ADMIN_PASSWORD)
  org = await getOrg()
})

async function seedEmpty(title: string) {
  return seedAssignment(token, org, {
    courseName: 'E2E Authoring Course',
    assignmentTitle: title,
    tasks: [],
  })
}

async function tasksJson(assignmentUuid: string) {
  const res = await fetch(`${API_URL}/assignments/${assignmentUuid}/tasks`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  return res.json() as Promise<any[]>
}

test('teacher authors a short-answer task (general + content) through the editor UI', async ({
  page,
}) => {
  const a = await seedEmpty('Authoring SA')
  const bare = a.assignmentUuid.replace(/^assignment_/, '')
  await page.goto(`${BASE_URL}/dash/assignments/${bare}?subpage=editor`)

  // Create the task via the picker.
  await page.getByRole('button', { name: 'Add Task' }).click()
  await page
    .getByRole('dialog', { name: 'Add an Assignment Task' })
    .getByRole('button', { name: /^Short answer/ })
    .click()

  // General tab (default): title + hint, then Submit.
  await page.getByRole('textbox', { name: 'Title' }).fill('Capital question')
  await page.getByRole('textbox', { name: 'Hint' }).fill('It is a European capital')
  await page.getByRole('button', { name: 'Submit' }).click()
  await page.waitForTimeout(800)

  // Content tab: prompt + accepted answer + match mode, then Save.
  await page.getByText('Content', { exact: true }).first().click()
  await page.getByPlaceholder('What is the capital of Morocco?').fill('Capital of France?')
  await page.getByPlaceholder('Rabat').fill('Paris')
  await page.getByRole('combobox').selectOption('Exact match')
  await page.getByText('Save', { exact: true }).first().click()
  await page.waitForTimeout(1000)

  // Verify the authored task persisted exactly as entered.
  await expect
    .poll(async () => (await tasksJson(a.assignmentUuid)).length, { timeout: 10_000 })
    .toBe(1)
  const tasks = await tasksJson(a.assignmentUuid)
  const task = tasks[0]
  expect(task.assignment_type).toBe('SHORT_ANSWER')
  expect(task.title).toBe('Capital question')
  expect(task.hint).toBe('It is a European capital')
  expect(task.contents.correct_answers).toEqual(['Paris'])
  expect(task.contents.match_mode).toBe('exact')
})

test('teacher deletes a task through the editor UI', async ({ page }) => {
  // Seed an assignment that already has one task to delete.
  const a = await seedAssignment(token, org, {
    courseName: 'E2E Authoring Course',
    assignmentTitle: 'Authoring Delete',
    tasks: [
      { title: 'Doomed', assignment_type: 'SHORT_ANSWER', contents: TaskContents.shortAnswer(['x'], 'exact') },
    ],
  })
  expect(await getTaskCount(token, a.assignmentUuid)).toBe(1)

  const bare = a.assignmentUuid.replace(/^assignment_/, '')
  await page.goto(`${BASE_URL}/dash/assignments/${bare}?subpage=editor`)

  // Select the task, then delete it (confirm if a dialog appears).
  await page.getByRole('button', { name: /Short answer/ }).first().click()
  await page.getByText('Delete Task', { exact: true }).click()
  const confirm = page.getByRole('dialog').getByRole('button', { name: /Delete/ })
  if (await confirm.isVisible().catch(() => false)) {
    await confirm.click()
  }

  await expect
    .poll(() => getTaskCount(token, a.assignmentUuid), { timeout: 10_000 })
    .toBe(0)
})
