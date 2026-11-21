/**
 * Every locale, RTL, and hostile environments:
 *  - all 22 UI locales render the learner pages without raw i18n keys;
 *  - RTL locales set dir=rtl and don't scroll sideways;
 *  - a slow network, going offline mid-activity, and blocked storage
 *    (Safari private mode, sandboxed embeds) don't crash the page.
 */
import { test, expect } from '../fixtures'
import { findRawI18nKeys, horizontalOverflow } from '../../../core/guard'
import { ADMIN_EMAIL, ADMIN_PASSWORD } from '../../../core/instance'
import * as api from '../api'

const LOCALES = ['ar', 'bn', 'de', 'en', 'es', 'fa', 'fr', 'hi', 'id', 'it', 'ja', 'ko', 'nl', 'pl', 'pt', 'ru', 'sk', 'th', 'tr', 'uk', 'vi', 'zh']
const RTL = new Set(['ar', 'fa'])

let seeded: { course: any; pages: any[] }

test.beforeAll(async () => {
  const admin = await api.login(ADMIN_EMAIL, ADMIN_PASSWORD)
  const org = await api.getOrg()
  seeded = await api.seedShortCourse(admin, org, { name: `Locales ${Date.now()}`, pages: 2 })
})

test('all locales: no raw i18n keys on learner pages; RTL lays out right', async ({ page, guard }, testInfo) => {
  test.setTimeout(600_000)
  const pages = ['/', '/courses', api.coursePath(seeded.course.course_uuid), api.activityPath(seeded.course.course_uuid, seeded.pages[0].activity_uuid), '/login', '/signup']
  const problems: string[] = []
  for (const lng of LOCALES) {
    await page.context().addCookies([{ name: 'i18next', value: lng, url: testInfo.project.use.baseURL ?? page.url() }])
    // Mark it as the visitor's own pick, or the org's default language wins.
    await page.addInitScript((l) => {
      try {
        localStorage.setItem('i18nextLng', l)
        localStorage.setItem('i18nextLng_userPicked', l)
      } catch { /* blocked */ }
    }, lng)
    for (const p of pages) {
      await page.goto(p)
      await page.waitForLoadState('networkidle').catch(() => undefined)
      const keys = await findRawI18nKeys(page)
      if (keys.length) problems.push(`${lng} ${p}: ${keys.slice(0, 5).join(', ')}`)
      if (RTL.has(lng)) {
        const dir = await page.evaluate(() => document.documentElement.dir)
        if (dir !== 'rtl') problems.push(`${lng} ${p}: dir=${dir || '(none)'}`)
      }
      const over = await horizontalOverflow(page)
      if (over > 1) problems.push(`${lng} ${p}: scrolls sideways by ${over}px`)
    }
  }
  expect(problems).toEqual([])
  await guard.check()
})

test('slow network: course and activity still load', async ({ page, guard }) => {
  await page.route('**/api/v1/**', async (route) => {
    await new Promise((r) => setTimeout(r, 800))
    await route.continue()
  })
  await page.goto(api.coursePath(seeded.course.course_uuid))
  await expect(page.getByText(seeded.course.name).filter({ visible: true }).first()).toBeVisible({ timeout: 45_000 })
  await page.goto(api.activityPath(seeded.course.course_uuid, seeded.pages[0].activity_uuid))
  await expect(page.getByText('Body of Page 1.')).toBeVisible({ timeout: 45_000 })
  await guard.check()
})

test('going offline mid-activity does not crash the page', async ({ page, context, guard }) => {
  await page.goto(api.activityPath(seeded.course.course_uuid, seeded.pages[0].activity_uuid))
  await expect(page.getByText('Body of Page 1.')).toBeVisible()
  await context.setOffline(true)
  // Client-side navigation to the next activity while offline.
  await page.getByRole('navigation', { name: /activity navigation/i }).getByRole('button').last().click().catch(() => undefined)
  await page.waitForTimeout(3000)
  await expect(page.getByText(/application error/i)).toHaveCount(0)
  await context.setOffline(false)
  await page.goto(api.activityPath(seeded.course.course_uuid, seeded.pages[1].activity_uuid))
  await expect(page.getByText('Body of Page 2.')).toBeVisible()
  await guard.check()
})

test('blocked cookies/storage (private mode): public pages still render', async ({ browser }, testInfo) => {
  const context = await browser.newContext({ ...testInfo.project.use })
  await context.addInitScript(() => {
    const deny = () => { throw new DOMException('The operation is insecure.', 'SecurityError') }
    for (const k of ['localStorage', 'sessionStorage'] as const) {
      Object.defineProperty(window, k, { get: deny, configurable: true })
    }
    Object.defineProperty(document, 'cookie', { get: () => '', set: () => undefined, configurable: true })
  })
  const page = await context.newPage()
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  for (const p of ['/', '/courses', api.coursePath(seeded.course.course_uuid), api.activityPath(seeded.course.course_uuid, seeded.pages[0].activity_uuid), '/login']) {
    await page.goto(p)
    await page.waitForTimeout(1500)
    await expect(page.getByText(/application error|something went wrong/i), p).toHaveCount(0)
  }
  await expect(page.getByText('Body of Page 1.')).toHaveCount(0) // last page is /login
  expect(errors.filter((e) => !/AbortError|Failed to fetch/i.test(e))).toEqual([])
  await context.close()
})

async function frameEmbed(page: import('@playwright/test').Page, baseURL: string, sandbox: string) {
  const url = `/embed/default/course/${api.stripPrefix(seeded.course.course_uuid)}/activity/${api.stripPrefix(seeded.pages[0].activity_uuid)}`
  // Host page served from a stub URL on the same host: browsers block a blank
  // page from framing a local address.
  await page.route('**/__sandbox-host', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><iframe id="f" sandbox="${sandbox}" style="width:900px;height:600px" src="${baseURL}${url}"></iframe>`,
    }),
  )
  await page.goto('/__sandbox-host')
  return page.frameLocator('#f')
}

test('sandboxed iframe embed (scripts + same origin) renders the activity', async ({ page, guard }, testInfo) => {
  const frame = await frameEmbed(page, String(testInfo.project.use.baseURL ?? ''), 'allow-scripts allow-same-origin')
  await expect(frame.getByText('Body of Page 1.')).toBeVisible({ timeout: 45_000 })
  await expect(frame.getByText(/application error/i)).toHaveCount(0)
  await guard.check()
})

test('sandboxed iframe embed without same origin fails cleanly, not blank', async ({ page }, testInfo) => {
  // An opaque origin has no cookies or storage and can't call the API with
  // credentials, so the activity can't load. It used to crash on the first
  // cookie read and leave an empty frame; it now shows the error page.
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  const frame = await frameEmbed(page, String(testInfo.project.use.baseURL ?? ''), 'allow-scripts')
  await expect(frame.getByText(/didn.t go as planned|something went wrong|try again/i).filter({ visible: true }).first()).toBeVisible({ timeout: 45_000 })
  expect(errors.filter((e) => /document\.cookie|'cookie' property/i.test(e))).toEqual([])
})
