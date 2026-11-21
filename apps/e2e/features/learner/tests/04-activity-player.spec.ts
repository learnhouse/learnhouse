/**
 * The activity player against every activity type a learner meets:
 * a dynamic page with every block, a hosted video, a YouTube video and a PDF.
 */
import { test, expect } from '../fixtures'
import { expectNoRawI18nKeys, horizontalOverflow } from '../../../core/guard'
import { ADMIN_EMAIL, ADMIN_PASSWORD } from '../../../core/instance'
import { STUDENT_STATE, sharedStudent } from '../../../core/sharedAuth'
import { FLIP_ANSWER, FLIP_QUESTION, QUIZ_QUESTION, QUIZ_RIGHT, QUIZ_WRONG } from '../content'
import * as api from '../api'

test.use({ storageState: STUDENT_STATE })

let seeded: api.LearnerCourse

test.beforeAll(async () => {
  const admin = await api.login(ADMIN_EMAIL, ADMIN_PASSWORD)
  const org = await api.getOrg()
  seeded = await api.seedLearnerCourse(admin, org, `Player ${Date.now()}`)
  await api.enroll(await api.login(sharedStudent().email, sharedStudent().password), seeded.course.course_uuid)
})

test('dynamic page renders every block type', async ({ page, guard }) => {
  // Third-party embeds can't load in a sandboxed run.
  guard.allow(/youtube|learnhouse\.app/)
  await page.goto(api.activityPath(seeded.course.course_uuid, seeded.blocks.activity_uuid))
  await expect(page.getByRole('heading', { name: 'Every block' }).first()).toBeVisible()
  for (const t of [
    'A plain paragraph',
    'First bullet',
    'Step one',
    'A quote worth remembering.',
    'Learning management system',
    'An info callout.',
    'A warning callout.',
    'A badge',
    'A button',
    'The end.',
  ]) {
    await expect(page.getByText(t).first(), t).toBeVisible()
  }
  await expect(page.locator('pre, code').filter({ hasText: 'def hello' }).first()).toBeVisible()
  // KaTeX renders the equation.
  await expect(page.locator('.katex').first()).toBeVisible()
  await expectNoRawI18nKeys(page, 'every block')
  expect(await horizontalOverflow(page), 'page should not scroll sideways').toBeLessThanOrEqual(1)
  await guard.check()
})

test('quiz: wrong then right answer, with feedback', async ({ page, guard }) => {
  guard.allow(/youtube|learnhouse\.app/)
  await page.goto(api.activityPath(seeded.course.course_uuid, seeded.blocks.activity_uuid))
  const quiz = page.locator('[data-node-view-wrapper], .react-renderer').filter({ hasText: QUIZ_QUESTION }).first()
  await quiz.scrollIntoViewIfNeeded()
  await expect(quiz.getByText(QUIZ_QUESTION)).toBeVisible()
  await quiz.getByText(QUIZ_WRONG, { exact: true }).click()
  await quiz.getByRole('button', { name: /submit|check/i }).first().click()
  await expect(quiz.getByText(/incorrect|not quite|wrong|try again|0\s*\/\s*1/i).filter({ visible: true }).first()).toBeVisible()
  const retry = quiz.getByRole('button', { name: /retry|try again|reset/i }).first()
  await retry.click()
  await quiz.getByText(QUIZ_RIGHT, { exact: true }).click()
  await quiz.getByRole('button', { name: /submit|check/i }).first().click()
  await expect(quiz.getByText(/correct|well done|1\s*\/\s*1|100/i).filter({ visible: true }).first()).toBeVisible()
  await guard.check()
})

test('flipcard reveals its answer', async ({ page, guard }) => {
  guard.allow(/youtube|learnhouse\.app/)
  await page.goto(api.activityPath(seeded.course.course_uuid, seeded.blocks.activity_uuid))
  const card = page.getByText(FLIP_QUESTION).first()
  await card.scrollIntoViewIfNeeded()
  await card.click()
  await expect(page.getByText(FLIP_ANSWER).filter({ visible: true }).first()).toBeVisible()
  await guard.check()
})

test('hosted video loads and plays', async ({ page, guard }) => {
  await page.goto(api.activityPath(seeded.course.course_uuid, seeded.video.activity_uuid))
  const video = page.locator('video').first()
  await expect(video).toBeAttached({ timeout: 30_000 })
  await expect
    .poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState), { timeout: 30_000 })
    .toBeGreaterThanOrEqual(1)
  // Start playback the way a learner would: click/tap the player.
  await video.evaluate((v: HTMLVideoElement) => {
    v.muted = true
    return v.play().catch(() => undefined)
  })
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime), { timeout: 20_000 }).toBeGreaterThan(0)
  await expectNoRawI18nKeys(page, 'video')
  await guard.check()
})

test('PDF document renders', async ({ page, guard }) => {
  await page.goto(api.activityPath(seeded.course.course_uuid, seeded.pdf.activity_uuid))
  const viewer = page.locator('iframe, embed, object, canvas, .react-pdf__Page').first()
  await expect(viewer).toBeVisible({ timeout: 30_000 })
  await expectNoRawI18nKeys(page, 'pdf')
  await guard.check()
})

test('YouTube activity embeds the player', async ({ page, guard }) => {
  guard.allow(/youtube|ytimg|google/)
  await page.goto(api.activityPath(seeded.course.course_uuid, seeded.youtube.activity_uuid))
  // A click-to-load poster stands in until the learner presses play.
  const play = page.getByRole('button', { name: /play video/i }).first()
  await expect(play).toBeVisible({ timeout: 30_000 })
  await play.click()
  await expect(page.locator('iframe[src*="youtube"]').first()).toBeAttached({ timeout: 30_000 })
  await guard.check()
})

test('keyboard: the activity navigation is reachable with Tab', async ({ page, browserName }) => {
  // Safari only tabs to buttons and links with Option+Tab (unless the user
  // turned on "Press Tab to highlight each item").
  const tabKey = browserName === 'webkit' ? 'Alt+Tab' : 'Tab'
  await page.goto(api.activityPath(seeded.course.course_uuid, seeded.pages[0].activity_uuid))
  await expect(page.getByText('Body of Lesson one.')).toBeVisible()
  const target = page.getByRole('checkbox', { name: /mark as complete/i }).first()
  let reached = false
  for (let i = 0; i < 60 && !reached; i++) {
    await page.keyboard.press(tabKey)
    reached = await target.evaluate((el) => el === document.activeElement).catch(() => false)
  }
  expect(reached, 'Mark as complete should be focusable by keyboard').toBe(true)
  // Enter completes the page and moves on to the next one.
  await page.keyboard.press('Enter')
  await expect(page.getByText('Body of Lesson two.')).toBeVisible()
  const stu = await api.login(sharedStudent().email, sharedStudent().password)
  await expect
    .poll(async () => ((await api.getRun(stu, seeded.course.course_uuid))?.steps ?? []).length)
    .toBeGreaterThanOrEqual(1)
})
