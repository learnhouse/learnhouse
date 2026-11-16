'use client'
import { useSyncExternalStore } from 'react'

// Where to land after auth travels as ?next (or the older ?redirect). Only an
// internal path is kept: "/x" yes, "//evil" or "https://…" no.
export function readNextParam(search: string | URLSearchParams | null | undefined): string | null {
  const params = typeof search === 'string' ? new URLSearchParams(search) : search
  const raw = params?.get('next') ?? params?.get('redirect') ?? null
  return raw && /^\/(?!\/)/.test(raw) && !raw.includes('\\') ? raw : null
}

/** `path` with `?next=` set when there is a safe destination to keep. */
export function withNextParam(path: string, next: string | null | undefined): string {
  if (!next || !/^\/(?!\/)/.test(next)) return path
  const sep = path.includes('?') ? '&' : '?'
  return `${path}${sep}next=${encodeURIComponent(next)}`
}

/**
 * Link target that keeps the current page's ?next, so switching between
 * /signup and /login doesn't drop where the person was headed (a course they
 * tried to start, a checkout). The server render uses the plain path, so
 * hydration stays consistent.
 */
const noSubscribe = () => () => {}

export function useForwardedNextHref(path: string): string {
  const search = useSyncExternalStore(noSubscribe, () => window.location.search, () => '')
  return withNextParam(path, readNextParam(search))
}
