/**
 * Recorded walkthrough of the landing builder's advanced options: the Launch
 * template (announcement, countdown, steps, columns, pricing), hero size and
 * overlay, per-section devices / schedule / animation, page settings, and
 * JSON export.
 *
 * A *demo*, not a test (see `landing-course-end-demo.ts` for the conventions).
 *
 *   bun run demo/landing-builder-advanced-demo.ts   # -> demo/output/<name>.webm
 */
import { fileURLToPath } from 'node:url'
import { mkdirSync, renameSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { chromium, Browser, BrowserContext, Page } from '@playwright/test'

import { ADMIN_EMAIL, ADMIN_PASSWORD, API_URL, BASE_URL, makeStudent } from '../core/instance'
import { req, login, getOrg, createStudent } from '../core/client'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = join(HERE, 'output')
const VIEWPORT = { width: 1280, height: 720 }

/** Paint a caption over the page so the recording explains itself. */
async function caption(page: Page, step: string, text: string, holdMs = 2800): Promise<void> {
  await page.evaluate(
    ({ step, text }) => {
      const id = '__lh_demo_caption__'
      document.getElementById(id)?.remove()
      const el = document.createElement('div')
      el.id = id
      el.style.cssText = [
        'position:fixed', 'inset:auto 0 0 0', 'z-index:2147483647',
        'padding:14px 22px', 'background:rgba(15,23,42,.92)', 'color:#fff',
        'font:600 15px/1.45 ui-sans-serif,system-ui,-apple-system,sans-serif',
        'display:flex', 'gap:12px', 'align-items:baseline', 'pointer-events:none',
      ].join(';')
      el.innerHTML =
        `<span style="font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:#5eead4">${step}</span>` +
        `<span>${text}</span>`
      document.body.appendChild(el)
    },
    { step, text },
  )
  await page.waitForTimeout(holdMs)
}

async function recordedContext(browser: Browser): Promise<BrowserContext> {
  const context = await browser.newContext({ viewport: VIEWPORT, recordVideo: { dir: OUT_DIR, size: VIEWPORT } })
  // Suppress the first-run onboarding overlay so it doesn't cover the demo. An
  // init script, because the dashboard writes its own state back on load and
  // would overwrite a value set after login.
  await context.addInitScript(() => {
    try {
      window.localStorage.setItem(
        'lh_onboarding',
        JSON.stringify({ completedSteps: [], skippedSteps: [], minimized: true, expanded: false, showAllSteps: false, dismissed: true, welcomeSeen: true }),
      )
    } catch { /* ignore */ }
  })
  return context
}

async function loggedInPage(browser: Browser, email: string, password: string): Promise<Page> {
  const page = await (await recordedContext(browser)).newPage()
  await page.goto(`${BASE_URL}/login`)
  await page.getByRole('textbox', { name: 'Email' }).fill(email)
  await page.getByRole('textbox', { name: 'Password' }).fill(password)
  await page.getByRole('button', { name: 'Login', exact: true }).click()
  await page.waitForURL((u) => !/\/login(\?|$)/.test(u.toString()), { timeout: 30_000 })
  return page
}

async function finishRecording(page: Page, name: string): Promise<string> {
  const video = page.video()
  await page.context().close()
  if (!video) throw new Error('no video was recorded')
  const dest = join(OUT_DIR, `${name}.webm`)
  renameSync(await video.path(), dest)
  return dest
}

async function scrollToHeading(page: Page, text: string, holdMs = 1100): Promise<void> {
  await page.evaluate((needle) => {
    const el = Array.from(document.querySelectorAll('h1, h2, h3')).find((e) => e.textContent?.trim() === needle)
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, text)
  await page.waitForTimeout(holdMs)
}

async function reveal(page: Page, selector: string): Promise<void> {
  await page.locator(selector).evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'smooth' }))
  await page.waitForTimeout(700)
}

