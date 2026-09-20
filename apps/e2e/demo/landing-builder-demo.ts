/**
 * Recorded walkthrough of the landing page builder: starter templates, the new
 * section types, per-section style settings, duplicate / hide, and the public
 * result for a signed-out visitor and a signed-in learner.
 *
 * A *demo*, not a test (see `landing-course-end-demo.ts` for the conventions).
 *
 *   export E2E_BASE_URL=http://localhost:3010
 *   export E2E_API_URL=http://localhost:1348/api/v1
 *   export E2E_ADMIN_EMAIL=admin@school.dev
 *   export E2E_ADMIN_PASSWORD='...'
 *   bun run demo/landing-builder-demo.ts        # -> demo/output/<name>.webm
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

async function createCourse(token: string, orgId: number, name: string, description: string): Promise<any> {
  const fd = new FormData()
  fd.set('name', name)
  fd.set('description', description)
  fd.set('public', 'false')
  fd.set('about', description)
  fd.set('learnings', '[]')
  fd.set('tags', '')
  const res = await fetch(`${API_URL}/courses/?org_id=${orgId}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: fd,
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`createCourse -> ${res.status}: ${text}`)
  return JSON.parse(text)
}

const COURSES = [
  ['Getting started', 'Learn how the academy works.'],
  ['Email management', 'Calm any inbox.'],
  ['Calendar mastery', 'Own your week.'],
  ['Client onboarding', 'A first week that builds trust.'],
]

/** Bring the section with this heading to the middle of the screen, smoothly. */
async function scrollToHeading(page: Page, text: string, holdMs = 900): Promise<void> {
  await page.evaluate((needle) => {
    const el = Array.from(document.querySelectorAll('h1, h2, summary')).find((e) => e.textContent?.trim() === needle)
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, text)
  await page.waitForTimeout(holdMs)
}

async function pick(page: Page, triggerId: string, option: string): Promise<void> {
  await page.locator(triggerId).click()
  await page.getByRole('option', { name: option, exact: true }).click()
}

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true })

  // --- Seed: public courses, an enabled but empty landing, one learner -----
  const adminToken = await login(ADMIN_EMAIL, ADMIN_PASSWORD)
  const org = await getOrg()
  const existing = await req<any>('GET', `/courses/org_slug/${org.slug}/page/1/limit/50`, adminToken)
  const names = new Set((Array.isArray(existing) ? existing : existing.courses || []).map((c: any) => c.name))
  for (const [name, description] of COURSES) {
    if (names.has(name)) continue
    const course = await createCourse(adminToken, org.id, name, description)
    await req('PUT', `/courses/${course.course_uuid}`, adminToken, { public: true, published: true })
  }
  await req('PUT', `/orgs/${org.id}/landing`, adminToken, { enabled: true, sections: [] })
  const student = makeStudent(`builder${Date.now().toString(36)}`)
  await createStudent(adminToken, org.id, student)

  const browser = await chromium.launch({ slowMo: 280 })
  const videos: string[] = []
  try {
    // --- Admin: build the page ---------------------------------------------
    const admin = await loggedInPage(browser, ADMIN_EMAIL, ADMIN_PASSWORD)
    await admin.goto(`${BASE_URL}/dash/org/settings/landing`)
    await admin.getByText('Start from a template').waitFor()
    await caption(admin, 'Admin', 'An empty landing now offers starter templates.')
    await admin.getByRole('button', { name: /^Academy/ }).click()
    await caption(admin, 'Admin', 'One click: 8 sections, including a hero for visitors and another for members.', 3200)

    await admin.getByRole('button', { name: 'Add Section' }).click()
    await caption(admin, 'Admin', 'Eight new section types: text, features, stats, testimonials, FAQ, call to action, gallery, spacer.', 3800)
    await admin.keyboard.press('Escape')

    await admin.locator('span.capitalize', { hasText: 'Stats' }).click()
    await caption(admin, 'Admin', 'Every block is a simple list: add, reorder, remove.', 2200)
    await admin.getByRole('button', { name: 'Add stat' }).click()
    await admin.getByPlaceholder('12k+').last().fill('98%')
    await admin.getByPlaceholder('Label').last().fill('Completion rate')

    await admin.locator('#section-style-toggle').click()
    await caption(admin, 'Admin', 'Every section, old or new, gets background, text color, spacing and an anchor.', 3000)
    await pick(admin, '#section-background-type', 'Gradient')
    await admin.locator('#section-text-color').fill('#ffffff')
    await pick(admin, '#section-spacing', 'Small')
    await caption(admin, 'Admin', 'A dark gradient band with white text for the numbers.', 2200)

    await admin.locator('span.capitalize', { hasText: 'FAQ' }).click()
    await admin.getByRole('button', { name: 'Add question' }).click()
    await admin.getByPlaceholder('Question').last().fill('Can my whole team join?')
    await admin.getByPlaceholder('Answer').last().fill('Yes. Invite them from your account and learn together.')
    await caption(admin, 'Admin', 'The FAQ has the anchor "faq", so any button can link to #faq.', 2600)

    const testimonials = admin.locator('div.group', { has: admin.locator('span.capitalize', { hasText: 'Testimonials' }) })
    await testimonials.hover()
    await testimonials.getByRole('button', { name: 'Duplicate section' }).click()
    await caption(admin, 'Admin', 'Duplicate a section to try a variation...', 2000)
    await admin.locator('#section-hidden').click()
    await caption(admin, 'Admin', '...and hide it: it stays in the editor, off the public page.', 2600)

    await admin.getByRole('button', { name: 'Save Changes' }).click()
    await admin.getByText('Landing page saved successfully').waitFor()
    await caption(admin, 'Admin', 'Saved. All new fields are optional, so existing landings render exactly as before.', 3000)
    videos.push(await finishRecording(admin, 'b1-admin-builder'))

    // --- Visitor ------------------------------------------------------------
    const visitor = await (await recordedContext(browser)).newPage()
    await visitor.goto(BASE_URL)
    await visitor.getByText('Learn the skills that move your career').waitFor()
    await caption(visitor, 'Visitor', 'Signed out: the visitor hero.', 2200)
    await visitor.getByRole('link', { name: 'How it works' }).click()
    await visitor.waitForTimeout(1200)
    await caption(visitor, 'Visitor', 'The hero button jumped to the #how-it-works anchor.', 2600)
    await scrollToHeading(visitor, 'Latest courses')
    await caption(visitor, 'Visitor', '"Latest courses" fills itself: no hand-picking, only courses this visitor may see.', 3000)
    await scrollToHeading(visitor, 'What learners say')
    await caption(visitor, 'Visitor', 'Testimonials on a tinted band. The hidden duplicate is not here.', 2600)
    await scrollToHeading(visitor, 'Frequently asked questions')
    await visitor.getByText('Can my whole team join?').click()
    await caption(visitor, 'Visitor', 'FAQ: native, keyboard-friendly accordions.', 2400)
    await scrollToHeading(visitor, 'Ready to start?')
    await caption(visitor, 'Visitor', 'A sign-up banner, shown to signed-out visitors only.', 2600)
    videos.push(await finishRecording(visitor, 'b2-visitor'))

    // --- Learner ------------------------------------------------------------
    const learner = await loggedInPage(browser, student.email, student.password)
    await learner.goto(BASE_URL)
    await learner.getByText('Welcome back').waitFor()
    await caption(learner, 'Learner', 'Signed in: same page, the member hero instead.', 2600)
    await learner.evaluate(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }))
    await learner.waitForTimeout(1500)
    await caption(learner, 'Learner', 'And no sign-up banner at the bottom.', 2600)
    videos.push(await finishRecording(learner, 'b3-learner'))
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
