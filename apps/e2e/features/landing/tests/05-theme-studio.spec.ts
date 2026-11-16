import { test, expect } from '../../../core/fixtures'
import { ADMIN_STATE } from '../../../core/sharedAuth'
import { ORG_SLUG } from '../../../core/instance'
import { admin, raw } from '../api'

/**
 * The theme studio: a preset, a font pairing and a color change saved from
 * Branding → Theme reach the public pages (data attributes and tokens on the
 * theme root). The org's theme is put back exactly as it was afterwards.
 */
test.describe.configure({ mode: 'serial' })
test.use({ storageState: ADMIN_STATE, viewport: { width: 1440, height: 900 } })

let token = ''
let orgId = 0
let original: any = null

function themeOf(org: any) {
  const c = org?.config?.config || {}
  const general = c.customization?.general || c.general || {}
  return { color: general.color || '', font: general.font || '', theme: c.customization?.theme || c.general?.theme || {} }
}

test.beforeAll(async () => {
  const a = await admin()
  token = a.token
  orgId = a.org.id
  original = themeOf(a.org)
})
test.afterAll(async () => {
  if (original) await raw('PUT', `/orgs/${orgId}/config/theme`, token, original)
})

test('preset + pairing + color from the studio reach the public pages', async ({ page, browser }) => {
  await page.goto('/dash/org/settings/branding')
  await expect(page.getByTestId('theme-studio')).toBeVisible({ timeout: 60_000 })
  await page.getByTestId('studio-preset-atelier').click()
  await page.getByTestId('studio-font').selectOption('humanist')
  // Everything beyond the essentials sits behind one "More options" section.
  await expect(page.getByTestId('studio-header-layout')).toHaveCount(0)
  await page.getByTestId('studio-more').click()
  await page.getByTestId('studio-header-layout').locator('[data-value=centered]').click()
  await page.getByTestId('studio-scheme-dark').click()
  await expect(page.getByTestId('studio-preview-dark')).toBeVisible()
  // A pale brand color warns once, inline.
  await expect(page.getByTestId('studio-contrast')).toHaveCount(0)
  await page.getByRole('button', { name: /save/i }).last().click()
  await expect.poll(async () => {
    const orgs = (await raw("GET", `/orgs/slug/${ORG_SLUG}`, token)).data
    return themeOf(orgs).theme.header_layout
  }, { timeout: 15_000 }).toBe('centered')
  const visitor = await browser.newContext({ storageState: { cookies: [], origins: [] } })
  const pub = await visitor.newPage()
  await pub.goto('/courses')
  const root = pub.locator('.lh-theme').first()
  await expect(root).toHaveAttribute('data-lh-header', 'centered', { timeout: 60_000 })
  await expect(root).toHaveAttribute('data-lh-neutral', 'warm')
  await expect(root).toHaveAttribute('data-lh-img', 'framed')
  expect(await root.evaluate((el) => (el as HTMLElement).style.getPropertyValue('--lh-font-heading'))).toContain('Sora')
  await visitor.close()
})
