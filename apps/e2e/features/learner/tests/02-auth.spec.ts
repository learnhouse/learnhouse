/**
 * Getting in and out as a learner: email signup, login, a wrong password,
 * forgot/reset password and magic link (via Mailpit), and 2FA.
 * Each test uses its own fresh account so they can run in any order.
 */
import { test, expect } from '../fixtures'
import { expectNoRawI18nKeys } from '../../../core/guard'
import { ADMIN_EMAIL, ADMIN_PASSWORD, makeStudent } from '../../../core/instance'
import * as api from '../api'
import { MAILPIT_URL, latestMailTo, linkIn } from '../mail'
import { totp } from '../totp'

async function fillLogin(page: import('@playwright/test').Page, email: string, password: string) {
  await page.goto('/login')
  // Typing before hydration is lost when React takes over the form (slow
  // phones especially), so wait for the page to settle first.
  await page.waitForLoadState('networkidle').catch(() => undefined)
  await page.getByRole('textbox', { name: 'Email' }).fill(email)
  await page.getByRole('textbox', { name: 'Password' }).fill(password)
  await page.getByRole('button', { name: 'Login', exact: true }).click()
}

const leftLogin = (u: URL) => !/\/(login|auth\/login)(\?|$)/.test(u.pathname + u.search)

/**
 * Wait until the page has left a URL. Polls instead of page.waitForURL, which
 * throws on Firefox (NS_BINDING_ABORTED) when one step of the post-login
 * redirect chain cancels the previous one.
 */
async function waitUntilUrl(page: import('@playwright/test').Page, ok: (u: URL) => boolean, timeout = 20_000) {
  await expect.poll(() => ok(new URL(page.url())), { timeout }).toBe(true)
  await page.waitForLoadState('networkidle').catch(() => undefined)
}

test('sign up with email, log in, log out, log back in', async ({ page, guard }) => {
  const s = makeStudent('signup')
  await page.goto('/signup')
  await expectNoRawI18nKeys(page, 'signup')
  await page.getByRole('textbox', { name: /email/i }).fill(s.email)
  await page.getByRole('textbox', { name: /name/i }).first().fill('Signup Learner')
  await page.locator('input[type="password"]').first().fill(s.password)
  await page.getByRole('button', { name: /create|sign up/i }).last().click()
  // Signup confirms the account (no email verification on this instance) and
  // offers the login button.
  await expect(page.getByText(/account was successfully created/i)).toBeVisible({ timeout: 30_000 })
  await expectNoRawI18nKeys(page, 'signup success')
  await page.getByRole('button', { name: /login/i }).or(page.getByRole('link', { name: /login/i })).first().click()
  await expect(page).toHaveURL(/\/login/)
  await page.getByRole('textbox', { name: 'Email' }).fill(s.email)
  await page.getByRole('textbox', { name: 'Password' }).fill(s.password)
  await page.getByRole('button', { name: 'Login', exact: true }).click()
  await waitUntilUrl(page, leftLogin, 20_000)
  // Let the post-login redirect finish before navigating away from it.
  await page.waitForLoadState('networkidle').catch(() => undefined)
  // Signed in: the trail (members only) opens.
  await page.goto('/trail')
  await expect(page).not.toHaveURL(/\/login/)

  await page.context().clearCookies()
  await page.goto('/trail')
  await expect(page).toHaveURL(/\/login/)

  await fillLogin(page, s.email, s.password)
  await waitUntilUrl(page, leftLogin, 20_000)
  await guard.check()
})

test('wrong password shows an error and stays on login', async ({ page, guard }) => {
  guard.allow(/\/api\/auth\/login/)
  await fillLogin(page, ADMIN_EMAIL, 'definitely-not-it-1A!')
  await expect(page.getByText(/wrong email or password|invalid|incorrect/i).filter({ visible: true }).first()).toBeVisible()
  await expect(page).toHaveURL(/\/login/)
  await expectNoRawI18nKeys(page, 'login error')
})

