import React, { useCallback, useContext, useEffect, useMemo, useRef, useState, createContext } from 'react'
import { SessionStore, createClient, refreshDelay } from '@learnhouse/sdk'
import type { LearnHouseClient, ResolvedSession } from '@learnhouse/sdk'
import { LearnHouseInternalContext } from './context'
import type { LearnHouseInternal } from './context'
import { configureRuntime } from './runtime'
import type { LearnHouseEvent, LearnHouseProviderProps, LearnHouseTheme } from './types'

export interface LearnHouseDefaults {
  theme?: LearnHouseTheme
  locale?: string
  messages?: Record<string, any>
  linkTarget?: '_blank' | '_self' | '_parent' | '_top'
}

const DefaultsContext = createContext<LearnHouseDefaults | null>(null)
export const useLearnHouseDefaults = () => useContext(DefaultsContext)

/** `sub` of a JWT (the learner), to tell a refreshed session from a new learner. */
function tokenSubject(token: string | null): string | null {
  if (!token) return null
  try {
    const part = token.split('.')[1]
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (part.length % 4)) % 4))
    const sub = JSON.parse(json)?.sub
    return typeof sub === 'string' ? sub : token
  } catch {
    return token
  }
}

export function LearnHouseProvider(props: LearnHouseProviderProps) {
  const { baseUrl, mediaUrl, getToken, onEvent } = props

  // Must be set before any block reads a URL, so it happens during render.
  configureRuntime(baseUrl, mediaUrl)

  const onEventRef = useRef(onEvent)
  onEventRef.current = onEvent
  const emit = useCallback((event: LearnHouseEvent) => onEventRef.current?.(event), [])

  // ── Session ──────────────────────────────────────────────────────────────
  // `session` / `getSession` (embed sessions, refreshed before they expire)
  // and `token` share one store; `getToken` keeps its old meaning: asked
  // before every request.
  const getSessionRef = useRef(props.getSession)
  getSessionRef.current = props.getSession
  const getTokenRef = useRef(getToken)
  getTokenRef.current = getToken
  const hasGetSession = !!props.getSession

  // A client that brings its own session store (the Vue provider's, or one
  // made with createClient({ getSession })) is the single source of truth.
  const [store] = useState(
    () =>
      props.client?.session ??
      new SessionStore(props.session ?? props.token ?? null, hasGetSession ? () => getSessionRef.current?.() : undefined),
  )
  const ownStore = store !== props.client?.session
  const [current, setCurrent] = useState<ResolvedSession | null>(store.session)
  const [pending, setPending] = useState(store.canRefresh && !store.session)
  const [legacyToken, setLegacyToken] = useState<string | null>(null)

  useEffect(() => {
    setCurrent(store.session)
    return store.subscribe(setCurrent)
  }, [store])
  useEffect(() => () => {
    if (ownStore) store.dispose()
  }, [store, ownStore])
  useEffect(() => {
    if (ownStore) store.setSource(hasGetSession ? () => getSessionRef.current?.() : undefined)
  }, [store, ownStore, hasGetSession])

  // A session or token passed directly replaces the current one.
  const direct = props.session ?? props.token
  const directKey = direct === undefined ? undefined : typeof direct === 'string' ? direct : direct?.access_token ?? null
  useEffect(() => {
    if (direct === undefined || !ownStore) return
    store.set(direct)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, directKey])

  // First session from getSession.
  useEffect(() => {
    if (!store.canRefresh || store.session) {
      setPending(false)
      return
    }
    let alive = true
    store.refresh().finally(() => alive && setPending(false))
    return () => {
      alive = false
    }
  }, [store])

  // Ask for a new session shortly before this one expires; without a way to
  // get one, drop it at expiry so blocks fall back to signed-out behaviour.
  const expiresAt = current?.expiresAt ?? null
  useEffect(() => {
    const delay = store.canRefresh ? refreshDelay(current) : expiresAt ? Math.max(expiresAt - Date.now(), 0) : null
    if (delay === null) return
    const timer = setTimeout(() => {
      // Another component sharing this store already renewed it.
      if (store.session?.token !== current?.token) return
      if (!store.canRefresh) {
        store.set(null)
        emit({ type: 'session_expired' })
        return
      }
      store.refresh().then((next) => {
        if (!next || (next.expiresAt !== null && next.expiresAt <= Date.now())) emit({ type: 'session_expired' })
      })
    }, Math.min(delay, 2_147_000_000))
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, current?.token, expiresAt, hasGetSession, emit])

  // Legacy getToken: shown to blocks as the current token once resolved.
  useEffect(() => {
    if (!getTokenRef.current || direct !== undefined || hasGetSession) return
    let alive = true
    Promise.resolve(getTokenRef.current()).then((t) => alive && setLegacyToken(t ?? null))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getToken, directKey, hasGetSession])

  const resolveToken = useCallback(async (): Promise<string | null> => {
    if (getTokenRef.current && direct === undefined && !hasGetSession) {
      return (await getTokenRef.current()) ?? null
    }
    return store.getToken()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, directKey, hasGetSession])
  const resolveTokenRef = useRef(resolveToken)
  resolveTokenRef.current = resolveToken

  // ── Client ───────────────────────────────────────────────────────────────
  const client = useMemo<LearnHouseClient>(() => {
    if (props.client) return props.client
    // Legacy getToken is asked per request; otherwise the session store
    // supplies the token and retries once on 401 with a fresh session.
    if (getTokenRef.current && direct === undefined && !hasGetSession) {
      return createClient({ baseUrl, getToken: () => resolveTokenRef.current() })
    }
    return createClient({ baseUrl, sessionStore: store })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.client, baseUrl, store, hasGetSession, !!getToken])

  // ── Who the learner is ───────────────────────────────────────────────────
  const token = current?.token ?? legacyToken
  const subject = tokenSubject(token)
  const [learner, setLearner] = useState<{ subject: string; user: any; roles: any[] } | null>(null)
  useEffect(() => {
    if (props.user || !subject || !token) return
    if (learner?.subject === subject) return
    let alive = true
    client.users
      .session()
      .then((s: any) => alive && setLearner({ subject, user: s?.user, roles: s?.roles ?? [] }))
      .catch(() => {})
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, subject, props.user])

  const user = props.user ?? (learner && learner.subject === subject ? learner.user : undefined)
  const roles = !props.user && learner && learner.subject === subject ? learner.roles : undefined

  const internal = useMemo<LearnHouseInternal>(
    () => ({
      client,
      baseUrl,
      emit,
      getAccessToken: () => resolveTokenRef.current(),
      session: {
        data:
          token || user
            ? {
                user,
                roles,
                tokens: token ? { access_token: token, expiry: current?.expiresAt ?? undefined } : undefined,
              }
            : null,
        status: pending ? 'loading' : token ? 'authenticated' : 'unauthenticated',
        update: async () => {
          if (store.canRefresh) {
            await store.refresh()
          } else if (getTokenRef.current) {
            setLegacyToken((await getTokenRef.current()) ?? null)
          }
        },
      },
    }),
    [client, baseUrl, emit, token, user, roles, pending, store, current?.expiresAt],
  )

  const defaults = useMemo<LearnHouseDefaults>(
    () => ({ theme: props.theme, locale: props.locale, messages: props.messages, linkTarget: props.linkTarget }),
    [props.theme, props.locale, props.messages, props.linkTarget],
  )

  return (
    <LearnHouseInternalContext.Provider value={internal}>
      <DefaultsContext.Provider value={defaults}>{props.children}</DefaultsContext.Provider>
    </LearnHouseInternalContext.Provider>
  )
}

/** The @learnhouse/sdk client of the nearest provider, for your own API calls. */
export function useLearnHouseClient(): LearnHouseClient {
  const { client } = useContext(LearnHouseInternalContext)
  if (!client) throw new Error('useLearnHouseClient() must be used inside <LearnHouseProvider>')
  return client
}

/** The current learner session of the nearest provider (`status`, `data.user`). */
export function useLearnHouseSession() {
  return useContext(LearnHouseInternalContext).session
}
