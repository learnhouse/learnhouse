'use client'

import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import i18n from '@/lib/i18n'
import {
  CONTENT_LANG_SESSION_KEY,
  contentLangCookie,
  contentLangStorageKeys,
  langParam,
  parseLangParam,
  resolveContentLanguagePrefs,
} from '@/lib/contentLanguage'

/*
 Course content language of the current learner. Every learner read of a
 course (course page, activities, catalog, search, certificates) sends the
 same `lang=` list, so the API serves one consistent language version.
*/

const listeners = new Set<() => void>()
function emit() {
  for (const l of listeners) l()
}
function subscribe(listener: () => void) {
  listeners.add(listener)
  const onStorage = (e: StorageEvent) => {
    if (!e.key || e.key.startsWith(contentLangStorageKeys()[0])) listener()
  }
  window.addEventListener('storage', onStorage)
  window.addEventListener('languagechange', listener)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', onStorage)
    window.removeEventListener('languagechange', listener)
  }
}

function safeGet(storage: () => Storage, key: string): string {
  try {
    return storage().getItem(key) || ''
  } catch {
    return ''
  }
}

function readStored(userId?: string | number | null): { session: string; stored: string } {
  const session = safeGet(() => window.sessionStorage, CONTENT_LANG_SESSION_KEY)
  let stored = ''
  for (const key of contentLangStorageKeys(userId)) {
    stored = safeGet(() => window.localStorage, key)
    if (stored) break
  }
  return { session, stored }
}

/**
 * The UI language counts as the learner's language only when they picked it
 * (the language switcher sets this flag). Otherwise it is just the org's
 * default and must not hide what the browser says they read.
 */
function uiLanguagePicked(): boolean {
  try {
    return !!localStorage.getItem('i18nextLng_userPicked')
  } catch {
    return false
  }
}

// Snapshot as a primitive: "1|session|stored|browser|picked" on the client, "0" on the server.
function clientSnapshot(userId?: string | number | null): string {
  const { session, stored } = readStored(userId)
  const browser = (typeof navigator !== 'undefined' && navigator.languages?.join(',')) || ''
  return ['1', session, stored, browser, uiLanguagePicked() ? '1' : ''].join('|')
}

/** Preference list outside React (prefetching): URL, tab, global choice, UI, browser. */
export function currentContentLangParam(): string {
  if (typeof window === 'undefined') return ''
  const [, session, stored, browser, picked] = clientSnapshot().split('|')
  return langParam(
    resolveContentLanguagePrefs({
      urlLang: new URLSearchParams(window.location.search).get('lang'),
      sessionLang: session,
      storedLang: stored,
      uiLanguage: picked ? i18n.language : null,
      browser: browser ? browser.split(',') : [],
    }),
  )
}

export type ContentLanguage = {
  /** Preference list, most preferred first. */
  prefs: string[]
  /** `lang=` value ('' when unknown). Put it in query keys. */
  lang: string
  /** False during server render / hydration: hold language-dependent fetches until true. */
  ready: boolean
  /** Remember a choice (per user + global, cookie) and update `?lang=` when the URL has one. */
  setLanguage: (_locale: string | null) => void
}

export function useContentLanguage(): ContentLanguage {
  const { i18n: inst } = useTranslation()
  const session = useLHSession() as any
  const userId = session?.data?.user?.id ?? null
  const searchParams = useSearchParams()
  const router = useRouter()
  const urlLang = searchParams?.get('lang') ?? null

  const getSnapshot = useCallback(() => clientSnapshot(userId), [userId])
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, () => '0')
  const ready = snapshot.startsWith('1')
  const [, sessionLang = '', storedLang = '', browser = '', picked = ''] = snapshot.split('|')
  const uiLanguage = picked ? inst?.language : null

  const prefs = useMemo(
    () =>
      resolveContentLanguagePrefs({
        urlLang,
        sessionLang,
        storedLang,
        uiLanguage,
        browser: browser ? browser.split(',') : [],
      }),
    [urlLang, sessionLang, storedLang, uiLanguage, browser],
  )

  // A `?lang=` the visitor arrived with (shared link, search result) keeps
  // applying while they move around the course in this tab.
  const parsedUrlLang = parseLangParam(urlLang)
  useEffect(() => {
    if (!parsedUrlLang) return
    try {
      if (window.sessionStorage.getItem(CONTENT_LANG_SESSION_KEY) !== parsedUrlLang) {
        window.sessionStorage.setItem(CONTENT_LANG_SESSION_KEY, parsedUrlLang)
        emit()
      }
    } catch {
      /* storage blocked: the URL still applies */
    }
  }, [parsedUrlLang])

  const setLanguage = useCallback(
    (locale: string | null) => {
      const value = parseLangParam(locale)
      try {
        for (const key of contentLangStorageKeys(userId)) {
          if (value) window.localStorage.setItem(key, value)
          else window.localStorage.removeItem(key)
        }
        window.sessionStorage.removeItem(CONTENT_LANG_SESSION_KEY)
      } catch {
        /* storage blocked */
      }
      try {
        document.cookie = contentLangCookie(value)
      } catch {
        /* cookies blocked */
      }
      emit()
      if (urlLang !== null) {
        const params = new URLSearchParams(searchParams?.toString() || '')
        if (value) params.set('lang', value)
        else params.delete('lang')
        const qs = params.toString()
        // The browser path: org sites are rewritten to /orgs/<slug>/… internally.
        router.replace(`${window.location.pathname}${qs ? `?${qs}` : ''}${window.location.hash}`, { scroll: false })
      }
    },
    [userId, urlLang, searchParams, router],
  )

  return { prefs, lang: langParam(prefs), ready, setLanguage }
}
