import type { Page } from '@playwright/test'
import { test, expect } from '../../../core/fixtures'
import { ADMIN_STATE } from '../../../core/sharedAuth'
import { admin, cleanup, createPage, raw } from '../api'

/**
 * The Website area and builder v2: the area itself, the template gallery,
 * applying three different templates from the builder, designed and saved
 * sections, the phone breakpoint, publishing, and the published page for a
 * logged-out visitor. Pages are e2e extras (cleaned up); the home page is only
 * read.
 */
test.describe.configure({ mode: 'serial' })
test.use({ storageState: ADMIN_STATE, viewport: { width: 1440, height: 900 } })

let token = ''
let orgId = 0

test.beforeAll(async () => {
  const a = await admin()
  token = a.token
  orgId = a.org.id
  await cleanup(token, orgId)
})
test.afterAll(async () => {
  await cleanup(token, orgId)
  const saved = (await raw('GET', `/landing/org/${orgId}/saved-sections`, token)).data || []
  for (const s of saved.filter((x: any) => x.name.startsWith('E2E'))) await raw('DELETE', `/landing/org/${orgId}/saved-sections/${s.section_uuid}`, token)
})

const getPage = async (uuid: string) => (await raw('GET', `/landing/pages/${uuid}`, token)).data

async function openBuilder(page: Page, uuid: string) {
  await page.goto(`/dash/org/landing-builder?page=${uuid}`)
  await expect(page.getByTestId('landing-builder')).toBeVisible({ timeout: 60_000 })
}

test('the Website area: sidebar entry, live preview, pages and the gallery', async ({ page }) => {
  await page.goto('/dash')
  await page.getByRole('link', { name: 'Website', exact: true }).first().click()
  await expect(page).toHaveURL(/\/dash\/website/)
  await expect(page.getByTestId('website-live-preview').locator('.lhp-root')).toBeVisible({ timeout: 60_000 })
  await expect(page.getByTestId('landing-page-row-home')).toBeVisible()
  const gallery = page.getByTestId('template-gallery')
  await gallery.scrollIntoViewIfNeeded()
  await expect(gallery.locator('[data-testid^=gallery-template-]')).toHaveCount(16)
  await page.getByTestId('gallery-cat-bootcamp').click()
  await expect(gallery.locator('[data-testid^=gallery-template-]')).toHaveCount(1)
  await page.getByTestId('gallery-cat-all').click()
  // The old settings tab sends people here.
  await page.goto('/dash/org/settings/landing')
  await expect(page).toHaveURL(/\/dash\/website/)
})

for (const [i, tpl] of (['academy', 'bootcamp', 'certification'] as const).entries()) {
  test(`apply the ${tpl} template from the builder gallery`, async ({ page }) => {
    const created = await createPage(token, orgId, `tpl-${i}`)
    await openBuilder(page, created.page_uuid)
    // An empty page opens the gallery.
    await expect(page.getByTestId('template-picker')).toBeVisible()
    await page.getByTestId(`gallery-template-${tpl}`).locator('button').first().click()
    await expect(page.getByTestId('template-preview').locator('.lhp-root')).toBeVisible({ timeout: 30_000 })
    if (tpl === 'bootcamp') await page.getByTestId('palette-org').click()
    await page.getByTestId('use-template').click()
    await expect(page.getByTestId('template-picker')).toBeHidden()
    await expect.poll(async () => (await getPage(created.page_uuid)).draft.root.length, { timeout: 15_000 }).toBeGreaterThan(4)
    const draft = (await getPage(created.page_uuid)).draft
    const fonts = { academy: 'Fraunces', bootcamp: 'Space Grotesk', certification: 'EB Garamond' }[tpl]
    expect([fonts, 'brand']).toContain(draft.theme.fonts.heading)
    await expect(page.getByTestId('landing-canvas').locator('.lhp-root')).toBeVisible()
  })
}

test('designed and saved sections, phone breakpoint, publish, logged-out view', async ({ page, browser }) => {
  const created = await createPage(token, orgId, 'sections', 'coach')
  await openBuilder(page, created.page_uuid)
  const before = (await getPage(created.page_uuid)).draft.root.length
  await page.getByTestId('library-tab-designed').click()
  await page.getByTestId('designed-template').selectOption('nonprofit')
  await page.getByTestId('designed-section-1').click()
  await expect.poll(async () => (await getPage(created.page_uuid)).draft.root.length, { timeout: 15_000 }).toBe(before + 1)
  // Save the inserted section to the library, then find it under Saved.
  await page.getByTestId('save-section').click()
  await page.getByTestId('save-section-name').fill('E2E impact band')
  await page.getByTestId('save-section-confirm').click()
  await page.getByTestId('library-tab-saved').click()
  await expect(page.getByTestId('saved-section-E2E impact band')).toBeVisible()
  await page.getByTestId('saved-section-E2E impact band').locator('[role=button]').click()
  await expect.poll(async () => (await getPage(created.page_uuid)).draft.root.length, { timeout: 15_000 }).toBe(before + 2)
  // Phone width: the canvas narrows and nothing scrolls sideways.
  await page.getByTestId('bp-mobile').click()
  const root = page.getByTestId('landing-canvas').locator('.lhp-root').first()
  await expect.poll(async () => (await root.boundingBox())?.width ?? 0).toBeLessThan(420)
  expect(await root.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
  await page.getByTestId('open-publish').click()
  await page.getByTestId('publish-confirm').click()
  await expect.poll(async () => (await getPage(created.page_uuid)).published_version).toBe(1)
  const visitor = await browser.newContext({ storageState: { cookies: [], origins: [] }, viewport: { width: 390, height: 844 } })
  const pub = await visitor.newPage()
  await pub.goto(`/p/${created.slug}`)
  await expect(pub.getByText('Do your best work without burning out.')).toBeVisible({ timeout: 60_000 })
  await expect(pub.getByText('Every course is free. Every year, more people finish one.').first()).toBeVisible()
  expect(await pub.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
  await visitor.close()
})

test('the public home still renders for visitors', async ({ browser }) => {
  // Legacy-converted or builder home: either way visitors get a rendered page.
  const visitor = await browser.newContext({ storageState: { cookies: [], origins: [] } })
  const pub = await visitor.newPage()
  await pub.goto('/')
  await expect(pub.locator('.lhp-root').first()).toBeVisible({ timeout: 60_000 })
  await visitor.close()
})
