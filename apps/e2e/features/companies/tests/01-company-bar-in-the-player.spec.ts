/**
 * The company bar follows a learner from a company space into its courses,
 * but never into the activity player: the player has its own header (a small
 * company chip leads back to the space). Regression: the bar used to render
 * inside the focus player, under its header, covering the lesson.
 */
import { test, expect } from '../../../core/fixtures'
import { ADMIN_EMAIL, ADMIN_PASSWORD } from '../../../core/instance'
import { STUDENT_STATE, sharedStudent } from '../../../core/sharedAuth'
import { login, getOrg, companiesAvailable, seedCompanySpace, cleanupCompanySpace, type CompanySpace, type Org } from '../api'

test.use({ storageState: STUDENT_STATE })

let space: CompanySpace | null = null
let org: Org
let admin: string

test.beforeAll(async () => {
  admin = await login(ADMIN_EMAIL, ADMIN_PASSWORD)
  org = await getOrg()
  if (!(await companiesAvailable(admin, org))) return
  space = await seedCompanySpace(admin, org, `E2E company ${Date.now().toString(36)}`, sharedStudent().email)
})

test.afterAll(async () => {
  if (space) await cleanupCompanySpace(admin, org, space)
})

const short = (uuid: string, prefix: string) => uuid.replace(`${prefix}_`, '')

/** The lesson's top edge is on screen, below the header, and nothing covers it. */
async function expectLessonTopVisible(page: import('@playwright/test').Page, bodySelector: string, headerSelector: string) {
  const header = await page.locator(headerSelector).first().boundingBox()
  const body = await page.locator(bodySelector).first().boundingBox()
  expect(header).not.toBeNull()
  expect(body).not.toBeNull()
  expect(body!.y).toBeGreaterThanOrEqual(header!.y + header!.height - 1)
  expect(body!.y).toBeLessThan(page.viewportSize()!.height)
  const uncovered = await page.evaluate((sel) => {
    const el = document.querySelector(sel)
    if (!el) return false
    const r = el.getBoundingClientRect()
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + 8)
    return !!hit && el.contains(hit)
  }, bodySelector)
  expect(uncovered).toBe(true)
}

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  test.describe(`at ${viewport.width}px`, () => {
    test.use({ viewport })

    test('the activity player has no company bar and shows the lesson top', async ({ page }) => {
      test.skip(!space, 'company spaces need EE on the Pro plan')
      const s = space!
      const courseKey = short(s.courseUuid, 'course')
      const activityKey = short(s.activityUuid, 'activity')

      // The space, then its course: the bar is there.
      await page.goto(`/company/${s.slug}`)
      await expect(page.locator('[data-company-bar]')).toBeVisible()
      await page.locator(`[data-company-space] a[href*="/course/"]`).first().click()
      await expect(page).toHaveURL(/\/course\//)
      await expect(page.locator('[data-company-bar]')).toBeVisible()

      // Focus player: its own header, the company chip, no bar.
      await page.evaluate(() => {
        localStorage.setItem('globalFocusMode', 'true')
        localStorage.setItem('globalFocusModeMobile', 'true')
      })
      await page.goto(`/course/${courseKey}/activity/${activityKey}`)
      await expect(page.locator('.lh-focus-topbar')).toBeVisible()
      await expect(page.locator('.lh-focus-topbar [data-company-chip]:visible')).toBeVisible()
      await expect(page.locator('[data-company-bar]')).toHaveCount(0)
      await expect(page.locator('.lh-focus [data-company-bar]')).toHaveCount(0)
      await expectLessonTopVisible(page, '.lh-focus-body', '.lh-focus-topbar')

      // Regular player (focus off): still no bar, the chip sits in the header row.
      await page.evaluate(() => {
        localStorage.setItem('globalFocusMode', 'false')
        localStorage.setItem('globalFocusModeMobile', 'false')
      })
      await page.goto(`/course/${courseKey}/activity/${activityKey}`)
      await expect(page.locator('.activity-info-section')).toBeVisible()
      await expect(page.locator('[data-company-bar]')).toHaveCount(0)
      await expect(page.locator('[data-company-chip]:visible')).toHaveCount(1)
      await expectLessonTopVisible(page, '.activity-info-section', 'nav[aria-label]')

      // The chip leads back to the space, where the bar returns.
      await page.locator('[data-company-chip]:visible').click()
      await expect(page).toHaveURL(new RegExp(`/company/${s.slug}`))
      await expect(page.locator('[data-company-bar]')).toBeVisible()
    })
  })
}
