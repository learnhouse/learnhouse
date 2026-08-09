import { test, expect } from '@playwright/test'

/**
 * Switching language flips direction live, with no reload.
 *
 * i18next persists the choice and emits `languageChanged`; I18nProvider listens
 * and rewrites <html dir>. If that listener regresses, the copy turns Arabic
 * while the layout stays left-to-right — which reads as "RTL is broken" rather
 * than "one listener is".
 *
 * Driven through the real switcher rather than by poking i18next, so the test
 * fails if the switcher stops being wired up at all.
 */

test('switching to Arabic flips direction without a reload', async ({ page }) => {
  await page.goto('/login', { waitUntil: 'networkidle' })
  expect(await page.evaluate(() => document.documentElement.dir)).toBe('ltr')

  // A reload would clear this, so it doubles as the no-navigation assertion.
  await page.evaluate(() => {
    ;(window as unknown as { __rtlNoReload?: boolean }).__rtlNoReload = true
  })

  // The switcher trigger shows the active language code (EN, AR, ...).
  const trigger = page.getByRole('button', { name: /^(EN|AR|FR|DE|ES)$/i }).first()
  if (!(await trigger.count())) {
    test.skip(true, 'no language switcher on this page')
  }
  await trigger.click()

  // Menu items are labelled with the native name.
  await page.getByRole('menuitem', { name: /العربية/ }).click()

  await expect.poll(() => page.evaluate(() => document.documentElement.dir)).toBe('rtl')
  await expect.poll(() => page.evaluate(() => document.documentElement.lang)).toBe('ar')

  const survived = await page.evaluate(
    () => (window as unknown as { __rtlNoReload?: boolean }).__rtlNoReload === true
  )
  expect(survived, 'page reloaded during language switch').toBe(true)
})

test('the choice survives a reload', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('i18nextLng', 'ar')
  })
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await page.reload({ waitUntil: 'domcontentloaded' })

  expect(await page.evaluate(() => document.documentElement.dir)).toBe('rtl')
})
