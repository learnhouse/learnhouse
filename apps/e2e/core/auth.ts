/**
 * UI auth helpers — log in / out through the real login form, like a human.
 *
 * Selectors are taken from the running (published-image) UI:
 *  - /login renders textboxes labelled "Email" and "Password" and a "Login" button.
 */
import { Page, expect } from '@playwright/test'
import { BASE_URL } from './instance'

export async function uiLogin(page: Page, email: string, password: string): Promise<void> {
  // The API rate-limits logins per IP (30 / 5 min). A big suite can brush that
  // ceiling, so if a login attempt doesn't leave /login (rate-limited or a
  // transient error) we wait for the window to ease and retry.
  const maxAttempts = 3
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    await page.goto(`${BASE_URL}/login`)
    await page.getByRole('textbox', { name: 'Email' }).fill(email)
    await page.getByRole('textbox', { name: 'Password' }).fill(password)
    await page.getByRole('button', { name: 'Login', exact: true }).click()
    try {
      // On success the app leaves /login (lands on the org home or dashboard).
      await expect(page).not.toHaveURL(/\/login(\?|$)/, { timeout: 12_000 })
      return
    } catch {
      if (attempt === maxAttempts) {
        throw new Error(`uiLogin failed for ${email} after ${maxAttempts} attempts (still on /login)`)
      }
      await page.waitForTimeout(15_000)
    }
  }
}

export async function uiLogout(page: Page): Promise<void> {
  // Clearing cookies + storage is the most reliable cross-view logout.
  await page.context().clearCookies()
  await page.goto(`${BASE_URL}/`)
  await page.evaluate(() => {
    try {
      localStorage.clear()
    } catch {
      /* ignore */
    }
  })
}
