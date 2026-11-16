/**
 * Settings > AI: an org admin turns single AI features (and AI as a whole) off
 * and on, and the entry points follow:
 *  - Ask AI off (from the settings page) -> the learner's lesson has no Ask AI.
 *  - AI Editor off -> the editor toolbar has no AI Editor button.
 *  - Master switch off -> Atlas leaves the dashboard sidebar (EE only).
 * Every switch is put back afterwards, and the seeded course is deleted.
 */
import { test, expect, type Browser, type Page } from '@playwright/test'
import { ADMIN_EMAIL, ADMIN_PASSWORD, BASE_URL } from '../../../core/instance'
import { ADMIN_STATE, STUDENT_STATE } from '../../../core/sharedAuth'
import {
  type AISettings,
  type Org,
  type SeededLesson,
  deleteCourse,
  getAISettings,
  getOrg,
  login,
  restoreAISettings,
  seedLesson,
  setAISettings,
} from '../api'

let token: string
let org: Org
let snapshot: AISettings
let lesson: SeededLesson

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  token = await login(ADMIN_EMAIL, ADMIN_PASSWORD)
  org = await getOrg()
  snapshot = await getAISettings(token, org.id)
  // Start from "everything on" so each test sees the default entry points.
  await setAISettings(token, org.id, {
    ai_enabled: true,
    features: { ask_ai: true, ai_editor: true, atlas: true },
    ask_ai_staff_only: false,
  })
  lesson = await seedLesson(token, org, `AI toggles ${Date.now().toString(36)}`)
})

test.afterAll(async () => {
  if (snapshot) await restoreAISettings(token, org.id, snapshot)
  if (lesson) await deleteCourse(token, lesson.courseUuid)
})

async function as(browser: Browser, state: string): Promise<Page> {
  const context = await browser.newContext({ storageState: state })
  return context.newPage()
}

test('Ask AI turned off in Settings > AI disappears from the learner lesson', async ({ browser }) => {
  const learner = await as(browser, STUDENT_STATE)
  await learner.goto(`${BASE_URL}${lesson.lessonPath}`)
  await expect(learner.getByTestId('ask-ai-button').first()).toBeVisible()

  const admin = await as(browser, ADMIN_STATE)
  await admin.goto(`${BASE_URL}/dash/org/settings/ai`)
  const askAI = admin.getByTestId('ai-switch-ask_ai')
  await expect(askAI).toHaveAttribute('data-state', 'checked')
  await askAI.click()
  await expect(askAI).toHaveAttribute('data-state', 'unchecked')
  await expect.poll(async () => (await getAISettings(token, org.id)).switches.ask_ai).toBe(false)

  await learner.reload()
  await expect(learner.getByText('Photosynthesis turns light into sugar.')).toBeVisible()
  await expect(learner.getByTestId('ask-ai-button')).toHaveCount(0)

  await askAI.click()
  await expect(askAI).toHaveAttribute('data-state', 'checked')
  await expect.poll(async () => (await getAISettings(token, org.id)).switches.ask_ai).toBe(true)
  await learner.reload()
  await expect(learner.getByTestId('ask-ai-button').first()).toBeVisible()
})

test('AI Editor turned off removes the editor button', async ({ browser }) => {
  const admin = await as(browser, ADMIN_STATE)
  await admin.goto(`${BASE_URL}${lesson.editorPath}`)
  await expect(admin.getByTestId('ai-editor-button')).toBeVisible({ timeout: 30_000 })

  await setAISettings(token, org.id, { features: { ai_editor: false } })
  await admin.reload()
  await expect(admin.locator('.activity-editor-doc-name')).toBeVisible({ timeout: 30_000 })
  await expect(admin.getByTestId('ai-editor-button')).toHaveCount(0)

  await setAISettings(token, org.id, { features: { ai_editor: true } })
  await admin.reload()
  await expect(admin.getByTestId('ai-editor-button')).toBeVisible({ timeout: 30_000 })
})

test('Master switch off hides Atlas from the dashboard', async ({ browser }) => {
  const admin = await as(browser, ADMIN_STATE)
  await admin.goto(`${BASE_URL}/dash`)
  const atlas = admin.locator('a[href="/dash/atlas"]')
  // Atlas ships with the enterprise code only.
  const hasAtlas = await atlas
    .first()
    .waitFor({ state: 'visible', timeout: 30_000 })
    .then(() => true)
    .catch(() => false)
  test.skip(!hasAtlas, 'Atlas is not part of this edition')

  await setAISettings(token, org.id, { ai_enabled: false })
  await admin.reload()
  await expect(admin.getByRole('link', { name: /courses/i }).first()).toBeVisible()
  await expect(atlas).toHaveCount(0)
  await admin.goto(`${BASE_URL}/dash/atlas`)
  await expect(admin.getByTestId('ai-off-notice')).toBeVisible()

  await setAISettings(token, org.id, { ai_enabled: true })
  await admin.goto(`${BASE_URL}/dash`)
  await expect(atlas.first()).toBeVisible()
})
