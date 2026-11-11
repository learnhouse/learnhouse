import React, { Component, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { I18nextProvider } from 'react-i18next'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
// Straight from the LearnHouse web app: the same renderer its embed uses.
import ActivityRenderer, { RENDERABLE_ACTIVITY_TYPES } from '@components/Objects/Activities/ActivityRenderer/ActivityRenderer'
import { OrgContext } from '@components/Contexts/OrgContext'
import { SessionContext } from '@components/Contexts/LHSessionContext'
import { LearnHouseInternalContext, useLearnHouseInternal } from './context'
import { LearnHouseProvider, useLearnHouseDefaults } from './provider'
import { useActivitySource } from './data'
import { useRendererEvents } from './events'
import { applyLocale, createI18n, setCurrentI18n } from './i18n'
import { isRtl, resolveMode, themeToStyle } from './theme'
import type { LearnHouseActivityData, LearnHouseActivityProps, LearnHouseEvent } from './types'

class RenderBoundary extends Component<
  { fallback: (error: Error, retry: () => void) => ReactNode; onError: (error: Error) => void; children: ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  componentDidCatch(error: Error) {
    this.props.onError(error)
  }
  render() {
    if (this.state.error) return this.props.fallback(this.state.error, () => this.setState({ error: null }))
    return this.props.children
  }
}

const renderSlot = (slot: LearnHouseActivityProps['header'], activity: LearnHouseActivityData) =>
  typeof slot === 'function' ? slot(activity) : slot

function DefaultError({ error }: { error: Error }) {
  return (
    <div role="alert" className="lh-activity-error" style={{ padding: '1rem', color: 'var(--lh-muted, #71717a)' }}>
      {error.message}
    </div>
  )
}

function ActivityView(props: LearnHouseActivityProps) {
  const defaults = useLearnHouseDefaults()
  const parent = useLearnHouseInternal()
  // Events go to the provider's onEvent and this component's own, including
  // the ones blocks send through the analytics shim.
  const onEventRef = useRef(props.onEvent)
  onEventRef.current = props.onEvent
  const internal = useMemo(
    () => ({
      ...parent,
      emit: (event: LearnHouseEvent) => {
        parent.emit(event)
        onEventRef.current?.(event)
      },
    }),
    [parent],
  )
  const theme = { ...defaults?.theme, ...props.theme }
  const locale = props.locale ?? defaults?.locale ?? 'en'
  const messages = props.messages ?? defaults?.messages
  const linkTarget = props.linkTarget ?? defaults?.linkTarget ?? '_blank'

  const i18n = useMemo(createI18n, [])
  setCurrentI18n(i18n)
  const [localeReady, setLocaleReady] = useState(locale.startsWith('en') && !messages)
  useEffect(() => {
    let alive = true
    applyLocale(i18n, locale, messages).then(() => alive && setLocaleReady(true))
    return () => {
      alive = false
    }
  }, [i18n, locale, messages])

  const [queryClient] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 60_000 } } }))

  const source = useActivitySource(props)
  const { activity, course, org } = source

  const rootRef = useRef<HTMLDivElement>(null)
  const { sentinelRef } = useRendererEvents(rootRef, internal.emit, {
    enabled: source.status === 'ready',
    activityId: activity?.activity_uuid,
    linkTarget,
    onLinkClick: props.onLinkClick,
    trackCompletion: props.trackCompletion ?? false,
  })

  const onLoadRef = useRef(props.onLoad)
  onLoadRef.current = props.onLoad
  const onErrorRef = useRef(props.onError)
  onErrorRef.current = props.onError
  useEffect(() => {
    if (source.status === 'ready' && activity) {
      onLoadRef.current?.(activity)
      internal.emit({ type: 'load', activity })
    }
    if (source.status === 'error' && source.error) {
      onErrorRef.current?.(source.error)
      internal.emit({ type: 'error', error: source.error })
    }
  }, [source.status, activity, source.error, internal])

  const mode = resolveMode(theme.mode)
  const dir = props.dir && props.dir !== 'auto' ? props.dir : isRtl(locale) ? 'rtl' : 'ltr'
  const rootClass = ['lh-activity', mode === 'dark' ? 'dark' : '', props.className ?? ''].filter(Boolean).join(' ')
  const rootStyle = props.unstyled ? props.style : { ...themeToStyle(theme), ...props.style }

  const errorFallback = (error: Error, retry: () => void) =>
    typeof props.errorFallback === 'function'
      ? props.errorFallback(error, retry)
      : (props.errorFallback ?? <DefaultError error={error} />)

  let body: ReactNode
  if (source.status === 'loading' || !localeReady) {
    body = props.fallback ?? null
  } else if (source.status === 'error' || !activity) {
    body = errorFallback(source.error ?? new Error('Activity not found'), source.retry)
  } else if (!RENDERABLE_ACTIVITY_TYPES.includes(activity.activity_type)) {
    body = errorFallback(new Error(`Activity type ${activity.activity_type} can't be rendered outside LearnHouse`), source.retry)
  } else {
    const activityUrl = source.activityUrl
    body = (
      <>
        {renderSlot(props.header, activity)}
        {props.showTitle && <h1 className="lh-activity-title">{activity.name}</h1>}
        <RenderBoundary
          fallback={errorFallback}
          onError={(error) => {
            onErrorRef.current?.(error)
            internal.emit({ type: 'error', error })
          }}
        >
          <OrgContext.Provider value={{ org, isUserPartOfTheOrg: false, orgslug: org?.slug ?? '' }}>
            <SessionContext.Provider value={internal.session}>
              <ActivityRenderer
                activity={activity}
                course={course}
                fallback={props.fallback ?? null}
                components={props.components as any}
                marks={props.marks as any}
                hiddenNodes={props.hideBlocks}
              />
            </SessionContext.Provider>
          </OrgContext.Provider>
        </RenderBoundary>
        {props.trackCompletion && <div ref={sentinelRef} className="lh-complete-sentinel" aria-hidden />}
        {renderSlot(props.footer, activity)}
        {props.showPoweredBy && activityUrl && (
          <a className="lh-powered-by" href={activityUrl} target="_blank" rel="noopener noreferrer">
            Made with LearnHouse
          </a>
        )}
      </>
    )
  }

  return (
    <LearnHouseInternalContext.Provider value={internal}>
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>
        <div ref={rootRef} className={rootClass} style={rootStyle} dir={dir} lang={locale} data-lh-status={source.status}>
          <div className="lh-activity-body">{body}</div>
        </div>
      </QueryClientProvider>
    </I18nextProvider>
    </LearnHouseInternalContext.Provider>
  )
}

/**
 * Renders a LearnHouse activity (page, video, PDF, markdown, embed) with the
 * same blocks and styles as LearnHouse itself.
 *
 * Use inside <LearnHouseProvider>, or pass `baseUrl` to use it on its own.
 */
export function LearnHouseActivity(props: LearnHouseActivityProps) {
  const { client } = useContext(LearnHouseInternalContext)
  if (!client && props.baseUrl) {
    return (
      <LearnHouseProvider baseUrl={props.baseUrl} token={props.token}>
        <ActivityView {...props} />
      </LearnHouseProvider>
    )
  }
  return <ActivityView {...props} />
}
