/**
 * Recorded walkthrough of Live sessions, end to end.
 *
 * A demo, not a test: `playwright.config.ts` only collects `features/`, so
 * nothing here runs in CI. It signs in as an admin (the host) and a learner,
 * drives every part of the feature with an on-screen caption per step, and
 * writes one video per chapter. Chapter 5 records the host and the learner at
 * the same time so the two halves of the live class can be shown side by side.
 *
 * Expects an instance with the live sessions demo data seeded (a course the
 * learner is enrolled in, a "Cohort A office hours" series) and these env vars:
 *
 *   DEMO_BASE_URL            web origin, e.g. http://live.localhost:3031
 *   DEMO_ADMIN_EMAIL / DEMO_ADMIN_PASSWORD
 *   DEMO_LEARNER_EMAIL / DEMO_LEARNER_PASSWORD
 *
 *   bun run demo/live-sessions-demo.ts      # -> demo/output/live-*.webm
 */
import { fileURLToPath } from 'node:url'
import { mkdirSync, renameSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { chromium, Browser, BrowserContext, Page } from '@playwright/test'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = join(HERE, 'output')
const BASE = process.env.DEMO_BASE_URL || 'http://live.localhost:3031'
const ADMIN = { email: process.env.DEMO_ADMIN_EMAIL || 'admin@school.dev', password: process.env.DEMO_ADMIN_PASSWORD || '' }
const LEARNER = { email: process.env.DEMO_LEARNER_EMAIL || '', password: process.env.DEMO_LEARNER_PASSWORD || '' }
const TZ = 'Europe/Paris'
const FULL = { width: 1280, height: 720 }
const HALF = { width: 1024, height: 720 }
const CLASS_TITLE = 'Week 4 live class: caching and TTLs'
const COURSE = 'DNS from the ground up'

type Persona = { email: string; password: string }

/** Paint a caption over the page so the recording explains itself. */
async function caption(page: Page, step: string, text: string, holdMs = 2800): Promise<void> {
  await page.evaluate(
    ({ step, text }) => {
      const id = '__lh_demo_caption__'
      document.getElementById(id)?.remove()
      const el = document.createElement('div')
      el.id = id
      el.style.cssText = [
        'position:fixed', 'left:50%', 'top:72px', 'transform:translateX(-50%)', 'z-index:2147483647',
        'max-width:min(880px,calc(100vw - 48px))', 'width:max-content',
        'padding:12px 20px', 'border-radius:14px', 'background:rgba(15,23,42,.94)', 'color:#fff',
        'box-shadow:0 12px 32px rgba(0,0,0,.25)',
        'font:600 15px/1.45 ui-sans-serif,system-ui,-apple-system,sans-serif',
        'display:flex', 'gap:12px', 'align-items:baseline', 'pointer-events:none',
      ].join(';')
      const label = document.createElement('span')
      label.style.cssText = 'font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:#f87171;white-space:nowrap'
      label.textContent = step
      const body = document.createElement('span')
      body.textContent = text
      el.append(label, body)
      document.body.appendChild(el)
    },
    { step, text },
  )
  await page.waitForTimeout(holdMs)
}

async function clearCaption(page: Page) {
  await page.evaluate(() => document.getElementById('__lh_demo_caption__')?.remove())
}

/** Sign in once without recording; chapters reuse the stored session. */
async function signIn(browser: Browser, who: Persona) {
  const context = await browser.newContext({ viewport: FULL, timezoneId: TZ })
  const page = await context.newPage()
  await page.goto(`${BASE}/login`)
  // The login form can re-render once after hydration; type after it settles.
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(1500)
  await page.getByLabel('Email').fill(who.email)
  await page.getByLabel('Password').fill(who.password)
  await page.getByRole('button', { name: 'Login', exact: true }).click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 })
  const state = await context.storageState()
  await context.close()
  return state
}

/** Visit every route once, unrecorded, so a dev server compiles them up front. */
async function warmUp(browser: Browser, state: any, courseUuid: string) {
  const context = await browser.newContext({ viewport: FULL, timezoneId: TZ, storageState: state })
  const page = await context.newPage()
  page.setDefaultNavigationTimeout(180_000)
  for (const path of [
    '/', '/live', '/dash/live-sessions', '/dash/live-sessions/settings',
    `/dash/courses/course/${courseUuid}/content`, `/course/${courseUuid}`,
  ]) {
    await page.goto(`${BASE}${path}`).catch(() => undefined)
  }
  const href = await page.goto(`${BASE}/live`).then(() =>
    page.locator('a[href^="/live/"]').first().getAttribute('href').catch(() => null),
  )
  if (href) {
    await page.goto(`${BASE}${href}`).catch(() => undefined)
    await page.goto(`${BASE}${href}/room`).catch(() => undefined)
  }
  await context.close()
}

