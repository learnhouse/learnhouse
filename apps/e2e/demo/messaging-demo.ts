/**
 * Recorded walkthrough of Messages: direct messages, groups, course
 * announcements, reactions, presence, typing, read receipts, course sharing,
 * search, notification preferences, unread emails, and the AI agents that
 * replace the copilot.
 *
 * This is a *demo*, not a test: `playwright.config.ts` only collects specs
 * under `features/`. It drives the real UI as the admin while a second
 * person (a teacher, signed in over the API) types, replies and reacts, so
 * the realtime parts are real round trips, not mocks.
 *
 * Needs an instance where messaging is enabled (Pro plan in SaaS, or EE),
 * AI configured, course content indexed, and the teacher account below.
 *
 *   export E2E_BASE_URL=http://localhost:3047
 *   export E2E_API_URL=http://localhost:1371/api/v1
 *   export E2E_ADMIN_PASSWORD='...'
 *   export DEMO_TEACHER_EMAIL=... DEMO_TEACHER_PASSWORD=...
 *   export DEMO_UNREAD_EMAIL_HTML=/path/to/unread_email.html   # optional
 *   bun run demo/messaging-demo.ts      # -> demo/output/messaging.webm
 */
import { fileURLToPath } from 'node:url'
import { appendFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { chromium, Browser, Locator, Page } from '@playwright/test'

import { ADMIN_EMAIL, ADMIN_PASSWORD, API_URL, BASE_URL } from '../core/instance'
import { req, login, getOrg } from '../core/client'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = join(HERE, 'output')
const SHOTS = process.env.DEMO_SHOTS === '1'
const VIEWPORT = { width: 1440, height: 900 }
const TEACHER_EMAIL = process.env.DEMO_TEACHER_EMAIL || ''
const TEACHER_PASSWORD = process.env.DEMO_TEACHER_PASSWORD || ''
const EMAIL_HTML = process.env.DEMO_UNREAD_EMAIL_HTML || ''
// Comma-separated step names to run (debugging); empty runs the whole tour.
const ONLY = (process.env.DEMO_ONLY || '').split(',').filter(Boolean)

let shot = 0
async function caption(page: Page, step: string, text: string, holdMs = 2600): Promise<void> {
  await page.waitForTimeout(500)
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

/** A demo step that must not take the whole recording down if one selector drifts. */
async function step(name: string, fn: () => Promise<void>): Promise<void> {
  if (ONLY.length && !ONLY.includes(name)) return
  try {
    await fn()
    appendFileSync(join(OUT_DIR, 'steps.log'), `ok   ${name}\n`)
  } catch (e) {
    const msg = (e as Error).message.split('\n').slice(0, 3).join(' | ')
    appendFileSync(join(OUT_DIR, 'steps.log'), `FAIL ${name}: ${msg}\n`)
    console.warn(`[demo] step "${name}" failed: ${msg}`)
  }
}

const composer = (page: Page): Locator => page.locator('[data-messages-thread] textarea').last()

async function typeInto(page: Page, text: string, delay = 28): Promise<void> {
  await composer(page).click()
  await page.keyboard.type(text, { delay })
}

async function send(page: Page, text: string): Promise<void> {
  await typeInto(page, text)
  await page.waitForTimeout(300)
  await page.keyboard.press('Enter')
}

async function openConversation(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name }).first().click()
  await page.waitForTimeout(1500)
}

/** Waits until no agent reply in the open thread is still streaming. */
async function waitForAgent(page: Page, token: string, conversationUuid: string, timeoutMs = 90_000): Promise<void> {
  const started = Date.now()
  await page.waitForTimeout(1500)
  while (Date.now() - started < timeoutMs) {
    const page_ = await req<any>('GET', `/messaging/conversations/${conversationUuid}/messages?limit=5`, token)
    if (!page_.messages.some((m: any) => m.status === 'streaming')) return
    await page.waitForTimeout(800)
  }
}

/** Closes stray overlays and makes sure the Messages app is on screen. */
async function backToMessages(page: Page): Promise<void> {
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  if (!new URL(page.url()).pathname.startsWith('/messages')) {
    await page.goto(`${BASE_URL}/messages`)
  }
  await page.getByRole('heading', { name: 'Messages', level: 1 }).waitFor({ timeout: 30_000 })
  await page.waitForTimeout(800)
}

function currentConversation(page: Page): string {
  return new URL(page.url()).searchParams.get('c') || ''
}

