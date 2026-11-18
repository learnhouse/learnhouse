// One "create my academy" attempt survives a reload or the back button.
//
// The API treats a repeated Idempotency-Key as the same request and answers
// with the org it already made, so a retry (a lost response, a double submit,
// coming back to /new) can't create a second one. The key lives in
// sessionStorage for the tab and changes when the name does. The org made in
// this tab is remembered for a while so /new can point back to it.

export type StoredStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export const ATTEMPT_KEY = 'lh:onb:attempt'
export const CREATED_KEY = 'lh:onb:created'
// Long enough to cover "created it, looked around, came back".
export const CREATED_TTL_MS = 30 * 60 * 1000

export type CreatedOrg = { id: number; slug: string; name: string; at: number }

const norm = (name: string) => name.trim().toLowerCase().replace(/\s+/g, ' ')

function read<T>(storage: StoredStorage | null | undefined, key: string): T | null {
  try {
    const raw = storage?.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

function write(storage: StoredStorage | null | undefined, key: string, value: unknown) {
  try {
    storage?.setItem(key, JSON.stringify(value))
  } catch {
    /* private mode or full: the server-side guard still applies */
  }
}

function newKey(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto
  if (c?.randomUUID) return c.randomUUID()
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

/** The Idempotency-Key for creating an org named ``name`` in this tab. */
export function attemptKey(storage: StoredStorage | null | undefined, name: string): string {
  const current = read<{ key: string; name: string }>(storage, ATTEMPT_KEY)
  if (current?.key && current.name === norm(name)) return current.key
  const key = newKey()
  write(storage, ATTEMPT_KEY, { key, name: norm(name) })
  return key
}

/** Remember the org this tab just created (and start the next attempt fresh). */
export function rememberCreated(storage: StoredStorage | null | undefined, org: { id: number; slug: string; name: string }, now = Date.now()) {
  write(storage, CREATED_KEY, { id: org.id, slug: org.slug, name: org.name, at: now } satisfies CreatedOrg)
  try {
    storage?.removeItem(ATTEMPT_KEY)
  } catch {
    /* ignore */
  }
}

/** The org this tab created in the last ``CREATED_TTL_MS``, if any. */
export function recentlyCreated(storage: StoredStorage | null | undefined, now = Date.now()): CreatedOrg | null {
  const org = read<CreatedOrg>(storage, CREATED_KEY)
  if (!org || typeof org.id !== 'number' || !org.slug || typeof org.at !== 'number') return null
  return now - org.at <= CREATED_TTL_MS && org.at <= now ? org : null
}

export function sessionStore(): StoredStorage | null {
  try {
    return typeof window !== 'undefined' ? window.sessionStorage : null
  } catch {
    return null
  }
}