async function pick(page: Page, triggerId: string, option: string): Promise<void> {
  await page.locator(triggerId).click()
  await page.getByRole('option', { name: option, exact: true }).click()
}

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true })
  const adminToken = await login(ADMIN_EMAIL, ADMIN_PASSWORD)
  const org = await getOrg()
  await req('PUT', `/orgs/${org.id}/landing`, adminToken, { enabled: true, sections: [] })

  const browser = await chromium.launch({ slowMo: 260 })
  const videos: string[] = []
  try {
    const admin = await loggedInPage(browser, ADMIN_EMAIL, ADMIN_PASSWORD)
    await admin.goto(`${BASE_URL}/dash/org/settings/landing`)
    await admin.getByText('Start from a template').waitFor()
    await caption(admin, 'Admin', 'The BETA badge is gone, and there is a fourth template: Launch.', 2600)
    await admin.getByRole('button', { name: /^Launch/ }).click()
    await admin.getByRole('button', { name: 'Add Section' }).click()
    await caption(admin, 'Admin', 'Seven more section types: pricing, steps, columns, image, embed, announcement, countdown.', 3600)
    await admin.keyboard.press('Escape')

    await admin.locator('span.capitalize', { hasText: 'Hero' }).click()
    await reveal(admin, '#hero-height')
    await caption(admin, 'Admin', 'Hero: height from small to full screen, and a dark overlay for photo backgrounds.', 2800)
    await admin.locator('#hero-overlay').fill('25')

    await admin.locator('span.capitalize', { hasText: 'Pricing' }).click()
    await caption(admin, 'Admin', 'Every section: which devices see it, and a from / until schedule.', 3000)
    await admin.locator('#section-style-toggle').click()
    await reveal(admin, '#section-animation')
    await caption(admin, 'Admin', 'Plus width, title alignment and an entrance animation.', 2600)
    await pick(admin, '#section-title-align', 'Center')
    await reveal(admin, '#pricing-title')
    await caption(admin, 'Admin', 'Pricing plans: price, feature list, button, and one highlighted plan.', 2800)

    await admin.locator('span.capitalize', { hasText: 'Announcement' }).click()
    await admin.locator('#section-show-until').fill('2030-01-01T00:00')
    await caption(admin, 'Admin', 'The announcement retires itself on the date you set.', 2600)

    await admin.locator('#landing-page-settings').click()
    await pick(admin, '#page-background-type', 'Solid color')
    await admin.locator('#page-background-color').fill('#fffbf5')
    await pick(admin, '#page-gap', 'Small')
    await caption(admin, 'Admin', 'Page settings: background, content width and the gap between sections.', 2800)

    const download = admin.waitForEvent('download')
    await admin.getByRole('button', { name: 'Export' }).click()
    await (await download).cancel()
    await caption(admin, 'Admin', 'Export to JSON and import it into another school. Imports are validated.', 2800)

    await admin.getByRole('button', { name: 'Save Changes' }).click()
    await admin.getByText('Landing page saved successfully').waitFor()
    await admin.waitForTimeout(1000)
    videos.push(await finishRecording(admin, 'c1-admin-advanced'))

    const visitor = await (await recordedContext(browser)).newPage()
    await visitor.goto(BASE_URL)
    await visitor.getByText('The cohort that gets you hired').waitFor()
    await caption(visitor, 'Visitor', 'Announcement bar, a taller hero with the overlay, on the new page background.', 3000)
    await scrollToHeading(visitor, 'Doors close in')
    await caption(visitor, 'Visitor', 'A live countdown. When it ends it swaps to the text you chose.', 3200)
    await scrollToHeading(visitor, 'How the cohort works')
    await caption(visitor, 'Visitor', 'Steps slide in as they enter the screen.', 2400)
    await scrollToHeading(visitor, 'Small groups')
    await caption(visitor, 'Visitor', 'Columns of Markdown on a tinted band.', 2200)
    await visitor.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }))
    await visitor.waitForTimeout(1200)
    await visitor.getByRole('link', { name: 'See plans' }).click()
    await visitor.waitForTimeout(1500)
    await caption(visitor, 'Visitor', '"See plans" jumps to #pricing: three plans, one highlighted, centered title.', 3400)
    await scrollToHeading(visitor, 'Questions')
    await caption(visitor, 'Visitor', 'A narrow FAQ to finish.', 2200)
    videos.push(await finishRecording(visitor, 'c2-visitor-advanced'))
  } finally {
    await browser.close()
  }

  console.log('\nRecorded:')
  for (const v of videos) console.log(`  ${v}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
