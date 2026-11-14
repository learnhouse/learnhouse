'use client'
import { useCallback, useEffect, useState } from 'react'

/**
 * Recent searches, kept per org in this browser only. Storage can be missing
 * or throw (private windows, blocked site data), so every access is guarded
 * and the UI simply shows no history then.
 */

const MAX_RECENT = 6
const EVENT = 'lh:site-search-recent'

const storageKey = (orgslug: string) => `lh:site-search:recent:${orgslug}`

export function readRecentSearches(orgslug: string): string[] {
  if (!orgslug) return []
  try {
    const raw = window.localStorage.getItem(storageKey(orgslug))
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((q) => typeof q === 'string' && q.trim()).slice(0, MAX_RECENT) : []
  } catch {
    return []
  }
}

function write(orgslug: string, list: string[]) {
  try {
    window.localStorage.setItem(storageKey(orgslug), JSON.stringify(list.slice(0, MAX_RECENT)))
  } catch {
    // Storage unavailable: history just isn't kept.
  }
  try {
    window.dispatchEvent(new CustomEvent(EVENT, { detail: orgslug }))
  } catch {
    // ignore
  }
}

export function addRecentSearch(orgslug: string, query: string) {
  const q = query.trim()
  if (!orgslug || !q) return
  const lower = q.toLowerCase()
  write(orgslug, [q, ...readRecentSearches(orgslug).filter((item) => item.toLowerCase() !== lower)])
}

export function removeRecentSearch(orgslug: string, query: string) {
  write(orgslug, readRecentSearches(orgslug).filter((item) => item !== query))
}

export function clearRecentSearches(orgslug: string) {
  write(orgslug, [])
}

/** The org's recent searches, kept in sync between the palette and the search page. */
export function useRecentSearches(orgslug: string) {
  const [recent, setRecent] = useState<string[]>([])

  useEffect(() => {
    const sync = () => setRecent(readRecentSearches(orgslug))
    sync()
    const onStorage = (e: StorageEvent) => {
      if (e.key === storageKey(orgslug)) sync()
    }
    window.addEventListener(EVENT, sync)
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener(EVENT, sync)
      window.removeEventListener('storage', onStorage)
    }
  }, [orgslug])

  return {
    recent,
    add: useCallback((q: string) => addRecentSearch(orgslug, q), [orgslug]),
    remove: useCallback((q: string) => removeRecentSearch(orgslug, q), [orgslug]),
    clear: useCallback(() => clearRecentSearches(orgslug), [orgslug]),
  }
}
