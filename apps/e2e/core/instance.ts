/**
 * Shared configuration for the E2E suite.
 *
 * Everything is overridable via env so the same specs can run against:
 *  - a self-host the suite boots itself via the LearnHouse CLI (default), or
 *  - an already-running instance (set E2E_BASE_URL to skip the boot).
 */

const PORT = process.env.E2E_PORT || '8080'
const DOMAIN = process.env.E2E_DOMAIN || 'localhost'

/** Base URL of the running instance the browser talks to. */
export const BASE_URL =
  process.env.E2E_BASE_URL || `http://${DOMAIN}:${PORT}`

/** REST API root — used by helpers/verify.ts to read back server state.
 * Defaults to same-origin; point at a separate API origin via E2E_API_URL for
 * split web/API dev setups. */
export const API_URL = process.env.E2E_API_URL || `${BASE_URL}/api/v1`

/** Organization the install is bootstrapped with. */
export const ORG_SLUG = process.env.E2E_ORG_SLUG || 'default'

/** Bootstrapped admin / teacher account. */
export const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL || 'admin@school.dev'
export const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD || 'E2eTestAdmin!234'

/** CLI install name (also the docker-compose project dir under ~/.learnhouse). */
export const INSTALL_NAME = process.env.E2E_INSTALL_NAME || 'e2e'

/** The CLI command used to boot the self-host. Override to use a local build. */
export const CLI = process.env.E2E_CLI || 'npx --yes learnhouse@latest'

/** When set (or E2E_BASE_URL is provided), global-setup will NOT boot a new instance. */
export const SKIP_BOOT =
  process.env.E2E_SKIP_BOOT === '1' || Boolean(process.env.E2E_BASE_URL)

export { PORT, DOMAIN }

/** Deterministic unique-ish suffix for created entities (no Date.now in shared code paths is fine here — this runs in Node, not a workflow). */
export function uniqueSuffix(): string {
  return `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`
}

/** A fresh student identity for a test run. */
export function makeStudent(label: string) {
  const suffix = uniqueSuffix()
  return {
    // Avoid reserved TLDs (.test/.example/.localhost) — the API email
    // validator rejects them. A normal .com domain validates fine.
    email: `student-${label}-${suffix}@e2e-tests.com`,
    username: `student_${label}_${suffix}`.replace(/-/g, '_'),
    password: 'E2eStudent!234',
    firstName: 'Stu',
    lastName: label,
  }
}
