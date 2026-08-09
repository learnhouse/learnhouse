import { test, expect } from '@playwright/test'
import { ORG_SLUG } from '../../../core/instance'

/**
 * Direction must be right on the FIRST paint, not after hydration.
 *
 * The server can't know the language: i18next detects from localStorage, which
 * is client-only. So a blocking <head> script sets <html dir> before the body
 * paints. If that regresses the app still works — it just flashes a
 * left-to-right layout first, which is the kind of bug that survives review.
 */

const ROUTES = ['/', `/org/${ORG_SLUG}`, '/login']

test.describe('dir on first paint', () => {
  for (const route of ROUTES) {
    test(`localStorage locale applies before paint on ${route}`, async ({ page }) => {
      // Seed the same key i18next reads, before any page script runs.
      await page.addInitScript(() => {
        window.localStorage.setItem('i18nextLng', 'ar')
      })

      // Deliberately NOT networkidle: waiting for idle would step past the
      // window this test exists to check.
      await page.goto(route, { waitUntil: 'domcontentloaded' })

      const dir = await page.evaluate(() => document.documentElement.getAttribute('dir'))
      expect(dir).toBe('rtl')

      const lang = await page.evaluate(() => document.documentElement.getAttribute('lang'))
      expect(lang).toBe('ar')
    })
  }

  test('querystring locale applies before paint', async ({ page }) => {
    await page.goto('/?lng=ar', { waitUntil: 'domcontentloaded' })
    await expect
      .poll(() => page.evaluate(() => document.documentElement.getAttribute('dir')))
      .toBe('rtl')
  })

  test('English stays left-to-right', async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem('i18nextLng', 'en')
    })
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    const dir = await page.evaluate(() => document.documentElement.getAttribute('dir'))
    expect(dir).toBe('ltr')
  })
})