async function recorded(browser: Browser, state: any, size = FULL): Promise<BrowserContext> {
  const context = await browser.newContext({
    viewport: size,
    timezoneId: TZ,
    storageState: state,
    permissions: ['camera', 'microphone'],
    recordVideo: { dir: OUT_DIR, size },
  })
  context.setDefaultNavigationTimeout(120_000)
  // Skip the first-run welcome tour; it is not part of this feature. Dev-server
  // overlays (Next.js badge, query devtools) are hidden so a recording made
  // against `next dev` looks like the product.
  await context.addInitScript(() => {
    const style = document.createElement('style')
    style.textContent = 'nextjs-portal,.tsqd-parent-container,[class*="tsqd-open-btn"]{display:none!important}'
    document.addEventListener('DOMContentLoaded', () => {
      document.head.appendChild(style)
      // The recorder only gets frames when something paints, so a page that
      // sits still yields a shorter video. A 1px ticker keeps both chapter-5
      // recordings on the same clock for the side-by-side cut.
      const tick = document.createElement('div')
      tick.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;z-index:2147483646;pointer-events:none'
      document.body.appendChild(tick)
      let on = false
      setInterval(() => {
        on = !on
        tick.style.background = on ? 'rgba(0,0,0,0.02)' : 'rgba(0,0,0,0.03)'
      }, 40)
    })
    try {
      localStorage.setItem('lh_onboarding', JSON.stringify({ welcomeSeen: true, dismissed: true }))
    } catch {
      /* storage blocked */
    }
  })
  return context
}

async function finish(context: BrowserContext, name: string) {
  const pages = context.pages()
  const videos = pages.map((p) => p.video()).filter(Boolean)
  await context.close()
  const path = await videos[0]!.path()
  renameSync(path, join(OUT_DIR, `${name}.webm`))
  console.log(`  wrote ${name}.webm`)
}

async function settle(page: Page, ms = 1200) {
  await page.waitForLoadState('networkidle').catch(() => undefined)
  await page.waitForTimeout(ms)
}

