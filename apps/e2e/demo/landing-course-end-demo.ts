/**
 * Recorded walkthrough of landing-section visibility, the landing video
 * section, and the customizable course completion screen.
 *
 * This is a *demo*, not a test — `playwright.config.ts` only collects specs
 * under `features/`, so nothing here runs in CI. Same conventions as
 * `formative-demo.ts`: it drives the real UI slowly, captions each step, and
 * writes one video per persona.
 *
 * Usage (against an already-running instance):
 *
 *   export E2E_BASE_URL=http://localhost:3010
 *   export E2E_API_URL=http://localhost:1348/api/v1
 *   export E2E_ADMIN_EMAIL=admin@school.dev
 *   export E2E_ADMIN_PASSWORD='...'
 *   export DEMO_VIDEO_FILE=/path/to/clip.webm   # VP8/VP9 so bundled Chromium can play it
 *   bun run demo/landing-course-end-demo.ts     # -> demo/output/<name>.webm
 */
import { fileURLToPath } from 'node:url'
import { mkdirSync, renameSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { chromium, Browser, BrowserContext, Page } from '@playwright/test'

import { ADMIN_EMAIL, ADMIN_PASSWORD, API_URL, BASE_URL, makeStudent } from '../core/instance'
import { req, login, getOrg, createStudent } from '../core/client'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = join(HERE, 'output')
const VIDEO_FILE = process.env.DEMO_VIDEO_FILE || join(OUT_DIR, 'tour.webm')
const VIEWPORT = { width: 1280, height: 720 }

const END_MESSAGE = 'Nice work! Your next module is waiting in the course library.'
const END_BUTTON = 'Go to the course library'

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

/** A members-only course with a single page activity. */
async function seedCourse(token: string, orgId: number, name: string, description: string) {
  const course = await createCourse(token, orgId, name, description)
  const chapter = await req<any>('POST', '/chapters/', token, {
    name: 'Module 1', description: '', org_id: orgId, course_id: course.id,
  })
  const activity = await req<any>('POST', `/activities/?coursechapter_id=${chapter.id}&org_id=${orgId}`, token, {
    name: 'Lesson 1',
    activity_type: 'TYPE_DYNAMIC',
    activity_sub_type: 'SUBTYPE_DYNAMIC_PAGE',
    chapter_id: chapter.id,
    published: true,
  })
  await req('PUT', `/courses/${course.course_uuid}`, token, { public: false, published: true })
  return { courseUuid: course.course_uuid as string, activityUuid: activity.activity_uuid as string }
}

/** Pick an option in a Radix Select whose trigger is `trigger`. */
async function pick(page: Page, trigger: ReturnType<Page['locator']>, option: string): Promise<void> {
  await trigger.click()
  await page.getByRole('option', { name: option }).click()
}

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true })

  // --- Seed: two members-only courses, a learner who finished one ----------
  const adminToken = await login(ADMIN_EMAIL, ADMIN_PASSWORD)
  const org = await getOrg()
  const stamp = Date.now().toString(36)
  const first = await seedCourse(adminToken, org.id, 'Getting started', 'Learn how the academy works.')
  const second = await seedCourse(adminToken, org.id, 'Email management', 'Calm any inbox.')

  // The landing as it looks today: one hero, one featured-courses block, both
  // shown to everyone.
  await req('PUT', `/orgs/${org.id}/landing`, adminToken, {
    enabled: true,
    sections: [
      {
        type: 'hero',
        title: 'Hero',
        background: { type: 'gradient', colors: ['#0f172a', '#1e3a8a'], direction: '135deg' },
        heading: { text: 'Welcome to the academy', color: '#ffffff', size: 'large' },
        subheading: { text: 'Everything you need to get going, in one place.', color: '#cbd5e1', size: 'medium' },
        buttons: [{ text: 'Create your account', link: '/signup', color: '#0f172a', background: '#ffffff' }],
        contentAlign: 'center',
      },
      { type: 'featured-courses', title: 'Or dive straight in', courses: [first.courseUuid, second.courseUuid] },
    ],
  })

  // Start from the stock completion screen so the recording shows it being filled in.
  await req('PUT', `/orgs/${org.id}/config/course-end`, adminToken, {})

  const student = makeStudent(`landing${stamp}`)
  await createStudent(adminToken, org.id, student)
  const studentToken = await login(student.email, student.password)
  // Reading the trail creates it on first access; add_course 404s without one.
  await req('GET', `/trail/org/${org.id}/trail`, studentToken)
  await req('POST', `/trail/add_course/${first.courseUuid}`, studentToken)
  await req('POST', `/trail/add_activity/${first.activityUuid}`, studentToken)

  const browser = await chromium.launch({ slowMo: 300 })
  const videos: string[] = []
  try {
    // --- Admin: section visibility + a video section ------------------------
    const admin = await loggedInPage(browser, ADMIN_EMAIL, ADMIN_PASSWORD)
    await admin.goto(`${BASE_URL}/dash/org/settings/landing`)
    await admin.locator('span.capitalize', { hasText: 'Courses' }).click()
    await caption(admin, 'Admin', 'Every landing section now has a Visibility setting.')
    await pick(admin, admin.locator('#section-visibility'), 'Signed-in users only')
    await caption(admin, 'Admin', 'Members-only courses: show this block to signed-in users only.', 2400)

    await admin.getByRole('button', { name: 'Add Section' }).click()
    await admin.getByRole('option', { name: /^Video/ }).click()
    await admin.locator('span.capitalize', { hasText: 'Video' }).click()
    await caption(admin, 'Admin', 'New section type: Video. Paste a YouTube, Vimeo or Loom link, or upload a file.')
    await admin.locator('#video-title').fill('New here? Take the 2-minute tour')
    await admin.locator('#imageUpload-video-section').setInputFiles(VIDEO_FILE)
    await admin.locator('video').first().waitFor({ timeout: 60_000 })
    await pick(admin, admin.locator('#section-visibility'), 'Signed-out visitors only')
    await caption(admin, 'Admin', 'The tour is for visitors, so it shows to signed-out visitors only.', 2600)
    await admin.getByRole('button', { name: 'Save Changes' }).click()
    await admin.getByText('Landing page saved successfully').waitFor()
    await caption(admin, 'Admin', 'Saved. Sections without a setting keep showing to everyone.', 2200)

    // --- Admin: course completion screen ------------------------------------
    await admin.goto(`${BASE_URL}/dash/org/settings/course-end`)
    await caption(admin, 'Admin', 'New settings tab: the screen learners see when they finish a course.')
    await admin.locator('#course-end-message').fill(END_MESSAGE)
    await admin.locator('#course-end-button-text').fill(END_BUTTON)
    await admin.locator('#course-end-button-link').fill('javascript:alert(1)')
    await caption(admin, 'Admin', 'Links are checked: only internal paths or http(s) URLs are accepted.', 2600)
    await admin.locator('#course-end-button-link').fill('/courses')
    await caption(admin, 'Admin', 'Message, button text and link, with a live preview.', 2400)
    await admin.getByRole('button', { name: 'Save', exact: true }).click()
    await admin.getByText('Course completion screen saved').waitFor()
    await admin.waitForTimeout(1200)
    videos.push(await finishRecording(admin, '1-admin-setup'))

    // --- Visitor: public landing -------------------------------------------
    const visitor = await (await recordedContext(browser)).newPage()
    await visitor.goto(BASE_URL)
    await visitor.getByText('Welcome to the academy').waitFor()
    await caption(visitor, 'Visitor', 'Signed out: the hero, then the tour video. Playable right on the landing.')
    await visitor.locator('video').evaluate((el) => el.scrollIntoView({ block: 'center' }))
    await visitor.locator('video').evaluate((el: HTMLVideoElement) => { el.muted = true; void el.play() })
    await caption(visitor, 'Visitor', 'The members-only course block is gone, not an empty "No featured courses" box.', 3600)
    videos.push(await finishRecording(visitor, '2-visitor-landing'))

    // --- Learner: member landing + completion screen -----------------------
    const learner = await loggedInPage(browser, student.email, student.password)
    await learner.goto(BASE_URL)
    await learner.getByText('Or dive straight in').waitFor()
    await learner.getByText('Or dive straight in').scrollIntoViewIfNeeded()
    await caption(learner, 'Learner', 'Signed in: the courses are back, and the visitor tour is hidden.', 3400)
    await learner.goto(`${BASE_URL}/course/${first.courseUuid.replace(/^course_/, '')}/activity/end`)
    await learner.getByText(END_MESSAGE).waitFor({ timeout: 30_000 })
    await learner.waitForTimeout(2500)
    await learner.getByRole('link', { name: END_BUTTON }).scrollIntoViewIfNeeded()
    await caption(learner, 'Learner', 'Course finished: the custom message, and a button that points onward.', 3400)
    await learner.getByRole('link', { name: END_BUTTON }).click()
    await learner.waitForURL(/\/courses/)
    await caption(learner, 'Learner', 'One click to the course library. With nothing configured it says "Browse all courses".', 3200)
    videos.push(await finishRecording(learner, '3-learner'))
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
