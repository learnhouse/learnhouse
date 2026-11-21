/**
 * Page health guard.
 *
 * Collects the things a learner would experience as "broken" while a spec
 * drives a page: uncaught exceptions, React/Next error overlays, API 5xx
 * answers, and raw i18n keys leaking into visible text. Specs call
 * `guard.check()` (or `expectHealthy`) at the points they care about, so a
 * journey fails with a readable list instead of a timeout three steps later.
 */
import type { Page, Response } from '@playwright/test'
import { expect } from '@playwright/test'

/** Console / page errors that are noise in a local dev stack, not app bugs. */
const IGNORED_ERRORS: RegExp[] = [
  /Download the React DevTools/i,
  /\[Fast Refresh\]/i,
  /\[HMR\]/i,
  /posthog/i,
  /sentry/i,
  /ResizeObserver loop/i,
  // Third-party embeds / fonts that a sandboxed CI box can't reach.
  /fonts\.(googleapis|gstatic)\.com/i,
  /youtube\.com|ytimg\.com|vimeo\.com/i,
  /net::ERR_(INTERNET_DISCONNECTED|NAME_NOT_RESOLVED|BLOCKED_BY_CLIENT)/i,
  // Aborted fetches when a spec navigates away mid-request.
  /AbortError|The user aborted a request|signal is aborted|Load failed|NetworkError when attempting to fetch|Failed to fetch/i,
]

export interface GuardIssue {
  kind: 'pageerror' | 'api5xx' | 'overlay'
  detail: string
}

export class PageGuard {
  readonly issues: GuardIssue[] = []
  private readonly ignore: RegExp[]

  constructor(
    private readonly page: Page,
    opts: { ignore?: RegExp[] } = {},
  ) {
    this.ignore = [...IGNORED_ERRORS, ...(opts.ignore ?? [])]
    // WebKit reports a fetch cancelled by navigation (prefetches, in-flight
    // API calls when a spec moves on) as "Fetch API cannot load … due to access
    // control checks", the same words as a real CORS failure. Ignore it on
    // WebKit only; Chromium and Firefox still catch real CORS errors.
    if (page.context().browser()?.browserType().name() === 'webkit') {
      this.ignore.push(/Fetch API cannot load .* due to access control checks/i)
    }
    page.on('pageerror', (err) => {
      if (process.env.E2E_GUARD_STACKS) console.log('[guard stack]', err.stack)
      const msg = `${err.name}: ${err.message}`
      if (!this.ignored(msg)) this.issues.push({ kind: 'pageerror', detail: msg })
    })
    page.on('response', (res: Response) => {
      const status = res.status()
      if (status < 500) return
      const url = res.url()
      if (!/\/api\/v1\//.test(url)) return
      if (this.ignored(url)) return
      this.issues.push({ kind: 'api5xx', detail: `${status} ${res.request().method()} ${url}` })
    })
  }

  private ignored(text: string): boolean {
    return this.ignore.some((re) => re.test(text))
  }

  /** Extra patterns to ignore for the rest of this test. */
  allow(re: RegExp): void {
    this.ignore.push(re)
  }

  /** Assert no issues so far (and no Next.js error overlay on screen). */
  async check(label = ''): Promise<void> {
    const overlay = await this.page
      .locator('nextjs-portal, [data-nextjs-dialog], #__next-build-watcher [data-nextjs-toast-errors]')
      .count()
      .catch(() => 0)
    if (overlay > 0) {
      const text = await this.page.locator('nextjs-portal').first().innerText().catch(() => '')
      if (text && /Unhandled Runtime Error|Runtime Error|Console Error|Build Error/i.test(text)) {
        this.issues.push({ kind: 'overlay', detail: text.slice(0, 400) })
      }
    }
    const errorScreen = await this.page
      .getByText(/Application error: a client-side exception has occurred/i)
      .count()
      .catch(() => 0)
    if (errorScreen) this.issues.push({ kind: 'overlay', detail: 'Next.js client-side exception screen' })
    const lines = this.issues.map((i) => `[${i.kind}] ${i.detail}`)
    expect(lines, `page health${label ? ` (${label})` : ''}`).toEqual([])
  }
}

/**
 * Raw i18n keys in visible text, e.g. "courses.enroll_button". Matches text
 * nodes whose whole content looks like a dotted key; skips code/pre and
 * things that are obviously URLs or file names.
 */
export async function findRawI18nKeys(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out = new Set<string>()
    const keyRe = /^[a-z][a-zA-Z0-9]*(?:[._][a-zA-Z0-9]+)*\.[a-z][a-zA-Z0-9_]+$/
    const notKey = /\.(com|io|org|net|dev|app|me|png|jpe?g|svg|pdf|mp4|json|js|ts|tsx|py|html|zip)$/i
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    let n: Node | null
    while ((n = walker.nextNode())) {
      const el = n.parentElement
      if (!el) continue
      if (el.closest('code, pre, script, style, [contenteditable="true"], .ProseMirror')) continue
      const style = window.getComputedStyle(el)
      if (style.display === 'none' || style.visibility === 'hidden') continue
      const t = (n.textContent || '').trim()
      if (t.length < 5 || t.length > 120 || /\s/.test(t)) continue
      if (keyRe.test(t) && !notKey.test(t)) out.add(t)
    }
    // Attributes users see too.
    for (const el of Array.from(document.querySelectorAll('[placeholder],[aria-label],[title]'))) {
      for (const a of ['placeholder', 'aria-label', 'title']) {
        const v = (el.getAttribute(a) || '').trim()
        if (v && !/\s/.test(v) && keyRe.test(v) && !notKey.test(v)) out.add(`${a}=${v}`)
      }
    }
    return Array.from(out)
  })
}

export async function expectNoRawI18nKeys(page: Page, label = ''): Promise<void> {
  const keys = await findRawI18nKeys(page)
  expect(keys, `raw i18n keys visible${label ? ` on ${label}` : ''}`).toEqual([])
}

/** Horizontal overflow (page wider than viewport), the classic mobile/RTL break. */
export async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
}
