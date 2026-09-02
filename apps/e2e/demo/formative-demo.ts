/**
 * Recorded walkthrough of the formative-assignment flow.
 *
 * This is a *demo*, not a test — `playwright.config.ts` only collects specs
 * under `features/`, so nothing here runs in CI. It drives the same UI the
 * `22-formative` spec asserts on, but slowly and with an on-screen caption for
 * each step, and writes a video you can watch end to end.
 *
 * It reuses the feature module's own API seeding and page objects, so the
 * walkthrough can never drift from the flow the spec covers.
 *
 * Usage (against an already-running instance):
 *
 *   export E2E_BASE_URL=http://localhost:3010
 *   export E2E_API_URL=http://localhost:1348/api/v1
 *   export E2E_ADMIN_EMAIL=admin@school.dev
 *   export E2E_ADMIN_PASSWORD='...'
 *   bun run demo/formative-demo.ts            # -> demo/output/<name>.webm
 */
import { fileURLToPath } from 'node:url'
import { mkdirSync, readdirSync, renameSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { chromium, Browser, Page } from '@playwright/test'

import { ADMIN_EMAIL, ADMIN_PASSWORD, BASE_URL, makeStudent } from '../core/instance'
import * as api from '../features/assignments/api'
import { AssignmentPage } from '../features/assignments/pages/student'
import { AssignmentEditorPage, TeacherSubmissionsPage } from '../features/assignments/pages/teacher'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = join(HERE, 'output')
const FIXTURE = join(HERE, '..', 'features', 'assignments', 'fixtures', 'submission.png')

const SOLUTION =
  "Corrigé — Étape 1 : reformuler la consigne. Étape 2 : citer deux sources par argument. " +
  'Étape 3 : conclure en trois phrases.'

const VIEWPORT = { width: 1280, height: 720 }

/** Paint a caption over the page so the recording explains itself. */
async function caption(page: Page, step: string, text: string, holdMs = 2600): Promise<void> {
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

/**
 * Centre the element whose text matches `text` in the viewport.
 *
 * `scrollIntoViewIfNeeded` was not enough here: the panel lands above the fold
 * inside an inner scroll container, and the refetch that follows a hand-in
 * re-renders it, so the scroll has to happen after that settles — hence the
 * second pass.
 */
async function scrollTo(page: Page, text: string): Promise<void> {
  const centre = () =>
    page.evaluate((needle) => {
      const el = Array.from(document.querySelectorAll('h3, p, span')).find(
        (e) => e.textContent?.trim() === needle,
      )
      el?.scrollIntoView({ block: 'center' })
    }, text)
  await centre()
  await page.waitForTimeout(600)
  await centre()
}

async function loggedInPage(browser: Browser, email: string, password: string): Promise<Page> {
  const context = await browser.newContext({
    viewport: VIEWPORT,
    recordVideo: { dir: OUT_DIR, size: VIEWPORT },
  })
  const page = await context.newPage()
  await page.goto(`${BASE_URL}/login`)
  await page.getByRole('textbox', { name: 'Email' }).fill(email)
  await page.getByRole('textbox', { name: 'Password' }).fill(password)
  await page.getByRole('button', { name: 'Login', exact: true }).click()
  await page.waitForURL((u) => !/\/login(\?|$)/.test(u.toString()), { timeout: 30_000 })
  // Suppress the first-run onboarding overlay so it doesn't cover the demo.
  await page.evaluate(() => {
    try {
      window.localStorage.setItem(
        'lh_onboarding',
        JSON.stringify({ completedSteps: [], skippedSteps: [], minimized: true, expanded: false, showAllSteps: false, dismissed: true, welcomeSeen: true }),
      )
    } catch { /* ignore */ }
  })
  return page
}

/** Close the page's context and return the recorded video's final path. */
async function finishRecording(page: Page, name: string): Promise<string> {
  const video = page.video()
  await page.context().close()
  if (!video) throw new Error('no video was recorded')
  const src = await video.path()
  const dest = join(OUT_DIR, `${name}.webm`)
  renameSync(src, dest)
  return dest
}

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true })

  // --- Seed a course + assignment with one file-deposit task ---------------
  const adminToken = await api.login(ADMIN_EMAIL, ADMIN_PASSWORD)
  const org = await api.getOrg()
  const stamp = Date.now().toString(36)
  const seeded = await api.seedAssignment(adminToken, org, {
    courseName: `Évaluation formative (démo ${stamp})`,
    assignmentTitle: `Dépôt de document (démo ${stamp})`,
    autoGrading: false,
    tasks: [{ title: 'Déposez votre document', assignment_type: 'FILE_SUBMISSION', contents: {} }],
  })
  const student = makeStudent(`demo${stamp}`)
  await api.createStudent(adminToken, org.id, student)

  const bareAssignment = seeded.assignmentUuid.replace(/^assignment_/, '')
  const bareCourse = seeded.courseUuid.replace(/^course_/, '')
  const bareActivity = seeded.activityUuid.replace(/^activity_/, '')

  const browser = await chromium.launch({ slowMo: 320 })
  const videos: string[] = []
  try {
    // --- Teacher configures formative mode + the corrigé -------------------
    const teacher = await loggedInPage(browser, ADMIN_EMAIL, ADMIN_PASSWORD)
    const editor = new AssignmentEditorPage(teacher)
    await editor.open(bareAssignment)
    await caption(teacher, 'Teacher', 'An ordinary assignment with one "deposit a document" task.')
    await caption(teacher, 'Teacher', 'Open Edit to turn it into a formative assessment.', 1400)
    await editor.configureFormative({
      solution: SOLUTION,
      reveal: 'On hand-in',
      showCorrigeFor: 3000,
    })
    await caption(
      teacher,
      'Teacher',
      'Formative mode on, corrigé written, set to unlock the moment the learner hands in.',
      3200,
    )
    videos.push(await finishRecording(teacher, '1-teacher-setup'))

    // --- Learner deposits the document and gets the corrigé ---------------
    const learner = await loggedInPage(browser, student.email, student.password)
    const activity = new AssignmentPage(learner)
    await activity.open(bareCourse, bareActivity)
    await scrollTo(learner, 'Model answer locked')
    await caption(learner, 'Learner', 'The corrigé exists — but it is locked, and the server withholds it.')
    await activity.uploadFile(FIXTURE)
    await caption(learner, 'Learner', 'The document is deposited.', 1800)
    await activity.saveProgress()
    await activity.handIn()
    // The corrigé panel sits above the tasks, so bring it into frame — it is
    // the whole point of the flow.
    await scrollTo(learner, 'Model answer')
    await caption(learner, 'Learner', 'Handed in — and the corrigé unlocks immediately.', 4200)
    await caption(learner, 'Learner', 'No score, no pass/fail, no "grading in progress". Nothing is marked.', 3600)
    videos.push(await finishRecording(learner, '2-learner-handin'))

    // --- Teacher reviews: no grading anywhere ------------------------------
    const reviewer = await loggedInPage(browser, ADMIN_EMAIL, ADMIN_PASSWORD)
    const subs = new TeacherSubmissionsPage(reviewer)
    await subs.open(bareAssignment)
    await caption(reviewer, 'Teacher', 'The deposit lands in the submissions list.', 2200)
    await subs.evaluateFirst()
    await caption(
      reviewer,
      'Teacher',
      'Review only: "Formative — not graded", and no grading actions to click.',
      3600,
    )
    videos.push(await finishRecording(reviewer, '3-teacher-review'))
  } finally {
    await browser.close()
  }

  // Drop any stray unnamed recordings Playwright wrote alongside ours.
  for (const f of readdirSync(OUT_DIR)) {
    if (f.endsWith('.webm') && !videos.some((v) => v.endsWith(f))) {
      console.log(`(leftover recording: ${f})`)
    }
  }
  console.log('\nRecorded:')
  for (const v of videos) console.log(`  ${v}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