function parisClock(offsetMinutes: number) {
  const d = new Date(Date.now() + offsetMinutes * 60_000)
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  )
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` }
}

async function sessionUrl(page: Page, title: string) {
  await page.goto(`${BASE}/live`)
  await settle(page)
  const href = await page.getByRole('link', { name: new RegExp(title) }).first().getAttribute('href')
  return `${BASE}${href}`
}

// ---------------------------------------------------------------------------
// Chapters
// ---------------------------------------------------------------------------

async function ch1Settings(browser: Browser, admin: any) {
  const ctx = await recorded(browser, admin)
  const page = await ctx.newPage()
  await page.goto(`${BASE}/dash/live-sessions/settings`)
  await settle(page, 2000)
  await caption(page, '1 · Setup', 'Admins turn Live sessions on and pick which meeting providers hosts can use')
  await caption(page, '1 · Setup', 'LearnHouse Meet is built in. Nothing to install, nothing to configure')
  await page.getByText('Microsoft Teams').first().scrollIntoViewIfNeeded()
  await caption(page, '1 · Setup', 'Google Meet and Teams: one click to connect the org account. No keys, no config files. Meetings, invites and attendance then sync on their own')
  await page.mouse.wheel(0, 600)
  await caption(page, '1 · Setup', 'Defaults for new sessions, and email reminders: the day before, 15 minutes before, and when the host goes live', 3400)
  await finish(ctx, 'live-1-settings')
}

async function ch2Schedule(browser: Browser, admin: any) {
  const ctx = await recorded(browser, admin)
  const page = await ctx.newPage()
  await page.goto(`${BASE}/live`)
  await settle(page, 2000)
  await caption(page, '2 · Schedule', 'The Live page: what is on now, what is coming up by day, and past sessions with their replays')
  await page.getByRole('button', { name: 'Schedule session' }).first().click()
  await page.waitForTimeout(800)
  const dialog = page.getByRole('dialog')
  await dialog.getByPlaceholder('e.g. Week 3 office hours').fill(CLASS_TITLE)
  await dialog
    .getByPlaceholder('What will you cover? Anything to prepare?')
    .fill('Why answers stick around, how negative caching works, and how to plan a TTL change before a migration.')
  const start = parisClock(3)
  await dialog.locator('input[type="date"]').fill(start.date)
  await dialog.locator('input[type="time"]').fill(start.time)
  await dialog.getByLabel('Duration').selectOption('15')
  await caption(page, '2 · Schedule', 'Title, date and time in the host’s timezone, and a duration. Sessions can also repeat daily, weekly or monthly')
  await dialog.locator('select').filter({ hasText: 'Course learners' }).selectOption({ label: 'Course learners' })
  await dialog.locator('select').filter({ hasText: 'Not linked to a course' }).selectOption({ label: COURSE })
  await page.waitForTimeout(800)
  await dialog.locator('select').filter({ hasText: 'Don’t add to the outline' }).or(dialog.locator('select').filter({ hasText: "Don't add to the outline" })).selectOption({ index: 2 })
  await caption(page, '2 · Schedule', 'Only learners enrolled in the course can see and join it, and it appears in the course outline')
  const boardSelect = dialog.locator('select').filter({ hasText: 'No board' })
  await boardSelect.scrollIntoViewIfNeeded()
  await boardSelect.selectOption({ label: 'Week 4 class board' })
  await caption(page, '2 · Schedule', 'Attach a board. Everyone in the room can draw on it during class, even if it is private')
  const completes = dialog.getByRole('switch', { name: 'Attendance completes the activity' })
  await completes.scrollIntoViewIfNeeded()
  await completes.click()
  await dialog.locator('select').filter({ hasText: '% of the session' }).selectOption('10')
  await caption(page, '2 · Schedule', 'Waiting room, chat, Q&A, polls and reminders are on. Staying long enough completes the course activity')
  await dialog.getByRole('button', { name: 'Schedule session' }).click()
  await settle(page, 1500)
  await page.getByRole('link', { name: new RegExp(CLASS_TITLE) }).first().waitFor({ timeout: 15_000 })
  await page.getByRole('link', { name: new RegExp(CLASS_TITLE) }).first().scrollIntoViewIfNeeded()
  await caption(page, '2 · Schedule', 'Scheduled. It shows up as Starting soon, with its course, host and meeting tool')
  await page.goto(`${BASE}/dash/live-sessions`)
  await settle(page, 1800)
  await caption(page, '2 · Schedule', 'The dashboard lists every session the host manages: upcoming, past and cancelled, with series positions', 3400)
  await finish(ctx, 'live-2-schedule')
}

async function ch3Course(browser: Browser, admin: any, courseUuid: string) {
  const ctx = await recorded(browser, admin)
  const page = await ctx.newPage()
  await page.goto(`${BASE}/dash/courses/course/${courseUuid}/content`)
  await settle(page, 2500)
  await caption(page, '3 · In a course', 'Live sessions are also a course activity type. Here is the course editor')
  await page.getByText('Add Activity', { exact: true }).last().click()
  await page.waitForTimeout(900)
  await page.getByRole('dialog').getByText('Live session', { exact: true }).click()
  await page.waitForTimeout(900)
  await caption(page, '3 · In a course', 'Schedule a new session (or a weekly series) straight into this chapter, or attach one that already exists')
  const dialog = page.getByRole('dialog')
  await dialog.getByPlaceholder('e.g. Week 3 office hours').fill('Lab: debugging a broken zone together')
  const start = parisClock(60 * 26)
  await dialog.locator('input[type="date"]').fill(start.date)
  await dialog.locator('input[type="time"]').fill('18:00')
  await dialog.getByRole('button', { name: /Schedule and add to chapter/ }).click()
  await settle(page, 2000)
  const added = page.getByText('Lab: debugging a broken zone together').first()
  await added.waitFor({ timeout: 15_000 })
  await added.scrollIntoViewIfNeeded()
  await page.mouse.wheel(0, 120)
  await caption(page, '3 · In a course', 'It lands in the outline as a Live session activity', 3200)
  await finish(ctx, 'live-3-course')
}

async function ch4Learner(browser: Browser, learner: any) {
  const ctx = await recorded(browser, learner)
  const page = await ctx.newPage()
  await page.goto(`${BASE}/`)
  await settle(page, 2500)
  await caption(page, '4 · Learner', 'A learner’s view. The corner card is the in-app alert: a class they can join is live right now', 3400)
  await page.goto(`${BASE}/live`)
  await settle(page, 2000)
  await caption(page, '4 · Learner', 'They only see sessions they have access to: their course, their user groups, the org, or public ones')
  await page.getByRole('link', { name: new RegExp(CLASS_TITLE) }).first().click()
  await settle(page, 2000)
  await caption(page, '4 · Learner', 'The session page: time in the viewer’s own timezone, a countdown, the host, and what is enabled in the room')
  await page.getByRole('button', { name: 'RSVP', exact: true }).click()
  await page.waitForTimeout(1200)
  await caption(page, '4 · Learner', 'RSVP. Going learners get reminder emails, and a calendar invite when the org connected Google or Outlook')
  await page.getByRole('button', { name: 'Add to calendar' }).click()
  await page.waitForTimeout(800)
  await caption(page, '4 · Learner', 'Add to Google Calendar, Outlook or Microsoft 365, or download an .ics file (the whole series too)', 3400)
  await page.keyboard.press('Escape')
  await finish(ctx, 'live-4-learner')
}

async function ch5LiveClass(browser: Browser, admin: any, learner: any) {
  const hostCtx = await recorded(browser, admin, HALF)
  const learnCtx = await recorded(browser, learner, HALF)
  const host = await hostCtx.newPage()
  const student = await learnCtx.newPage()
  host.on('dialog', (d) => d.accept())

  const url = await sessionUrl(student, CLASS_TITLE)
  const roomUrl = `${url}/room`
  await student.goto(roomUrl)
  await settle(student, 2500)
  await Promise.all([
    caption(student, '5 · Learner', 'Joins early and waits in the waiting room'),
    host.goto(roomUrl).then(() => settle(host, 2500)),
  ])
  await caption(host, '5 · Host', 'Opens the room. The host can set up before going live')
  await host.getByRole('button', { name: 'Go live' }).click()
  await caption(host, '5 · Host', 'Goes live: everyone waiting is let in, and RSVPs get a “we’re live” email', 1500)
  await student.waitForTimeout(3500)
  await caption(student, '5 · Learner', 'Let in automatically, straight into the class video', 3400)

  // LearnHouse Meet
  await caption(host, '5 · Host', 'LearnHouse Meet: our own video room, on our own media server. Nothing to install, no outside app', 2600)
  await caption(student, '5 · Learner', 'Learners arrive muted with the camera off. One click to talk, or raise a hand', 1200)
  await student.getByRole('button', { name: 'Turn microphone on' }).click()
  await student.getByRole('button', { name: 'Raise hand' }).click()
  await host.waitForTimeout(2000)
  await caption(host, '5 · Host', 'The raised hand shows on their tile. Hosts can mute or remove anyone from the tile menu', 2400)
  await host.getByRole('button', { name: 'Mute everyone' }).click()
  await caption(host, '5 · Host', 'Or mute everyone at once. It goes through the server, so it works on every device', 2200)
  await caption(student, '5 · Learner', 'Muted by the host. Their own controls stay in their hands', 1800)
  await student.getByRole('button', { name: 'Lower hand' }).click()

  // Chat
  await host.getByPlaceholder('Send a message').fill('Welcome everyone! Today: caching, TTLs and negative answers.')
  await host.keyboard.press('Enter')
  await student.waitForTimeout(3000)
  await student.getByPlaceholder('Send a message').fill('Hi Maya! Ready with dig open 👋')
  await student.keyboard.press('Enter')
  await caption(student, '5 · Learner', 'Live chat next to the video')
  await caption(host, '5 · Host', 'Messages arrive within a couple of seconds, no extra server needed', 1800)

  // Board
  await host.getByRole('button', { name: 'Board', exact: true }).click()
  await student.getByRole('button', { name: 'Board', exact: true }).click()
  await host.waitForTimeout(2500)
  await caption(host, '5 · Host', 'The class board, one click from the video. The call keeps running underneath', 6000)
  await caption(student, '5 · Learner', 'It is a private board, but everyone in the class can draw on it, live, for as long as they stay', 7000)
  await caption(host, '5 · Host', 'Same board for everyone, synced in real time. After class it stays as it was left', 5000)
  await host.getByRole('button', { name: 'Video', exact: true }).click()
  await student.getByRole('button', { name: 'Video', exact: true }).click()

  // Q&A
  await student.locator('aside nav').getByRole('button', { name: /^Q&A/ }).click()
  await student.getByPlaceholder('Ask the host a question').fill('If I lower a TTL, how long until resolvers notice?')
  await student.getByRole('switch').first().click()
  await student.getByRole('button', { name: 'Ask', exact: true }).click()
  await caption(student, '5 · Learner', 'Asks a question anonymously. Classmates can upvote it')
  await host.locator('aside nav').getByRole('button', { name: /^Q&A/ }).click()
  await host.waitForTimeout(2500)
  await caption(host, '5 · Host', 'The host sees the queue sorted by votes, and who asked even when it is anonymous', 2400)
  const q = host.locator('div.rounded-xl').filter({ hasText: 'how long until resolvers notice' }).first()
  await q.getByRole('button', { name: /Pin/ }).click()
  await host.waitForTimeout(800)
  await q.getByRole('button', { name: /Answered/ }).click()
  await caption(host, '5 · Host', 'Pins it, answers it out loud, marks it answered', 1800)

  // Quiz
  await host.locator('aside nav').getByRole('button', { name: /^Polls/ }).click()
  await host.getByRole('button', { name: 'Quiz', exact: true }).click()
  await host.getByPlaceholder('Ask the room something').fill('A record has TTL 3600. You lower it to 300. When is the change safe?')
  await host.getByPlaceholder('Option 1').fill('Immediately')
  await host.getByPlaceholder('Option 2').fill('After the old TTL (1 hour) has passed')
  await host.getByRole('button', { name: 'Add option' }).click()
  await host.getByPlaceholder('Option 3').fill('After 5 minutes')
  await host.getByRole('button', { name: 'Mark as the correct answer' }).nth(1).click()
  await caption(host, '5 · Host', 'Launches a quick quiz (or a poll) with the correct answer marked', 1600)
  await host.getByRole('button', { name: 'Launch', exact: true }).click()
  await student.waitForTimeout(3500)
  await caption(student, '5 · Learner', 'The quiz pops up over the video', 1600)
  await student.getByRole('button', { name: /After the old TTL/ }).first().click()
  await caption(student, '5 · Learner', 'Answers. The correct answer stays hidden until the host reveals it', 2000)
  await host.waitForTimeout(4000)
  await caption(host, '5 · Host', 'Results come in live; the bots in this demo are classmates answering too', 2000)
  await host.getByRole('button', { name: 'Reveal answer' }).click()
  await student.locator('aside nav').getByRole('button', { name: /^Polls/ }).click()
  await student.waitForTimeout(3000)
  await caption(student, '5 · Learner', 'Revealed: right or wrong is shown to each learner, and saved per learner for the host', 2400)

  // Breakout rooms
  await host.locator('aside nav').getByRole('button', { name: /^Rooms/ }).click()
  await host.waitForTimeout(800)
  await caption(host, '5 · Host', 'Breakout rooms: pick how many rooms and a time limit', 1600)
  await host.getByRole('button', { name: 'Open breakout rooms' }).click()
  await host.waitForTimeout(2000)
  await caption(host, '5 · Host', 'Everyone present is shuffled into rooms. The host can move people between them', 2200)
  await student.waitForTimeout(3000)
  await student.locator('aside nav').getByRole('button', { name: /^Chat/ }).click()
  await caption(student, '5 · Learner', 'The learner is moved to their own room: separate video and a private room chat', 3000)
  await host.getByRole('button', { name: 'Bring everyone back' }).click()
  await student.waitForTimeout(3500)
  await caption(student, '5 · Learner', 'Back in the main room', 1800)
  await caption(student, '5 · Learner', 'The footer counts their time in the room toward completing the course activity', 7000)

  // People and end
  await host.locator('aside nav').getByRole('button', { name: /^People/ }).click()
  await caption(host, '5 · Host', 'Who is in the room right now. Attendance is tracked from heartbeats while they stay', 24000)
  await host.getByRole('button', { name: /End for everyone/ }).click()
  await student.waitForTimeout(4000)
  await caption(student, '5 · Learner', 'The host ends the class for everyone', 2400)
  await caption(host, '5 · Host', 'Ended. Attendance closes for everyone still in the room', 1200)
  // Close both at once: closing one waits for its video to encode, and the
  // other would keep recording in the meantime and drift out of sync.
  await Promise.all([finish(hostCtx, 'live-5-host'), finish(learnCtx, 'live-5-learner')])
}

async function ch6Report(browser: Browser, admin: any) {
  const ctx = await recorded(browser, admin)
  const page = await ctx.newPage()
  await page.goto(`${BASE}/dash/live-sessions`)
  await settle(page, 1500)
  await page.getByRole('button', { name: 'Past', exact: true }).click()
  await settle(page, 1200)
  await page.getByText(CLASS_TITLE).first().click()
  await settle(page, 1500)
  await page.getByRole('link', { name: /Attendance/ }).first().click()
  await settle(page, 2000)
  await caption(page, '6 · After class', 'Attendance: who came, for how long, who met the completion threshold, and who RSVP’d but never showed', 3600)
  await page.getByRole('link', { name: /Polls/ }).first().click()
  await settle(page, 1500)
  await page.getByRole('button', { name: /Who answered what/ }).first().click().catch(() => undefined)
  await caption(page, '6 · After class', 'Every poll and quiz from the class, with each learner’s answer', 3200)
  await page.getByRole('link', { name: /Recordings/ }).first().click()
  await settle(page, 1500)
  await caption(page, '6 · After class', 'Recordings: upload a file or paste a link, with a transcript. Teams, Meet and Zoom recordings come in on their own when connected')
  await page.getByRole('button', { name: 'Link', exact: true }).click()
  await page.getByPlaceholder('https://', { exact: true }).fill('https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4')
  await page.locator('textarea').last().fill(
    'Today we looked at caching. Every answer carries a TTL and resolvers keep it until it expires. ' +
      'Negative answers are cached too, for the SOA minimum. Before a migration, lower the TTL at least one old TTL ahead, ' +
      'make the change, then raise it again. Homework: measure how long your ISP resolver caches a record with dig.',
  )
  await page.getByRole('button', { name: 'Add recording' }).click()
  await settle(page, 2000)
  await page.getByRole('button', { name: /Summarize with AI/ }).first().click()
  await caption(page, '6 · After class', 'Summarize with AI: an overview, key points, action items and topics from the transcript', 1500)
  await page.getByText('AI summary', { exact: false }).first().waitFor({ timeout: 90_000 })
  await page.getByText('AI summary', { exact: false }).first().scrollIntoViewIfNeeded()
  await caption(page, '6 · After class', 'Generated by the org’s AI provider, ready for learners who missed it', 3600)
  await page.getByRole('button', { name: /Add to course/ }).first().click()
  await page.waitForTimeout(1200)
  await page.locator('select').filter({ hasText: 'Pick a chapter' }).selectOption({ index: 2 })
  await page.getByRole('button', { name: new RegExp(`Add to ${COURSE}`) }).click()
  await settle(page, 1500)
  await caption(page, '6 · After class', 'Added back into the course as a replay activity', 2600)
  await finish(ctx, 'live-6-after-class')
}

async function ch7Manage(browser: Browser, admin: any) {
  const ctx = await recorded(browser, admin)
  const page = await ctx.newPage()
  await page.goto(`${BASE}/dash/live-sessions`)
  await settle(page, 1500)
  await page.getByText('Cohort A office hours').first().click()
  await settle(page, 2000)
  await caption(page, '7 · Manage', 'Editing a session in a series: the same form, plus “apply to this and following sessions”')
  await page.getByLabel('Duration').selectOption('90')
  await page.getByText('Apply to this and following sessions', { exact: true }).click()
  await page.getByRole('button', { name: /^Save/ }).first().click()
  await settle(page, 1200)
  await caption(page, '7 · Manage', 'Saved for the whole rest of the series. Moving the start time shifts every later session by the same amount')
  await page.getByRole('heading', { name: 'Danger zone' }).scrollIntoViewIfNeeded()
  await caption(page, '7 · Manage', 'Cancel one session or the rest of the series (attendance and recordings are kept), or delete them', 3400)
  await finish(ctx, 'live-7-manage')
}

async function ch8CourseLearner(browser: Browser, learner: any, courseUuid: string) {
  const ctx = await recorded(browser, learner)
  const page = await ctx.newPage()
  await page.goto(`${BASE}/course/${courseUuid}`)
  await settle(page, 2500)
  await page.getByText('Expand all chapters').click().catch(() => undefined)
  await page.waitForTimeout(800)
  const week4 = page.getByText(CLASS_TITLE, { exact: true }).filter({ visible: true }).first()
  await week4.scrollIntoViewIfNeeded()
  await page.mouse.wheel(0, 160)
  await caption(page, '8 · In the course', 'Back in the course: the live class is marked complete because the learner stayed long enough', 3600)
  await page.getByText(CLASS_TITLE, { exact: true }).filter({ visible: true }).first().click()
  await settle(page, 3500)
  await caption(page, '8 · In the course', 'The live activity shows the class has ended and the attendance rule that completed it', 3000)
  await page.mouse.wheel(0, 520)
  await caption(page, '8 · In the course', 'Under it: the recording and its AI summary', 3400)
  await page.goto(`${BASE}/course/${courseUuid}`)
  await settle(page, 2000)
  await page.getByText('Expand all chapters').click().catch(() => undefined)
  await page.waitForTimeout(800)
  await page.getByText(`Replay: ${CLASS_TITLE}`, { exact: true }).filter({ visible: true }).first().click()
  await settle(page, 3500)
  await caption(page, '8 · In the course', 'The replay activity plays the recording with the AI summary under it', 2400)
  await page.mouse.wheel(0, 700)
  await caption(page, '8 · In the course', 'Overview, key points, action items, topics, and the full transcript', 3600)
  await finish(ctx, 'live-8-course')
}

async function ch9Calendar(browser: Browser, learner: any) {
  const ctx = await recorded(browser, learner)
  const page = await ctx.newPage()
  await page.goto(`${BASE}/`)
  await settle(page, 2000)
  await caption(page, '9 · Calendar', 'New in the top bar: the calendar, one place for everything with a date', 2400)
  await page.getByRole('link', { name: 'Calendar', exact: true }).first().click()
  await settle(page, 2500)
  await caption(page, '9 · Calendar', 'Live sessions, assignment deadlines, chapters opening and closing on the course schedule, and course updates', 3600)
  await caption(page, '9 · Calendar', 'Only from courses this learner is in, in their own timezone. The legend lists what is on screen', 3000)
  await page.getByRole('button', { name: 'Agenda', exact: true }).click()
  await settle(page, 1500)
  await caption(page, '9 · Calendar', 'Agenda view, day by day with status: live, to do, closing soon, upcoming', 2600)
  await page.mouse.wheel(0, 520)
  await page.waitForTimeout(900)
  await caption(page, '9 · Calendar', 'Drip dates are this learner\u2019s own: a cohort start date, or their enrollment', 3000)
  await page.getByText('Week 4 · Caching and TTLs opens').first().click()
  await settle(page, 3000)
  await page.getByText('Week 4 · Caching and TTLs').first().scrollIntoViewIfNeeded().catch(() => undefined)
  await caption(page, '9 · Calendar', 'Into the course: the chapter is still locked, with the date it opens', 3000)
  await finish(ctx, 'live-9-calendar')
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true })
  const courseUuid = process.env.DEMO_COURSE_UUID || ''
  const only = (process.env.DEMO_ONLY || '1,2,3,4,5,6,7,8,9').split(',')
  const browser = await chromium.launch({
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
  })
  const admin = await signIn(browser, ADMIN)
  const learner = await signIn(browser, LEARNER)
  if (process.env.DEMO_WARMUP !== '0') await warmUp(browser, admin, courseUuid)
  const run = async (n: string, fn: () => Promise<void>) => {
    if (!only.includes(n)) return
    console.log(`chapter ${n}`)
    await fn()
  }
  await run('1', () => ch1Settings(browser, admin))
  await run('2', () => ch2Schedule(browser, admin))
  await run('3', () => ch3Course(browser, admin, courseUuid))
  await run('4', () => ch4Learner(browser, learner))
  await run('5', () => ch5LiveClass(browser, admin, learner))
  await run('6', () => ch6Report(browser, admin))
  await run('7', () => ch7Manage(browser, admin))
  await run('8', () => ch8CourseLearner(browser, learner, courseUuid))
  await run('9', () => ch9Calendar(browser, learner))
  await browser.close()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
