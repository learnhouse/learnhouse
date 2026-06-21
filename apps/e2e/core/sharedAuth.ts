/**
 * Shared authenticated sessions.
 *
 * To keep the suite under the API's 30-logins / 5-min / IP limit as it grows,
 * global-setup logs in ONCE as the admin and ONCE as a single reusable student,
 * saving each browser session to a storageState file. Specs then opt in with
 * `test.use({ storageState: ADMIN_STATE })` (or STUDENT_STATE) instead of
 * logging in per spec. The shared student is safe to reuse across specs because
 * each spec works against its OWN course/assignment (submissions are
 * per-assignment).
 */
import { fileURLToPath } from 'node:url'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const AUTH_DIR = fileURLToPath(new URL('../.auth/', import.meta.url))

export const ADMIN_STATE = join(AUTH_DIR, 'admin.json')
export const STUDENT_STATE = join(AUTH_DIR, 'student.json')
const SHARED_FILE = join(AUTH_DIR, 'shared.json')

export interface SharedStudent {
  email: string
  username: string
  password: string
  id: number
}

export function ensureAuthDir(): void {
  if (!existsSync(AUTH_DIR)) mkdirSync(AUTH_DIR, { recursive: true })
}

export function writeSharedStudent(s: SharedStudent): void {
  ensureAuthDir()
  writeFileSync(SHARED_FILE, JSON.stringify(s, null, 2))
}

let _cached: SharedStudent | null = null
/** The reusable student created in global-setup. */
export function sharedStudent(): SharedStudent {
  if (_cached) return _cached
  if (!existsSync(SHARED_FILE)) {
    throw new Error(`shared student file missing at ${SHARED_FILE} — did global-setup run?`)
  }
  _cached = JSON.parse(readFileSync(SHARED_FILE, 'utf8')) as SharedStudent
  return _cached
}

export { AUTH_DIR }
export const _authDirName = dirname(AUTH_DIR)