test.describe('email flows', () => {
  test.skip(!MAILPIT_URL, 'E2E_MAILPIT_URL not set')

  test('forgot password → email → reset → log in with the new password', async ({ page, guard }) => {
    const admin = await api.login(ADMIN_EMAIL, ADMIN_PASSWORD)
    const org = await api.getOrg()
    const s = await api.freshStudent(admin, org, 'reset')
    const since = Date.now()
    await page.goto('/forgot')
    await expectNoRawI18nKeys(page, 'forgot')
    await page.getByRole('textbox', { name: /email/i }).fill(s.email)
    await page.getByRole('button', { name: /send|reset/i }).first().click()
    await expect(page.getByText(/check your email|sent|inbox/i).filter({ visible: true }).first()).toBeVisible()

    const mail = await latestMailTo(s.email, since)
    await page.goto(linkIn(mail, /reset/))
    await expectNoRawI18nKeys(page, 'reset')
    const newPw = 'NewE2ePass!789'
    const pw = page.locator('input[type="password"]')
    await pw.nth(0).fill(newPw)
    await pw.nth(1).fill(newPw)
    await page.getByRole('button', { name: /change password|reset/i }).first().click()
    await expect(page.getByText(/changed|success|log ?in again/i).filter({ visible: true }).first()).toBeVisible()

    await fillLogin(page, s.email, newPw)
    await waitUntilUrl(page, leftLogin, 20_000)
    await guard.check()
  })

  test('magic link signs the learner in', async ({ page, guard }) => {
    const admin = await api.login(ADMIN_EMAIL, ADMIN_PASSWORD)
    const org = await api.getOrg()
    const s = await api.freshStudent(admin, org, 'magic')
    const since = Date.now()
    await page.goto('/login')
    await page.getByRole('button', { name: /email me a login link/i }).click()
    await page.getByRole('textbox', { name: /email/i }).last().fill(s.email)
    await page.getByRole('button', { name: /send|email me/i }).last().click()
    await expect(page.getByText(/check your (email|inbox)|sent/i).filter({ visible: true }).first()).toBeVisible()

    const mail = await latestMailTo(s.email, since)
    await page.goto(linkIn(mail, /magic|token=/))
    await waitUntilUrl(page, (u) => !/\/auth\/magic|\/login/.test(u.pathname), 30_000)
    await page.goto('/trail')
    await expect(page).not.toHaveURL(/\/login/)
    await guard.check()
  })
})

test('2FA: login asks for the authenticator code and accepts it', async ({ page, guard }) => {
  const admin = await api.login(ADMIN_EMAIL, ADMIN_PASSWORD)
  const org = await api.getOrg()
  const s = await api.freshStudent(admin, org, 'mfa')
  const tok = await api.login(s.email, s.password)
  const setup = await api.req<any>('POST', '/auth/mfa/setup', tok, { password: s.password })
  await api.req('POST', '/auth/mfa/confirm', tok, { code: totp(setup.secret) })

  await fillLogin(page, s.email, s.password)
  const code = page.getByRole('textbox').first()
  await expect(page.getByText(/authenticator|verification code|two-factor|2fa/i).filter({ visible: true }).first()).toBeVisible()
  await expectNoRawI18nKeys(page, 'mfa challenge')
  // Wait for a fresh window so the code isn't the one used to confirm.
  await page.waitForTimeout(1000 * (31 - (Math.floor(Date.now() / 1000) % 30)))
  await code.fill(totp(setup.secret))
  const verify = page.getByRole('button', { name: /verify|continue|confirm/i }).first()
  if (await verify.isEnabled().catch(() => false)) await verify.click().catch(() => {})
  await waitUntilUrl(page, leftLogin, 30_000)
  await page.goto('/trail')
  await expect(page).not.toHaveURL(/\/login/)
  await guard.check()
})
