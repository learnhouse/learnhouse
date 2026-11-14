import type { Page } from '@playwright/test'
import { test, expect } from '../../../core/fixtures'
import { ADMIN_STATE } from '../../../core/sharedAuth'
import { admin, cleanup, createPage, publish } from '../api'

/**
 * Published pages for visitors and members at each breakpoint, in OS dark
 * mode and right-to-left: nothing overflows, colors stay as designed.
 */
test.describe.configure({ mode: 'serial' })

let token = ''
let orgId = 0
let slug = ''
let darkSlug = ''

test.beforeAll(async () => {
  const a = await admin()
  token = a.token
  orgId = a.org.id
  await cleanup(token, orgId)
  const page = await createPage(token, orgId, 'public', 'school')
  await publish(token, page.page_uuid)
  slug = page.slug
  const dark = await createPage(token, orgId, 'public-dark', 'launch')
  await publish(token, dark.page_uuid)
  darkSlug = dark.slug
})
test.afterAll(async () => cleanup(token, orgId))

async function load(page: Page, path: string) {
  await page.goto(path)
  await expect(page.locator('.lhp-root')).toBeVisible({ timeout: 60_000 })
  await page.waitForTimeout(500)
}
const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)

for (const width of [1440, 2000, 768, 390]) {
  test(`visitor at ${width}px: no overflow, nav button readable`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await load(page, `/p/${slug}`)
    expect(await overflow(page)).toBeLessThanOrEqual(1)
    const cta = page.locator('.lhp-root .lhp-btn[data-variant=primary]').first()
    const [fg, bg] = await cta.evaluate((el: Element) => [getComputedStyle(el).color, getComputedStyle(el).backgroundColor])
    expect(fg).not.toBe(bg)
  })
}

test.describe('member', () => {
  test.use({ storageState: ADMIN_STATE })
  for (const width of [1440, 390]) {
    test(`member at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
      await load(page, `/p/${slug}`)
      expect(await overflow(page)).toBeLessThanOrEqual(1)
    })
  }
})

test.describe('OS dark', () => {
  test.use({ colorScheme: 'dark' })
  test('a light page stays light', async ({ page }) => {
    await load(page, `/p/${slug}`)
    await expect(page.locator('.lhp-root')).toHaveCSS('color-scheme', 'light')
    await expect(page.locator('.lhp-root')).toHaveCSS('background-color', 'rgb(255, 255, 255)')
  })
  test('a page designed dark says so (native controls match)', async ({ page }) => {
    await load(page, `/p/${darkSlug}`)
    await expect(page.locator('.lhp-root')).toHaveCSS('color-scheme', 'dark')
  })
})

test('right-to-left: the page mirrors without overflow', async ({ page, context, baseURL }) => {
  await context.addCookies([{ name: 'i18next', value: 'ar', url: baseURL! }])
  await page.addInitScript(() => {
    window.localStorage.setItem('i18nextLng', 'ar')
    window.localStorage.setItem('i18nextLng_userPicked', 'ar')
  })
  await page.setViewportSize({ width: 390, height: 844 })
  await load(page, `/p/${slug}`)
  expect(await page.evaluate(() => document.documentElement.dir)).toBe('rtl')
  expect(await overflow(page)).toBeLessThanOrEqual(1)
})

test('the home page always renders for visitors', async ({ page }) => {
  await load(page, '/')
  await expect(page.locator('.lhp-root section').first()).toBeVisible()
})
