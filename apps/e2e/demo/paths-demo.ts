/**
 * Recorded walkthrough of learning Paths: an admin builds a path out of
 * existing courses and gives it a certificate, then a learner follows it to
 * the end and gets the certificate.
 *
 * This is a *demo*, not a test: `playwright.config.ts` only collects specs
 * under `features/`, so nothing here runs in CI. Same conventions as
 * `formative-demo.ts`: it drives the real UI slowly, captions each step, and
 * writes one video per persona.
 *
 * The org must be on the Pro plan (or the API in OSS/EE mode), since Paths is
 * a Pro feature.
 *
 * Usage (against an already-running instance):
 *
 *   export E2E_BASE_URL=http://localhost:3020
 *   export E2E_API_URL=http://localhost:1358/api/v1
 *   export E2E_ADMIN_EMAIL=admin@school.dev
 *   export E2E_ADMIN_PASSWORD='...'
 *   export DEMO_ASSETS=/path/to/covers   # optional: <name>.png course/path covers
 *   bun run demo/paths-demo.ts           # -> demo/output/paths-*.webm
 *
 * DEMO_SHOTS=1 also saves a screenshot per step next to the videos.
 */
import { fileURLToPath } from 'node:url'
import { existsSync, mkdirSync, readFileSync, renameSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { chromium, Browser, BrowserContext, Page } from '@playwright/test'

import { ADMIN_EMAIL, ADMIN_PASSWORD, API_URL, BASE_URL } from '../core/instance'
import { req, login, getOrg, createStudent } from '../core/client'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = join(HERE, 'output')
const ASSETS = process.env.DEMO_ASSETS || ''
const SHOTS = process.env.DEMO_SHOTS === '1'
const VIEWPORT = { width: 1440, height: 900 }
const STUDENT = {
  email: 'maya@school.dev',
  username: 'maya',
  password: 'Paths-Demo-2026!',
  first_name: 'Maya',
  last_name: 'Okafor',
}

const COURSES = [
  { key: 'spreadsheets', name: 'Spreadsheet Foundations', description: 'Formulas, lookups and pivot tables for everyday analysis.' },
  { key: 'sql', name: 'SQL for Analysts', description: 'Query, join and aggregate data straight from the warehouse.' },
  { key: 'python', name: 'Python for Data', description: 'pandas basics: load, clean and reshape real datasets.' },
  { key: 'dashboards', name: 'Building Dashboards', description: 'Turn questions into charts your team will actually open.' },
  { key: 'storytelling', name: 'Data Storytelling', description: 'Present findings so decisions get made.' },
]

let shot = 0
async function caption(page: Page, step: string, text: string, holdMs = 2600): Promise<void> {
  // Let route transitions and fades settle before the caption lands.
  await page.waitForTimeout(600)
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
  if (SHOTS) {
    shot += 1
    await page.screenshot({ path: join(OUT_DIR, 'shots', `${String(shot).padStart(2, '0')}-${step.toLowerCase().replace(/\W+/g, '-')}.png`) })
  }
  await page.waitForTimeout(holdMs)
}

async function recordedContext(browser: Browser): Promise<BrowserContext> {
  const context = await browser.newContext({ viewport: VIEWPORT, recordVideo: { dir: OUT_DIR, size: VIEWPORT } })
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

function cover(key: string): Blob | null {
  const file = ASSETS && join(ASSETS, `${key}.png`)
  return file && existsSync(file) ? new Blob([readFileSync(file)], { type: 'image/png' }) : null
}

/** A published public course with a chapter of two page activities. Reuses
 * a course of the same name from an earlier run. */
async function seedCourse(token: string, orgId: number, c: (typeof COURSES)[number]) {
  const existing = (
    await req<any[]>('GET', `/courses/org_slug/${(await getOrg()).slug}/page/1/limit/100?include_unpublished=true`, token)
  ).find((course) => course.name === c.name)
  if (existing) {
    const meta = await req<any>('GET', `/courses/${existing.course_uuid}/meta`, token)
    const activities = meta.chapters.flatMap((ch: any) => ch.activities.map((a: any) => a.activity_uuid))
    return { ...c, courseUuid: existing.course_uuid as string, activities }
  }
  const fd = new FormData()
  fd.set('name', c.name)
  fd.set('description', c.description)
  fd.set('public', 'true')
  fd.set('about', c.description)
  fd.set('learnings', '[]')
  fd.set('tags', '')
  const image = cover(c.key)
  if (image) {
    fd.set('thumbnail_type', 'image')
    fd.set('thumbnail', image, `${c.key}.png`)
  }
  const res = await fetch(`${API_URL}/courses/?org_id=${orgId}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: fd,
  })
  if (!res.ok) throw new Error(`createCourse -> ${res.status}: ${await res.text()}`)
  const course = await res.json()
  const chapter = await req<any>('POST', '/chapters/', token, {
    name: 'Module 1', description: '', org_id: orgId, course_id: course.id,
  })
  const activities: string[] = []
  for (const name of ['Introduction', 'Hands-on']) {
    const activity = await req<any>('POST', `/activities/?coursechapter_id=${chapter.id}&org_id=${orgId}`, token, {
      name,
      activity_type: 'TYPE_DYNAMIC',
      activity_sub_type: 'SUBTYPE_DYNAMIC_PAGE',
      chapter_id: chapter.id,
      published: true,
    })
    activities.push(activity.activity_uuid)
  }
  await req('PUT', `/courses/${course.course_uuid}`, token, { public: true, published: true })
  return { ...c, courseUuid: course.course_uuid as string, activities }
}

type Seeded = Awaited<ReturnType<typeof seedCourse>>

async function completeCourse(studentToken: string, course: Seeded) {
  const { id: orgId } = await getOrg()
  await req('POST', '/trail/start', studentToken, { org_id: orgId, user_id: 0 }).catch(() => undefined)
  await req('POST', `/trail/add_course/${course.courseUuid}`, studentToken)
  for (const activity of course.activities) {
    await req('POST', `/trail/add_activity/${activity}`, studentToken)
  }
}

async function main(): Promise<void> {
  mkdirSync(join(OUT_DIR, 'shots'), { recursive: true })
  const org = await getOrg()
  const adminToken = await login(ADMIN_EMAIL, ADMIN_PASSWORD)

  const courses: Seeded[] = []
  for (const c of COURSES) courses.push(await seedCourse(adminToken, org.id, c))
  await createStudent(adminToken, org.id, STUDENT).catch(() => undefined)
  const studentToken = await login(STUDENT.email, STUDENT.password)
  // Maya already finished the first course before the path existed: the path
  // credits it when she joins.
  await completeCourse(studentToken, courses[0])

  const browser = await chromium.launch()
  try {
    // ── Admin ────────────────────────────────────────────────────────────
    const admin = await loggedInPage(browser, ADMIN_EMAIL, ADMIN_PASSWORD)
    await admin.goto(`${BASE_URL}/dash/paths`)
    await admin.getByRole('heading', { name: 'Paths', level: 1 }).waitFor()
    await caption(admin, 'Paths', 'A new Pro feature in the dashboard: group courses into a guided journey')

    await admin.getByRole('button', { name: 'New path' }).first().click()
    await admin.getByPlaceholder('e.g. Data Analyst').pressSequentially('Data Analyst', { delay: 45 })
    await admin.getByPlaceholder('One or two sentences shown on the path card').pressSequentially(
      'From spreadsheets to dashboards: everything you need for your first analyst role.',
      { delay: 12 },
    )
    await caption(admin, 'Create', 'Name the path and describe it')
    await admin.getByRole('button', { name: 'Create path' }).click()
    await admin.waitForURL(/\/dash\/paths\/path\/.+\/courses/)
    const pathShortUuid = admin.url().split('/path/')[1].split('/')[0]
    await admin.getByRole('heading', { name: 'No courses yet' }).waitFor()
    await caption(admin, 'Courses', 'The editor opens on the courses tab')

    await admin.getByRole('button', { name: 'Add courses' }).first().click()
    for (const c of [courses[0], courses[1], courses[3], courses[2], courses[4]]) {
      await admin.getByRole('dialog').getByRole('button', { name: c.name }).click()
      await admin.waitForTimeout(250)
    }
    await caption(admin, 'Pick', 'Courses are added in the order you pick them')
    await admin.getByRole('button', { name: 'Add 5 courses' }).click()
    await admin.getByText('Data Storytelling').first().waitFor()
    await caption(admin, 'Order', 'Five courses in, numbered in the order learners follow')

    // Move "Python for Data" above "Building Dashboards" with the keyboard
    // (drag handles support space + arrows).
    const handles = admin.getByLabel('Drag to reorder')
    await handles.nth(3).focus()
    await admin.keyboard.press('Space')
    await admin.waitForTimeout(300)
    await admin.keyboard.press('ArrowUp')
    await admin.waitForTimeout(300)
    await admin.keyboard.press('Space')
    await admin.waitForTimeout(900)
    await caption(admin, 'Reorder', 'Drag to reorder: Python now comes before dashboards')

    const rows = admin.getByRole('list', { name: 'Courses' }).getByRole('listitem')
    await rows.nth(3).getByRole('radio', { name: 'Elective' }).click()
    await admin.waitForTimeout(500)
    await rows.nth(4).getByRole('radio', { name: 'Elective' }).click()
    await admin.waitForTimeout(800)
    await caption(admin, 'Electives', 'The last two become electives: learners choose between them')

    await admin.getByRole('switch', { name: 'Guided order' }).click()
    const electivesInput = admin.getByRole('spinbutton', { name: 'Electives to complete' })
    await electivesInput.fill('1')
    await electivesInput.blur()
    await admin.waitForTimeout(800)
    await admin.getByText('Completion rules').scrollIntoViewIfNeeded()
    await caption(admin, 'Rules', 'Guided order unlocks courses one by one; one elective is enough to finish', 3200)

    await admin.getByRole('link', { name: 'General' }).click()
    await admin.getByText('Cover image').waitFor()
    const pathCover = ASSETS && join(ASSETS, 'path.png')
    if (pathCover && existsSync(pathCover)) {
      await admin.locator('#path-thumbnail-upload').setInputFiles(pathCover)
    }
    await admin.getByRole('textbox', { name: 'About' }).fill(
      'For anyone starting out in analytics. You will learn to pull data with SQL, clean it in Python, and present it as dashboards and stories your team can act on.',
    )
    await admin.getByRole('button', { name: 'All levels' }).click()
    await admin.getByText('Beginner', { exact: true }).click()
    await admin.getByRole('checkbox', { name: /Published/ }).check()
    await admin.getByText('Cover image').scrollIntoViewIfNeeded()
    await caption(admin, 'Settings', 'Cover image, level and visibility')
    await admin.getByRole('button', { name: 'Save changes' }).click()
    await admin.getByText('Path saved').waitFor()

    await admin.getByRole('link', { name: 'Certificate' }).click()
    await admin.getByRole('button', { name: 'Award a certificate' }).click()
    await admin.getByRole('radio', { name: 'Academic' }).click()
    await admin.getByRole('textbox', { name: /Signed by/ }).fill('Dr. Lena Brooks, Head of Analytics')
    await admin.waitForTimeout(600)
    await caption(admin, 'Certificate', 'Its own certificate, built with the same designer as course certificates', 3400)
    await admin.getByRole('button', { name: 'Save changes' }).click()
    await admin.getByText('Path saved').waitFor()

    await admin.goto(`${BASE_URL}/path/${pathShortUuid}`)
    await admin.getByRole('heading', { name: 'Data Analyst', level: 1 }).waitFor()
    await caption(admin, 'Published', 'What learners see', 3000)
    await admin.mouse.wheel(0, 700)
    await admin.waitForTimeout(800)
    await caption(admin, 'Published', 'The courses in order, with the electives marked', 3000)
    console.log('admin:', await finishRecording(admin, 'paths-admin'))

    // ── Learner ──────────────────────────────────────────────────────────
    const learner = await loggedInPage(browser, STUDENT.email, STUDENT.password)
    await learner.goto(`${BASE_URL}/paths`)
    await learner.getByText('Data Analyst').first().waitFor()
    await caption(learner, 'Catalog', 'Paths get their own page in the org menu')
    await learner.getByRole('link', { name: 'Data Analyst' }).first().click()
    await learner.getByRole('button', { name: 'Start path' }).waitFor()
    await caption(learner, 'Path', 'Maya opens the path: a course page, but for a whole journey')
    await learner.getByRole('button', { name: 'Start path' }).click()
    await learner.getByText('Up next').waitFor()
    await learner.getByRole('heading', { name: 'Courses in this path' }).evaluate((el) => el.scrollIntoView({ block: 'start', behavior: 'smooth' }))
    await caption(learner, 'Start', 'She already finished Spreadsheet Foundations, so it counts right away', 3200)

    await completeCourse(studentToken, courses[1])
    await completeCourse(studentToken, courses[2])
    await learner.reload()
    await learner.getByText('Up next').waitFor()
    await learner.getByRole('heading', { name: 'Courses in this path' }).evaluate((el) => el.scrollIntoView({ block: 'start', behavior: 'smooth' }))
    await caption(learner, 'Progress', 'SQL and Python done: three of four requirements met')

    await learner.goto(`${BASE_URL}/course/${courses[3].courseUuid.replace('course_', '')}`)
    await learner.getByText('Part of a path').waitFor()
    await caption(learner, 'Course page', 'Every course shows the paths it belongs to')

    await completeCourse(studentToken, courses[3])
    await learner.goto(`${BASE_URL}/path/${pathShortUuid}`)
    await learner.getByRole('link', { name: 'View certificate' }).first().waitFor()
    await caption(learner, 'Complete', 'One elective was enough: path complete', 3000)
    await learner.getByRole('link', { name: 'View certificate' }).first().click()
    await learner.getByText('Verified credential').waitFor()
    await learner.waitForTimeout(1200)
    await caption(learner, 'Certificate', 'A verifiable credential: QR code, PDF download, add to LinkedIn', 3800)

    await learner.goto(`${BASE_URL}/trail`)
    await learner.getByRole('heading', { name: 'My Certificates' }).waitFor()
    await learner.waitForTimeout(1500)
    await learner.mouse.move(700, 400)
    await learner.mouse.wheel(0, 760)
    await learner.waitForTimeout(900)
    await caption(learner, 'Trail', 'Course and path certificates live together on her trail')
    console.log('learner:', await finishRecording(learner, 'paths-learner'))

    // ── Admin: learners ──────────────────────────────────────────────────
    const back = await loggedInPage(browser, ADMIN_EMAIL, ADMIN_PASSWORD)
    await back.goto(`${BASE_URL}/dash/paths/path/${pathShortUuid}/learners`)
    await back.getByText('Maya Okafor').waitFor()
    await caption(back, 'Learners', 'Admins see who follows the path, their progress and certificates', 3600)
    await back.goto(`${BASE_URL}/dash/paths`)
    await back.getByText('Data Analyst').first().waitFor()
    await caption(back, 'Dashboard', 'Path cards show status, course count and learners')
    console.log('admin-learners:', await finishRecording(back, 'paths-admin-learners'))
  } finally {
    await browser.close()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
