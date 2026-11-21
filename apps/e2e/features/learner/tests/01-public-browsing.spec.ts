/**
 * An anonymous visitor browsing the org: home, catalog, search, a public
 * course and its activities, and the pages that must stay closed to them.
 */
import { test, expect } from '../fixtures'
import { expectNoRawI18nKeys, horizontalOverflow } from '../../../core/guard'
import { ADMIN_EMAIL, ADMIN_PASSWORD } from '../../../core/instance'
import * as api from '../api'

let seeded: api.LearnerCourse
let privateCourse: any

test.beforeAll(async () => {
  const admin = await api.login(ADMIN_EMAIL, ADMIN_PASSWORD)
  const org = await api.getOrg()
  seeded = await api.seedLearnerCourse(admin, org, `Public browse ${Date.now()}`)
  privateCourse = (await api.seedShortCourse(admin, org, { name: `Private ${Date.now()}`, public: false })).course
})

test('home, catalog and search show the public course', async ({ page, guard }) => {
  await page.goto('/')
  await expect(page).toHaveTitle(/E2E Org|Home/)
  await expectNoRawI18nKeys(page, 'home')
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1)

  await page.goto('/courses')
  await expect(page.getByText(seeded.course.name).filter({ visible: true }).first()).toBeVisible()
  await expect(page.getByText(privateCourse.name)).toHaveCount(0)
  await expectNoRawI18nKeys(page, 'courses')
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1)

  await page.goto(`/search?q=${encodeURIComponent(seeded.course.name)}`)
  await expect(page.getByText(seeded.course.name).filter({ visible: true }).first()).toBeVisible()
  await guard.check()
})

test('public course page and its activities open without an account', async ({ page, guard }) => {
  await page.goto(api.coursePath(seeded.course.course_uuid))
  await expect(page.getByText(seeded.course.name).filter({ visible: true }).first()).toBeVisible()
  // Only the first chapter starts open.
  await page.getByRole('button', { name: /expand all chapters/i }).click()
  for (const name of ['Every block', 'Hosted video', 'PDF document', 'Lesson one']) {
    await expect(page.getByText(name).filter({ visible: true }).first()).toBeVisible()
  }
  await expectNoRawI18nKeys(page, 'course page')
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1)

  await page.goto(api.activityPath(seeded.course.course_uuid, seeded.pages[0].activity_uuid))
  await expect(page.getByText('Body of Lesson one.')).toBeVisible()
  // Anonymous visitors can read but not track progress.
  await expect(page.getByRole('checkbox', { name: /mark as complete/i })).toHaveCount(0)
  await expectNoRawI18nKeys(page, 'activity')
  await guard.check()
})

test('private course content is not readable anonymously', async ({ page }) => {
  const res = await page.goto(api.coursePath(privateCourse.course_uuid))
  expect(res?.status() ?? 200).toBeLessThan(500)
  await expect(page.getByText('Body of Page 1.')).toHaveCount(0)
})

test('certificate verify page handles an unknown id', async ({ page, guard }) => {
  await page.goto('/certificates/does-not-exist/verify')
  await expect(page.getByText(/not found|invalid|no valid/i).filter({ visible: true }).first()).toBeVisible()
  await expectNoRawI18nKeys(page, 'certificate verify')
  await guard.check()
})

test('member pages send anonymous visitors to login', async ({ page }) => {
  for (const p of ['/trail', '/account/general']) {
    await page.goto(p)
    await expect(page, `${p} should require login`).toHaveURL(/\/login\?redirect=/)
  }
  // Notifications explains itself and links to login instead of redirecting.
  await page.goto('/notifications')
  await expect(page.getByRole('link', { name: /sign in|log in/i })).toHaveAttribute('href', /\/login\?redirect=/)
})

test('unknown course shows a not-found page, not a crash', async ({ page, guard }) => {
  const res = await page.goto('/course/00000000-0000-0000-0000-000000000000')
  expect(res?.status() ?? 404).toBeLessThan(500)
  await expect(page.getByText(/not found|doesn.t exist|404|could not|unavailable/i).filter({ visible: true }).first()).toBeVisible()
  await guard.check()
})

test('route aliases redirect instead of rendering a client redirect', async ({ request }) => {
  for (const [from, to] of [['/plays', '/playgrounds'], ['/copilot', '/messages']]) {
    const res = await request.get(from, { maxRedirects: 0 })
    expect(res.status(), from).toBe(307)
    expect(res.headers()['location'] ?? '', from).toContain(to)
  }
})
