import { test, expect } from '@playwright/test'
import { ORG_SLUG } from '../../../core/instance'

/**
 * The cheapest way to catch a physical margin that escaped the logical-property
 * sweep: in RTL it pushes content past the viewport edge, so the document
 * scrolls sideways. Cheaper and far more durable than screenshot baselines.
 *
 * Each route is checked in both directions, so a failure points at RTL rather
 * than at a layout that was already overflowing.
 */

const ROUTES = [
  { name: 'home', path: '/' },
  { name: 'org home', path: `/org/${ORG_SLUG}` },
  { name: 'login', path: '/login' },
  { name: 'signup', path: '/signup' },
]

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
]

async function horizontalOverflow(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const el = document.documentElement
    // +1 absorbs sub-pixel rounding, which is not a layout bug.
    return el.scrollWidth - el.clientWidth
  })
}

for (const viewport of VIEWPORTS) {
  test.describe(`no horizontal overflow (${viewport.name})`, () => {
    for (const route of ROUTES) {
      for (const lng of ['en', 'ar'] as const) {
        test(`${route.name} in ${lng}`, async ({ page }) => {
          await page.setViewportSize({ width: viewport.width, height: viewport.height })
          await page.addInitScript((code) => {
            window.localStorage.setItem('i18nextLng', code as string)
          }, lng)

          await page.goto(route.path, { waitUntil: 'networkidle' })

          const overflow = await horizontalOverflow(page)
          expect(
            overflow,
            `${route.path} overflows horizontally by ${overflow}px in ${lng}`
          ).toBeLessThanOrEqual(1)
        })
      }
    }
  })
}
