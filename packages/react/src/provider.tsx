import React, { useCallback, useContext, useEffect, useMemo, useRef, useState, createContext } from 'react'
import type { ReactNode } from 'react'
import { createClient } from '@learnhouse/sdk'
import type { LearnHouseClient } from '@learnhouse/sdk'
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

export function LearnHouseProvider(props: LearnHouseProviderProps) {
  const { baseUrl, mediaUrl, getToken, user, onEvent } = props

  // Must be set before any block reads a URL, so it happens during render.
  configureRuntime(baseUrl, mediaUrl)

  const [resolvedToken, setResolvedToken] = useState<string | null>(props.token ?? null)
  const getTokenRef = useRef(getToken)
  getTokenRef.current = getToken
  useEffect(() => {
    if (props.token !== undefined) {
      setResolvedToken(props.token)
      return
    }
    if (!getTokenRef.current) return
    let alive = true
    Promise.resolve(getTokenRef.current()).then((t) => alive && setResolvedToken(t ?? null))
    return () => {
      alive = false
    }
  }, [props.token, getToken])

  const client = useMemo(
    () =>
      props.client ??
      createClient({
        baseUrl,
        getToken: async () => {
          if (props.token) return props.token
          const t = getTokenRef.current ? await getTokenRef.current() : null
          return t ?? null
        },
      }),
    [props.client, baseUrl, props.token],
  )

  const onEventRef = useRef(onEvent)
  onEventRef.current = onEvent
  const emit = useCallback((event: LearnHouseEvent) => onEventRef.current?.(event), [])

  const internal = useMemo<LearnHouseInternal>(
    () => ({
      client,
      baseUrl,
      emit,
      session: {
        data: resolvedToken || user ? { user, tokens: resolvedToken ? { access_token: resolvedToken } : undefined } : null,
        status: resolvedToken ? 'authenticated' : 'unauthenticated',
        update: async () => {
          if (getTokenRef.current) setResolvedToken((await getTokenRef.current()) ?? null)
        },
      },
    }),
    [client, baseUrl, emit, resolvedToken, user],
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
