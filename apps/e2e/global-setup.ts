/**
 * Playwright global setup.
 *
 * Boots a real LearnHouse self-host using the LearnHouse CLI (`setup --ci`,
 * pulling the published image) unless we've been pointed at an already-running
 * instance via E2E_BASE_URL / E2E_SKIP_BOOT. Then it waits until the API
 * health endpoint and the bootstrapped organization are both reachable before
 * any test runs — so specs never start against a half-booted stack.
 */
import { spawnSync } from 'node:child_process'
import { chromium } from '@playwright/test'
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  API_URL,
  BASE_URL,
  CLI,
  DOMAIN,
  INSTALL_NAME,
  ORG_SLUG,
  PORT,
  SKIP_BOOT,
  makeStudent,
} from './helpers/instance'
import * as api from './helpers/api'
import {
  ADMIN_STATE,
  STUDENT_STATE,
  ensureAuthDir,
  writeSharedStudent,
} from './helpers/sharedAuth'

const BOOT_TIMEOUT_MS = 8 * 60 * 1000 // image pull + first-run install can be slow
const POLL_INTERVAL_MS = 3000

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForOk(url: string, timeoutMs: number, label: string): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let lastErr = ''
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) })
      if (res.ok) {
        console.log(`✓ ${label} ready (${url})`)
        return
      }
      lastErr = `status ${res.status}`
    } catch (e) {
      lastErr = (e as Error).message
    }
    await sleep(POLL_INTERVAL_MS)
  }
  throw new Error(`Timed out waiting for ${label} at ${url}: ${lastErr}`)
}

function bootSelfHost(): void {
  console.log(`Booting LearnHouse self-host via CLI (install "${INSTALL_NAME}")…`)
  const cmd = [
    CLI,
    'setup',
    '--ci',
    `--name ${INSTALL_NAME}`,
    `--domain ${DOMAIN}`,
    `--port ${PORT}`,
    `--admin-email ${ADMIN_EMAIL}`,
    `--admin-password ${ADMIN_PASSWORD}`,
    `--org-name "E2E Org"`,
    `--org-slug ${ORG_SLUG}`,
  ].join(' ')

  const result = spawnSync(cmd, {
    shell: true,
    stdio: 'inherit',
    timeout: BOOT_TIMEOUT_MS,
    env: process.env,
  })

  if (result.status !== 0) {
    throw new Error(
      `CLI setup failed (exit ${result.status}). ` +
        `Command: ${cmd}\n` +
        `If you already have an instance running, set E2E_BASE_URL to skip booting.`,
    )
  }
}

export default async function globalSetup(): Promise<void> {
  if (SKIP_BOOT) {
    console.log(`Reusing existing instance at ${BASE_URL} (boot skipped).`)
  } else {
    bootSelfHost()
  }

  await waitForOk(`${API_URL}/health`, SKIP_BOOT ? 60_000 : BOOT_TIMEOUT_MS, 'API health')
  await waitForOk(`${API_URL}/orgs/slug/${ORG_SLUG}`, 60_000, `org "${ORG_SLUG}"`)
  console.log(`LearnHouse is ready at ${BASE_URL}. Admin: ${ADMIN_EMAIL}`)

  await generateSharedAuth()
}

/**
 * Log in ONCE as the admin and ONCE as a reusable student, saving each browser
 * session so specs can reuse them via storageState (keeps the whole suite well
 * under the login rate limit). The shared student is also created here.
 */
async function generateSharedAuth(): Promise<void> {
  ensureAuthDir()

  // Create the reusable student via API (admin token is cached by api.login).
  const adminToken = await api.login(ADMIN_EMAIL, ADMIN_PASSWORD)
  const org = await api.getOrg()
  const stu = makeStudent('shared')
  const studentId = await api.createStudent(adminToken, org.id, stu)
  writeSharedStudent({ email: stu.email, username: stu.username, password: stu.password, id: studentId })

  const browser = await chromium.launch()
  try {
    await saveLogin(browser, ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_STATE)
    await saveLogin(browser, stu.email, stu.password, STUDENT_STATE)
  } finally {
    await browser.close()
  }
  console.log('Saved shared admin + student sessions for reuse.')
}

async function saveLogin(
  browser: import('@playwright/test').Browser,
  email: string,
  password: string,
  statePath: string,
): Promise<void> {
  const context = await browser.newContext()
  const page = await context.newPage()
  for (let attempt = 1; attempt <= 3; attempt++) {
    await page.goto(`${BASE_URL}/login`)
    await page.getByRole('textbox', { name: 'Email' }).fill(email)
    await page.getByRole('textbox', { name: 'Password' }).fill(password)
    await page.getByRole('button', { name: 'Login', exact: true }).click()
    try {
      await page.waitForURL((u) => !/\/login(\?|$)/.test(u.toString()), { timeout: 12_000 })
      break
    } catch {
      if (attempt === 3) throw new Error(`global-setup: login failed for ${email}`)
      await page.waitForTimeout(15_000)
    }
  }
  // Bake the dismissed-onboarding flag into the saved state so every context
  // reusing this storageState (including ad-hoc ones) skips the first-run UI.
  await page.evaluate(() => {
    try {
      window.localStorage.setItem(
        'lh_onboarding',
        JSON.stringify({
          completedSteps: [
            'create_course', 'add_activities', 'experience_editor', 'try_playgrounds',
            'invite_users', 'customize_org', 'teach_the_world',
          ],
          skippedSteps: [], minimized: true, expanded: false, showAllSteps: false,
          dismissed: true, welcomeSeen: true,
        }),
      )
    } catch {
      /* ignore */
    }
  })
  await context.storageState({ path: statePath })
  await context.close()
}