/** Keeps a person "online": holds their live stream open until aborted. */
function goOnline(token: string, orgId: number): AbortController {
  const controller = new AbortController()
  fetch(`${API_URL}/messaging/stream?org_id=${orgId}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: controller.signal,
  })
    .then(async (res) => {
      const reader = res.body?.getReader()
      while (reader) {
        const { done } = await reader.read()
        if (done) break
      }
    })
    .catch(() => undefined)
  return controller
}

async function main(): Promise<void> {
  mkdirSync(join(OUT_DIR, 'shots'), { recursive: true })
  if (!TEACHER_EMAIL || !TEACHER_PASSWORD) throw new Error('Set DEMO_TEACHER_EMAIL and DEMO_TEACHER_PASSWORD')
  const org = await getOrg()
  const adminToken = await login(ADMIN_EMAIL, ADMIN_PASSWORD)
  const teacherToken = await login(TEACHER_EMAIL, TEACHER_PASSWORD)
  const teacherConvs = await req<any[]>('GET', `/messaging/conversations?org_id=${org.id}`, teacherToken)
  const adminUsername = (await req<any>('GET', '/users/profile', adminToken).catch(() => null))?.username || 'admin'
  const teacherDm = teacherConvs.find((c) => c.kind === 'dm' && c.members.some((m: any) => m.username === adminUsername))
  const courses = await req<any[]>('GET', `/courses/org_slug/${org.slug}/page/1/limit/20`, adminToken)
  const support = courses.find((c) => c.name === 'Customer Support Fundamentals') || courses[0]

  const browser: Browser = await chromium.launch()
  const context = await browser.newContext({ viewport: VIEWPORT, recordVideo: { dir: OUT_DIR, size: VIEWPORT } })
  await context.addInitScript(() => {
    try {
      window.localStorage.setItem(
        'lh_onboarding',
        JSON.stringify({ completedSteps: [], skippedSteps: [], minimized: true, expanded: false, showAllSteps: false, dismissed: true, welcomeSeen: true }),
      )
    } catch { /* ignore */ }
  })
  const page = await context.newPage()
  let teacherOnline: AbortController | null = null

  try {
    // ── Sign in ──────────────────────────────────────────────────────────
    await page.goto(`${BASE_URL}/login`)
    await page.getByRole('textbox', { name: 'Email' }).fill(ADMIN_EMAIL)
    await page.getByRole('textbox', { name: 'Password' }).fill(ADMIN_PASSWORD)
    await page.getByRole('button', { name: 'Login', exact: true }).click()
    await page.waitForURL((u) => !/\/login(\?|$)/.test(u.toString()), { timeout: 60_000 })
    await page.goto(`${BASE_URL}/`)
    await page.waitForTimeout(2500)

    // ── 1. Entry point ───────────────────────────────────────────────────
    await step('entry', async () => {
      const link = page.getByRole('link', { name: /^Messages/ })
      await link.hover()
      await caption(page, 'Messages', 'One place for people and AI agents. The badge counts unread messages, live', 3000)
      await link.click()
      await page.getByRole('heading', { name: 'Messages', level: 1 }).waitFor()
    })

    // ── 2. Inbox ─────────────────────────────────────────────────────────
    await step('inbox', async () => {
      await caption(page, 'Inbox', 'Direct messages, groups, course announcements and agent chats, newest first', 3200)
      for (const chip of ['Unread', 'People', 'Groups', 'Courses', 'Agents', 'All']) {
        await page.getByRole('button', { name: new RegExp(`^${chip}`) }).first().click()
        await page.waitForTimeout(chip === 'All' ? 600 : 1100)
      }
      await caption(page, 'Filters', 'Filter by unread, people, groups, course channels or agents', 2200)
    })

    // ── 3. Presence ──────────────────────────────────────────────────────
    await step('presence', async () => {
      teacherOnline = goOnline(teacherToken, org.id)
      await page.waitForTimeout(2500)
      await caption(page, 'Presence', 'Amara just opened LearnHouse on her laptop: the green dot appears instantly', 3200)
    })

    // ── 4. Direct message with an unread question ────────────────────────
    await step('dm-unread', async () => {
      await openConversation(page, 'Benoit Kovac')
      await caption(page, 'Direct messages', 'Unread messages start under a "New" divider; opening the chat marks them read', 3000)
      await page.getByTitle('Emoji').first().click()
      await page.waitForTimeout(1600)
      await caption(page, 'Emoji', 'Full emoji picker in the composer', 1800)
      await page.keyboard.press('Escape')
      await send(page, 'Yes, it is open book 📖 and you get a second attempt if you need it.')
      await page.waitForTimeout(1200)
    })

    // ── 5. Realtime with the teacher ─────────────────────────────────────
    await step('dm-realtime', async () => {
      await openConversation(page, 'Amara Dunmore')
      await caption(page, 'Status', 'Her header shows she is online, plus her custom status', 2800)
      if (teacherDm) {
        await req('POST', `/messaging/conversations/${teacherDm.conversation_uuid}/typing`, teacherToken, { is_typing: true })
        await caption(page, 'Typing', 'Amara is typing on her side…', 2600)
        await req('POST', `/messaging/conversations/${teacherDm.conversation_uuid}/messages`, teacherToken, {
          content: 'The refund policy link is live in lesson 3 ✅ Mind giving it a quick look?',
        })
        await page.waitForTimeout(1500)
        await caption(page, 'Realtime', 'Her message arrives over the live connection, no refresh', 2600)
      }

      // React from the hover toolbar.
      const last = page.locator('[data-messages-thread] [id^="msg-"]').last()
      await last.hover()
      await page.waitForTimeout(700)
      await last.getByRole('button', { name: '❤️' }).click()
      await page.waitForTimeout(800)
      await caption(page, 'Reactions', 'Hover any message for quick reactions, the full picker, reply, copy, edit and delete', 3000)

      // Reply to her message.
      await last.hover()
      await last.getByTitle('Reply').click()
      await send(page, 'Looks great. I will share it with the support crew 🙌')
      await page.waitForTimeout(1200)

      if (teacherDm) {
        await req('POST', `/messaging/conversations/${teacherDm.conversation_uuid}/read`, teacherToken, {})
        await page.waitForTimeout(1200)
        await caption(page, 'Read receipts', 'The moment Amara reads it, "Seen" appears under your message', 2600)
        const mine = await req<any>('GET', `/messaging/conversations/${teacherDm.conversation_uuid}/messages?limit=1`, teacherToken)
        const lastUuid = mine.messages.at(-1)?.message_uuid
        if (lastUuid) {
          await req('POST', `/messaging/messages/${lastUuid}/reactions`, teacherToken, { emoji: '🎉' })
          await page.waitForTimeout(1200)
          await caption(page, 'Live reactions', 'Her 🎉 reaction lands live too', 2200)
        }
      }

      // Edit with ArrowUp, then delete.
      await composer(page).click()
      await page.keyboard.press('ArrowUp')
      await page.waitForTimeout(800)
      await page.keyboard.press('End')
      await page.keyboard.type(' Thanks!', { delay: 40 })
      await page.keyboard.press('Enter')
      await page.waitForTimeout(1000)
      await caption(page, 'Edit', 'Press ↑ in an empty composer to edit your last message', 2400)
      await send(page, 'oops, wrong chat')
      await page.waitForTimeout(1200)
      const oops = page.locator('[data-messages-thread] [id^="msg-"]').last()
      await oops.hover()
      await oops.getByTitle('Delete').click()
      await page.waitForTimeout(500)
      await oops.getByRole('button', { name: 'Delete?' }).click()
      await caption(page, 'Delete', 'Delete with a confirm; everyone sees it removed', 2200)
    })

    // ── 6. Share a course ────────────────────────────────────────────────
    await step('share-course', async () => {
      await backToMessages(page)
      await page.getByTitle('Share a course').click()
      await page.getByPlaceholder('Find a course to share').fill('Compliance')
      await page.waitForTimeout(900)
      await page.getByRole('button', { name: /Compliance Essentials/ }).last().click()
      await page.waitForTimeout(700)
      await typeInto(page, 'This one is due Friday')
      await page.keyboard.press('Enter')
      await page.waitForTimeout(1500)
      await caption(page, 'Share a course', 'Share any course as a rich card, straight from the composer', 2800)
    })

    // ── 7. New group + agent mention ─────────────────────────────────────
    await step('group', async () => {
      await backToMessages(page)
      await page.getByRole('button', { name: 'New message', exact: true }).click()
      const search = page.getByRole('dialog').locator('input').first()
      for (const who of ['Benoit', 'Carys']) {
        await search.fill(who)
        await page.waitForTimeout(1200)
        await page.getByRole('dialog').getByRole('button', { name: new RegExp(who) }).first().click()
        await page.waitForTimeout(500)
      }
      await caption(page, 'New group', 'Pick people (presence and status included) to start a DM or a group', 2600)
      await page.getByPlaceholder(/Group name/).fill('Compliance study group')
      await page.getByRole('dialog').getByRole('button', { name: /Create group|Start chat/ }).click()
      await page.waitForTimeout(2200)
      await typeInto(page, '@Quiz')
      await page.waitForTimeout(900)
      await caption(page, 'Mention an agent', 'Type @ to bring any agent into a group conversation', 2400)
      await page.keyboard.press('Enter')
      await page.keyboard.type('quiz the three of us on what counts as a breach', { delay: 25 })
      await page.keyboard.press('Enter')
      await page.waitForTimeout(2000)
      await caption(page, 'Agents in groups', 'The agent searches the courses, then streams its answer to everyone in the group', 3000)
      await waitForAgent(page, adminToken, currentConversation(page))
      await page.waitForTimeout(1000)
      await page.locator('[data-messages-thread] [id^="msg-"]').last().scrollIntoViewIfNeeded()
      await caption(page, 'Interactive quiz', 'Quizzes are interactive: pick an answer to check it', 2400)
      const options = page.locator('[data-messages-thread] [id^="msg-"]').last().locator('button[type="button"]')
      if (await options.count()) await options.nth(1).click()
      await page.waitForTimeout(1600)
    })

    // ── 8. Course announcement ───────────────────────────────────────────
    await step('broadcast', async () => {
      await backToMessages(page)
      await page.getByRole('button', { name: 'Message everyone in a course' }).click()
      await page.waitForTimeout(1000)
      await caption(page, 'Announcements', 'Teachers message everyone enrolled in their course; admins can reach the whole org', 3000)
      await page.getByRole('dialog').getByRole('button', { name: /Compliance Essentials/ }).click()
      await page.getByPlaceholder('Write your announcement…').click()
      await page.keyboard.type('Reminder: the Compliance Essentials assessment opens Monday. Review "When something goes wrong" first 📌', { delay: 18 })
      await page.waitForTimeout(800)
      await page.getByRole('dialog').getByRole('button', { name: /Send announcement/ }).click()
      await page.waitForTimeout(2200)
      await caption(page, 'Course channel', '20 learners get it in their Messages. They can react; only the course team posts', 3000)
    })

    // ── 9. Copilot agent ─────────────────────────────────────────────────
    await step('copilot', async () => {
      await backToMessages(page)
      await page.getByRole('button', { name: /^Copilot/ }).first().click()
      await page.waitForTimeout(2000)
      await caption(page, 'Copilot', 'The copilot now lives in Messages as the default agent', 2600)
      await send(page, 'How should I reply to a customer who is angry about a late refund?')
      await page.waitForTimeout(1500)
      await caption(page, 'Grounded answers', 'It shows what it is doing: searching your courses, sources found, then writing', 3000)
      await waitForAgent(page, adminToken, currentConversation(page))
      await page.waitForTimeout(1200)
      const chip = page.locator('[data-messages-thread] [id^="msg-"]').last().locator('button').filter({ hasText: /^\d$/ }).first()
      if (await chip.count()) {
        await chip.hover()
        await page.waitForTimeout(1400)
        await caption(page, 'Citations', 'Every claim links back to the exact lesson it came from', 2800)
      }
      await page.locator('[data-messages-thread]').evaluate((m) => m.querySelectorAll('[class*="overflow-y-auto"]').forEach((el) => el.scrollTo({ top: el.scrollHeight })))
      await caption(page, 'Follow-ups', 'Suggested follow-up questions, one click away', 2200)
      const follow = page.locator('[data-messages-thread] [id^="msg-"]').last().getByRole('button').filter({ hasText: /\?$/ }).first()
      if (await follow.count()) {
        await follow.click()
        await page.waitForTimeout(1500)
        await waitForAgent(page, adminToken, currentConversation(page))
        await page.waitForTimeout(1500)
      }
    })

    // ── 9b. Agents generate and remember ─────────────────────────────────
    await step('agent-generate', async () => {
      await backToMessages(page)
      await page.getByRole('button', { name: /^Copilot/ }).first().click()
      await page.waitForTimeout(1500)
      await send(page, 'Make me a mind map of Compliance Essentials, then a timeline of the first hour after a breach.')
      await page.waitForTimeout(1500)
      await waitForAgent(page, adminToken, currentConversation(page))
      await page.waitForTimeout(1200)
      const last = page.locator('[data-messages-thread] [id^="msg-"]').last()
      await last.scrollIntoViewIfNeeded()
      await caption(page, 'Generate', 'Agents generate mind maps, timelines, charts, exercises, quizzes and flashcards', 3200)
      await page.locator('[data-messages-thread]').evaluate((m) => m.querySelectorAll('[class*="overflow-y-auto"]').forEach((el) => el.scrollBy({ top: 420, behavior: 'smooth' })))
      await page.waitForTimeout(2200)
    })
    await step('agent-reminder', async () => {
      await send(page, 'Remind me in 1 minute to review the breach chapter.')
      await page.waitForTimeout(1500)
      await waitForAgent(page, adminToken, currentConversation(page))
      await page.waitForTimeout(1200)
      await caption(page, 'Reminders', 'Ask any agent to remind you. It schedules it in your time zone, and you can cancel it', 3200)
      await page.getByRole('button', { name: /^Reminders/ }).first().click()
      await page.waitForTimeout(1500)
      await caption(page, 'Upcoming', 'Every upcoming reminder in one place', 2400)
      await page.keyboard.press('Escape')
    })
    await step('remind-me', async () => {
      await backToMessages(page)
      await openConversation(page, 'Benoit Kovac')
      const msg = page.locator('[data-messages-thread] [id^="msg-"]').filter({ hasText: 'open book' }).first()
      await msg.hover()
      await page.waitForTimeout(600)
      await msg.getByTitle('Remind me').click()
      await page.waitForTimeout(800)
      await caption(page, 'Remind me', 'Or set your own reminder on any message', 2200)
      await page.getByRole('button', { name: 'Tomorrow at 9:00' }).click()
      await page.waitForTimeout(1500)
    })

    // ── 10. Build an agent ───────────────────────────────────────────────
    await step('builder', async () => {
      await backToMessages(page)
      await page.getByRole('button', { name: 'New agent', exact: true }).click()
      await page.waitForTimeout(1200)
      await caption(page, 'Build an agent', 'Anyone can build their own agent: name, emoji, colors, tone and knowledge', 3000)
      await page.getByPlaceholder('Name, e.g. Quizzy').fill('Flashcard Fox')
      await page.getByPlaceholder('What does it help with?').fill('Turns any lesson into flashcards.')
      await step('builder-emoji', async () => {
        await page.getByRole('button', { name: 'Pick an emoji' }).click()
        const picker = page.locator('em-emoji-picker')
        await picker.locator('input').first().fill('fox')
        await page.waitForTimeout(700)
        await picker.locator('.category button').first().click()
        await page.waitForTimeout(500)
      })
      await page.getByTitle('Mint').click()
      await page.waitForTimeout(600)
      await page.getByRole('dialog').getByRole('button', { name: /^Playful/ }).click()
      await page.getByPlaceholder('Search courses').fill('Support')
      await page.waitForTimeout(700)
      await page.getByRole('dialog').getByRole('button', { name: /Customer Support Fundamentals/ }).first().click()
      await page.getByPlaceholder(/How should it behave/).fill('Always answer with a flashcards block of 4 to 6 cards, then one sentence of encouragement.')
      await page.getByPlaceholder('Hi! What are we learning today?').fill('Give me a topic and I will make flashcards 🦊')
      const starter = page.getByPlaceholder('e.g. Quiz me on chapter 2')
      await starter.fill('Make flashcards for support jargon')
      await starter.press('Enter')
      await page.waitForTimeout(800)
      await caption(page, 'Live preview', 'The preview updates as you type; scope it to specific courses or all of them', 2800)
      await page.getByRole('dialog').getByRole('button', { name: 'Create agent' }).click()
      await page.waitForTimeout(2500)
      await page.getByRole('button', { name: 'Make flashcards for support jargon' }).click()
      await page.waitForTimeout(1500)
      await waitForAgent(page, adminToken, currentConversation(page))
      await page.waitForTimeout(1200)
      await caption(page, 'Flashcards', 'Rich blocks: flip cards, step-by-step plans, quizzes and course cards', 2600)
      const card = page.locator('[data-messages-thread] [id^="msg-"]').last().locator('[role="button"], button').filter({ hasText: /.{4,}/ }).first()
      if (await card.count()) {
        await card.click()
        await page.waitForTimeout(1300)
      }
      const next = page.getByRole('button', { name: 'Next card' }).last()
      if (await next.count()) {
        await next.click()
        await page.waitForTimeout(1300)
      }
    })

    // ── 11. All agents ───────────────────────────────────────────────────
    await step('gallery', async () => {
      await page.goto(`${BASE_URL}/messages?agents=1`)
      await page.waitForTimeout(2500)
      await caption(page, 'Agents', 'Your agents and the ones shared with everyone. Admins can share agents org-wide', 3000)
    })

    // ── 11b. The reminder arrives ────────────────────────────────────────
    await step('reminder-delivered', async () => {
      await backToMessages(page)
      // The one-minute reminder set earlier has been delivered by now.
      await page.waitForTimeout(3000)
      await page.getByRole('button', { name: /^Copilot/ }).first().click()
      await page.waitForTimeout(2000)
      await caption(page, 'Delivered', 'A minute later the agent brings it back up, live, and by email if it stays unread', 3400)
    })

    // ── 12. Search ───────────────────────────────────────────────────────
    await step('search', async () => {
      await backToMessages(page)
      await page.getByPlaceholder('Search conversations and messages').fill('refund')
      await page.waitForTimeout(2000)
      await caption(page, 'Search', 'Search every conversation and jump straight to the message', 2400)
      const hit = page.locator('aside').getByRole('button').filter({ hasText: /refund/i }).last()
      if (await hit.count()) {
        await hit.click()
        await page.waitForTimeout(2200)
      }
      await page.getByPlaceholder('Search conversations and messages').fill('')
    })

    // ── 13. Status & notification preferences ────────────────────────────
    await step('settings', async () => {
      await backToMessages(page)
      await page.getByRole('button', { name: 'Messages settings' }).click()
      await page.waitForTimeout(1200)
      await caption(page, 'Settings', 'Set a status, choose how you show up, and decide when we notify you', 2800)
      await page.getByRole('dialog').getByRole('button', { name: /Studying/ }).click()
      await page.getByRole('dialog').getByRole('button', { name: /Save status/ }).click()
      await page.waitForTimeout(800)
      await page.getByRole('dialog').getByRole('button', { name: /Do not disturb/ }).click()
      await page.waitForTimeout(800)
      await caption(page, 'Availability', 'Do not disturb mutes sounds and desktop alerts; invisible appears offline', 2600)
      await page.getByRole('dialog').getByRole('button', { name: 'All messages' }).scrollIntoViewIfNeeded()
      await page.getByRole('dialog').getByRole('button', { name: 'All messages' }).click()
      await page.getByRole('dialog').getByRole('button', { name: '4h' }).click()
      await page.waitForTimeout(800)
      await caption(page, 'Unread emails', 'Messages still unread after an hour (your choice) arrive as one summary email', 3000)
      await page.getByRole('dialog').getByText('Privacy').scrollIntoViewIfNeeded()
      await page.waitForTimeout(800)
      await caption(page, 'Privacy', 'Read receipts, typing indicators and who can DM you are all yours to switch off', 2600)
      await page.keyboard.press('Escape')
      await page.waitForTimeout(800)
    })

    // ── 14. Entry points elsewhere ───────────────────────────────────────
    await step('course-share-button', async () => {
      if (!support) return
      await page.goto(`${BASE_URL}/course/${String(support.course_uuid).replace('course_', '')}`)
      await page.waitForTimeout(3000)
      const btn = page.getByRole('link', { name: /Share in Messages/ }).or(page.getByRole('button', { name: /Share in Messages/ })).first()
      await btn.scrollIntoViewIfNeeded()
      await btn.hover()
      await caption(page, 'Course pages', 'Every course page gets a "Share in Messages" button', 2600)
    })
    // ── 15. The chat dock on every page ──────────────────────────────────
    await step('dock', async () => {
      const dock = page.locator('[data-chat-dock]')
      await page.goto(`${BASE_URL}/courses`)
      await page.waitForTimeout(3000)
      const launcher = page.getByRole('button', { name: /^Chats/ })
      await launcher.hover()
      await caption(page, 'Chat dock', 'Outside Messages, chats dock at the bottom of every page', 2800)
      await launcher.click()
      await caption(page, 'Chats', 'Your chats, unread first-class, and your agents one click away', 2800)

      // Copilot from the agent strip, answering in a small window.
      await dock.getByRole('button', { name: /^Copilot/ }).first().click()
      await page.waitForTimeout(2000)
      await dock.locator('textarea').last().click()
      await page.keyboard.type('What should I review before the Compliance Essentials quiz? Keep it short.', { delay: 22 })
      await page.keyboard.press('Enter')
      await page.waitForTimeout(1500)
      const convs = await req<any[]>('GET', `/messaging/conversations?org_id=${org.id}`, adminToken)
      const copilot = convs.filter((c) => c.kind === 'agent').sort((a, b) => String(b.last_message_at).localeCompare(String(a.last_message_at)))[0]
      if (copilot) await waitForAgent(page, adminToken, copilot.conversation_uuid)
      await page.waitForTimeout(1200)
      await caption(page, 'Agents too', 'Same agents, same sources and rich answers, without leaving the page', 3200)

      // Minimize, then a message from the teacher pops a chat head.
      await dock.getByRole('button', { name: 'Minimize' }).first().click()
      await caption(page, 'Chat heads', 'Minimized chats wait as heads above the launcher', 2400)
      if (teacherDm) {
        await req('POST', `/messaging/conversations/${teacherDm.conversation_uuid}/typing`, teacherToken, { is_typing: true })
        await page.waitForTimeout(1200)
        await req('POST', `/messaging/conversations/${teacherDm.conversation_uuid}/messages`, teacherToken, {
          content: 'Are you joining the review session at 5?',
        })
        await page.waitForTimeout(1500)
        await caption(page, 'Live', 'A new message pops its chat head with the unread count', 2800)
        await dock.getByRole('button', { name: /^Amara Dunmore/ }).first().click()
        await page.waitForTimeout(1800)
        await dock.locator('textarea').last().click()
        await page.keyboard.type('Yes, see you there!', { delay: 30 })
        await page.keyboard.press('Enter')
        await page.waitForTimeout(1200)
        await caption(page, 'Reply in place', 'Read and reply without leaving the course catalog', 2600)
      }

      // The dock follows you to the next page.
      if (support) {
        await page.goto(`${BASE_URL}/course/${String(support.course_uuid).replace('course_', '')}`)
        await page.waitForTimeout(3000)
        await caption(page, 'Everywhere', 'Open chats and heads stay put as you move around', 2600)
      }
    })
    await step('profile-button', async () => {
      await page.locator('[data-chat-dock]').getByRole('button', { name: 'Close chat' }).first().click().catch(() => undefined)
      await page.goto(`${BASE_URL}/user/demo_amara_dunmore`)
      await page.waitForTimeout(3000)
      const btn = page.getByRole('link', { name: /^Message$/ }).or(page.getByRole('button', { name: /^Message$/ })).first()
      await btn.hover()
      await page.waitForTimeout(600)
      await btn.click()
      await page.waitForTimeout(2000)
      await caption(page, 'Profiles', 'And "Message" on any profile opens the chat right there', 2800)
      await page.locator('[data-chat-dock]').getByRole('button', { name: 'Open in Messages' }).first().click()
      await page.getByRole('heading', { name: 'Messages', level: 1 }).waitFor({ timeout: 30_000 })
      await page.waitForTimeout(1200)
      await caption(page, 'Full view', 'Expand any chat into Messages for the full view', 2600)
    })

    // ── 16. The unread email ─────────────────────────────────────────────
    await step('email', async () => {
      if (!EMAIL_HTML || !existsSync(EMAIL_HTML)) return
      await page.goto(`file://${EMAIL_HTML}`)
      await page.waitForTimeout(1500)
      await caption(page, 'Email', 'The real unread-messages email for this account, in the org\'s branding', 3600)
    })

    await step('outro', async () => {
      await page.goto(`${BASE_URL}/messages`)
      await page.waitForTimeout(2500)
      await caption(page, 'Messages', 'Pro plan in the cloud, Enterprise Edition when self-hosted', 3200)
    })
  } finally {
    ;(teacherOnline as AbortController | null)?.abort()
    const video = page.video()
    await context.close().catch((e) => console.warn('context close:', (e as Error).message))
    if (video) {
      const dest = join(OUT_DIR, 'messaging.webm')
      await video.saveAs(dest)
      await video.delete()
      console.log(`video: ${dest}`)
    }
    await browser.close()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
