import type { Page } from '@playwright/test'
import { test, expect } from '../../../core/fixtures'
import { ADMIN_STATE } from '../../../core/sharedAuth'
import { admin, cleanup, createPage, raw } from '../api'

/**
 * The builder like a member uses it: adding elements (where they land),
 * fonts with live preview, breakpoints, publish, and OS dark mode leaving
 * the canvas alone.
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
test.afterAll(async () => cleanup(token, orgId))

const canvas = (page: Page) => page.getByTestId('landing-canvas')

async function openBuilder(page: Page, uuid: string) {
  await page.goto(`/dash/org/landing-builder?page=${uuid}`)
  await expect(page.getByTestId('landing-builder')).toBeVisible({ timeout: 60_000 })
}

async function draft(uuid: string) {
  // Autosave runs shortly after an edit.
  await expect.poll(async () => (await raw('GET', `/landing/pages/${uuid}`, token)).data.draft_revision, { timeout: 15_000 }).toBeGreaterThan(1)
  return (await raw('GET', `/landing/pages/${uuid}`, token)).data.draft
}

const types = (n: any): string[] => [n.type, ...(n.children || []).flatMap(types)]

test('a navbar goes to the top, a footer to the bottom, others get a styled section', async ({ page }) => {
  const created = await createPage(token, orgId, 'insert')
  await openBuilder(page, created.page_uuid)
  await page.getByRole('button', { name: 'Blank page' }).click()
  await page.getByRole('button', { name: 'Elements', exact: true }).click()
  await page.getByTestId('library-element-heading').click()
  await page.getByTestId('library-element-footer').click()
  await page.getByTestId('library-element-newsletter').click()
  await page.getByTestId('library-element-navbar').click()
  const doc = await draft(created.page_uuid)
  const roots = doc.root.map((s: any) => types(s))
  expect(roots[0]).toContain('navbar')
  expect(roots[roots.length - 1]).toContain('footer')
  // The newsletter came with its ready-made section (heading + text + form), not bare.
  const news = doc.root.find((s: any) => types(s).includes('newsletter'))
  expect(types(news)).toEqual(expect.arrayContaining(['section', 'container', 'heading', 'newsletter']))
  // Every element sits in a container, never straight in a section.
  for (const s of doc.root) for (const c of s.children || []) expect(['container', 'columns']).toContain(c.type)
  // On the canvas the nav CTA text is readable (not the link color on a dark button).
  const cta = canvas(page).locator('.lhp-nav .lhp-btn[data-variant=primary]').first()
  const [fg, bg] = await cta.evaluate((el: Element) => [getComputedStyle(el).color, getComputedStyle(el).backgroundColor])
  expect(fg).not.toBe(bg)
})

test('fonts: pick, pair and per element, with live preview', async ({ page }) => {
  const created = await createPage(token, orgId, 'fonts', 'minimal')
  await openBuilder(page, created.page_uuid)
  await page.getByTestId('theme-font-heading').click()
  await page.getByPlaceholder('Search fonts').fill('fraun')
  await page.locator('[data-font="Fraunces"]').click()
  await expect(canvas(page).locator('h1, h2').first()).toHaveCSS('font-family', /Fraunces/)
  await page.getByTestId('font-pairing').filter({ hasText: 'Instrument Serif' }).click()
  await expect(canvas(page).locator('h1, h2').first()).toHaveCSS('font-family', /Instrument Serif/)
  // System fonts load nothing from Google.
  await page.getByTestId('theme-font-body').click()
  await page.locator('[data-font="System Sans"]').click()
  const d = await draft(created.page_uuid)
  expect(d.theme.fonts).toEqual({ heading: 'Instrument Serif', body: 'System Sans' })
  // An element's own font.
  await canvas(page).locator('h1, h2').first().click()
  await page.getByTestId('inspector').getByRole('radio', { name: 'Style' }).click()
  await page.getByTestId('style-font').click()
  await page.locator('[data-font="JetBrains Mono"]').click()
  await expect(canvas(page).locator('h1, h2').first()).toHaveCSS('font-family', /JetBrains Mono/)
})

test('breakpoints switch the canvas and publish puts the page live', async ({ page }) => {
  const created = await createPage(token, orgId, 'publish-ui', 'school')
  await openBuilder(page, created.page_uuid)
  for (const bp of ['tablet', 'mobile', 'base']) {
    await page.getByTestId(`bp-${bp}`).click()
    await expect(page.getByTestId(`bp-${bp}`)).toHaveAttribute('aria-checked', 'true')
  }
  await page.getByTestId('open-publish').click()
  await page.getByTestId('publish-confirm').click()
  await expect.poll(async () => (await raw('GET', `/landing/pages/${created.page_uuid}`, token)).data.published_version).toBe(1)
})

test.describe('OS dark mode', () => {
  test.use({ colorScheme: 'dark' })
  test('does not change the canvas', async ({ page }) => {
    const created = await createPage(token, orgId, 'dark-canvas', 'minimal')
    await openBuilder(page, created.page_uuid)
    const root = canvas(page).locator('.lhp-root')
    await expect(root).toHaveCSS('color-scheme', 'light')
    await expect(root).toHaveCSS('background-color', 'rgb(255, 255, 255)')
  })
})
