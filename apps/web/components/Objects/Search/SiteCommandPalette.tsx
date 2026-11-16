'use client'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import { Command } from 'cmdk'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import {
  ArrowRight,
  ArrowSquareOut,
  ClockCounterClockwise,
  Keyboard,
  MagnifyingGlass,
  SquaresFour,
  X,
} from '@phosphor-icons/react'

import { useOrg } from '@components/Contexts/OrgContext'
import { getUriWithOrg } from '@services/config/config'
import { useLHAnalytics, AnalyticsEvent } from '@services/analytics'
import { useIsMac } from '@/hooks/useIsMac'
import { rankPages } from '@/lib/site-search/match'
import { useSitePages } from '@/lib/site-search/useSitePages'
import { useRecentSearches } from '@/lib/site-search/recent'
import {
  MIN_QUERY,
  SITE_RESULT_ORDER,
  useSiteSearch,
  type SiteResult,
  type SiteResultType,
} from '@/lib/site-search/useSiteSearch'
import type { SitePageMeta } from '@/lib/site-search/types'
import { useSiteCommandPalette } from './SiteCommandPaletteContext'
import { useOptionalShortcuts, type ShortcutAction } from '@/lib/shortcuts/ShortcutsContext'
import { Keys } from '@components/Objects/Shortcuts/Kbd'
import ThumbnailImage from '@components/Objects/Thumbnails/ThumbnailImage'
import { AvatarStack, Button, Chip, formatRelative } from '@components/Dashboard/Shared/DashKit/DashKit'
import {
  Highlight,
  ResultThumb,
  SkeletonRows,
  TYPE_ICON,
  TYPE_PLURAL,
  activityKind,
  typeGroupKey,
  typeOneKey,
} from './searchUi'

type Scope = 'all' | 'pages' | SiteResultType

type Entry =
  | { kind: 'page'; value: string; page: SitePageMeta; href: string }
  | { kind: 'action'; value: string; action: ShortcutAction }
  | { kind: 'result'; value: string; result: SiteResult }
  | { kind: 'recent'; value: string; query: string }
  | { kind: 'scope'; value: string; scope: Scope; label: string }
  | { kind: 'viewAll'; value: string; href: string; count: number; label: string }

interface Group {
  key: string
  heading: React.ReactNode
  entries: Entry[]
}

/** More rows once the palette is narrowed to a single type. */
const SCOPED_PER_TYPE = 12

const ITEM_CLASS =
  'group/item relative flex cursor-pointer select-none items-center gap-3 rounded-xl px-2.5 py-2 max-md:min-h-[52px] ' +
  'text-neutral-800 transition-colors aria-selected:bg-neutral-100'

const ICON_TILE =
  'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-neutral-100 text-neutral-500 ring-1 ring-inset ring-black/[0.04]'

const hrefOf = (entry: Entry | undefined): string | undefined =>
  entry?.kind === 'page' || entry?.kind === 'viewAll' ? entry.href : entry?.kind === 'result' ? entry.result.href : undefined

/**
 * Learner-facing command palette: jump to any page, run the page's actions,
 * and search the org's content, grouped by type with a preview of the
 * selected result on wide screens. Opens with ⌘K / Ctrl K or the header
 * search field.
 */
export default function SiteCommandPalette() {
  const { t, i18n } = useTranslation()
  const router = useRouter()
  const org = useOrg() as any
  const orgslug: string = org?.slug ?? ''
  const { open, setOpen } = useSiteCommandPalette()
  const { track } = useLHAnalytics('learner')
  const isMac = useIsMac()
  const shortcuts = useOptionalShortcuts()
  const recentSearches = useRecentSearches(orgslug)

  const [query, setQuery] = useState('')
  const [scope, setScope] = useState<Scope>('all')
  const [selected, setSelected] = useState('')
  // Keep the first row selected as results stream in, until the user picks another.
  const followFirst = useRef(true)

  const lessonLocation = useCallback(
    (course: string, chapter: string) => t('search.lesson_location', { course, chapter }),
    [t],
  )
  const pages = useSitePages()
  const all = useSiteSearch(query, lessonLocation)
  const typeScope = scope !== 'all' && scope !== 'pages' ? scope : null
  // Narrowed to one type: ask for more of that type. Disabled (empty query) otherwise.
  const scoped = useSiteSearch(typeScope ? query : '', lessonLocation, { perType: SCOPED_PER_TYPE })

  const trimmed = query.trim()
  const hasQuery = trimmed.length >= MIN_QUERY

  const describedPages = useMemo(
    () =>
      pages.map((page) => ({
        page,
        title: t(page.titleKey),
        description: page.descriptionKey ? t(page.descriptionKey) : '',
        keywords: page.keywordsKey ? t(page.keywordsKey) : '',
      })),
    [pages, t],
  )
  const matchedPages = useMemo(() => rankPages(describedPages, query).map((e) => e.page), [describedPages, query])
  const matchedActions = useMemo(() => {
    const list = (shortcuts?.actions ?? []).filter((a) => a.group === 'page' && !a.hideFromPalette)
    return rankPages(list.map((action) => ({ action, title: action.label })), query).map((e) => e.action)
  }, [shortcuts?.actions, query])

  const loading = hasQuery && (all.isLoading || all.isWaiting)

  // Results for the current scope. While a scoped fetch is in flight the
  // first few from the "all" search stand in for it.
  const contentResults = useMemo(() => {
    if (!hasQuery) return []
    if (typeScope) {
      const fromScoped = scoped.results.filter((r) => r.type === typeScope)
      return fromScoped.length > 0 || (!scoped.isLoading && !scoped.isWaiting && scoped.enabled)
        ? fromScoped
        : all.results.filter((r) => r.type === typeScope)
    }
    return scope === 'all' ? all.results : []
  }, [hasQuery, typeScope, scope, scoped.results, scoped.isLoading, scoped.isWaiting, scoped.enabled, all.results])

  // ── Scope tabs: only the types this query actually returned ────────────
  const scopes = useMemo(() => {
    if (!hasQuery) return [] as { key: Scope; label: string; count?: number; icon?: React.ComponentType<any> }[]
    const list: { key: Scope; label: string; count?: number; icon?: React.ComponentType<any> }[] = [
      { key: 'all', label: t('search.types.all'), count: all.total },
    ]
    const pageCount = matchedPages.length + matchedActions.length
    if (pageCount > 0 || scope === 'pages') {
      list.push({ key: 'pages', label: t('search.v2.scope_pages'), count: pageCount, icon: SquaresFour })
    }
    for (const type of SITE_RESULT_ORDER) {
      if (all.totals[type] > 0 || scope === type) {
        list.push({ key: type, label: t(typeGroupKey(type)), count: all.totals[type], icon: TYPE_ICON[type] })
      }
    }
    return list
  }, [hasQuery, all.total, all.totals, matchedPages.length, matchedActions.length, scope, t])

  // ── Groups, in display order ───────────────────────────────────────────
  const groups: Group[] = useMemo(() => {
    const out: Group[] = []
    const pageEntry = (page: SitePageMeta): Entry => ({
      kind: 'page',
      value: page.id,
      page,
      href: getUriWithOrg(orgslug, page.href),
    })
    const actionEntry = (action: ShortcutAction): Entry => ({ kind: 'action', value: action.id, action })
    const searchHref = (type?: SiteResultType) =>
      getUriWithOrg(
        orgslug,
        `/search?q=${encodeURIComponent(trimmed)}${type ? `&type=${TYPE_PLURAL[type]}` : ''}`,
      )

    if (!trimmed) {
      if (recentSearches.recent.length > 0) {
        out.push({
          key: 'recent',
          heading: (
            <span className="flex items-center justify-between gap-2">
              {t('search.v2.recent')}
              <button
                type="button"
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => recentSearches.clear()}
                className="rounded px-1 text-[11px] font-medium normal-case tracking-normal text-neutral-400 hover:text-neutral-700"
              >
                {t('search.v2.clear_recent')}
              </button>
            </span>
          ),
          entries: recentSearches.recent.map((q) => ({ kind: 'recent', value: `recent:${q}`, query: q })),
        })
      }
      if (matchedActions.length > 0) {
        out.push({ key: 'actions', heading: t('shortcuts.palette_actions'), entries: matchedActions.map(actionEntry) })
      }
      out.push({ key: 'pages', heading: t('search.palette.groups.pages'), entries: matchedPages.map(pageEntry) })
      return out
    }

    if (scope === 'all' || scope === 'pages') {
      const cap = scope === 'pages' ? Infinity : hasQuery ? 3 : 5
      if (matchedActions.length > 0) {
        out.push({
          key: 'actions',
          heading: t('shortcuts.palette_actions'),
          entries: matchedActions.slice(0, cap).map(actionEntry),
        })
      }
      if (matchedPages.length > 0) {
        out.push({
          key: 'pages',
          heading: t('search.palette.groups.pages'),
          entries: matchedPages.slice(0, cap).map(pageEntry),
        })
      }
    }

    if (hasQuery && scope !== 'pages') {
      for (const type of SITE_RESULT_ORDER) {
        if (typeScope && type !== typeScope) continue
        const items = contentResults.filter((r) => r.type === type)
        if (items.length === 0) continue
        out.push({
          key: type,
          heading: t(typeGroupKey(type)),
          entries: items.map((result) => ({ kind: 'result', value: `${result.type}-${result.id}`, result })),
        })
      }
      const count = typeScope ? all.totals[typeScope] : all.total
      if (contentResults.length > 0 && count > 0 && !loading) {
        out.push({
          key: 'view-all',
          heading: null,
          entries: [
            {
              kind: 'viewAll',
              value: 'site.view-all',
              href: searchHref(typeScope ?? undefined),
              count,
              label: typeScope
                ? t('search.v2.view_all_type', { count, type: t(typeGroupKey(typeScope)).toLowerCase() })
                : t('search.palette.view_all', { query: trimmed }),
            },
          ],
        })
      }
    }
    return out
  }, [
    trimmed,
    hasQuery,
    scope,
    typeScope,
    orgslug,
    recentSearches,
    matchedActions,
    matchedPages,
    contentResults,
    all.total,
    all.totals,
    loading,
    t,
  ])

  const showSkeleton = hasQuery && scope !== 'pages' && contentResults.length === 0 && (loading || scoped.isLoading)
  const nothingFound = groups.every((g) => g.entries.length === 0) && !showSkeleton && !loading

  // With nothing found, offer ways out that stay keyboard-reachable.
  const fallbackGroup: Group | null = useMemo(() => {
    if (!nothingFound || !trimmed) return null
    const entries: Entry[] = []
    if (scope !== 'all') {
      entries.push({ kind: 'scope', value: 'scope:all', scope: 'all', label: t('search.v2.search_all_types') })
    }
    for (const page of pages.filter((p) => p.id !== 'site.home' && p.id !== 'site.search').slice(0, 3)) {
      entries.push({ kind: 'page', value: page.id, page, href: getUriWithOrg(orgslug, page.href) })
    }
    return entries.length ? { key: 'fallback', heading: t('search.v2.try_instead'), entries } : null
  }, [nothingFound, trimmed, scope, pages, orgslug, t])

  const allGroups = useMemo(() => (fallbackGroup ? [...groups, fallbackGroup] : groups), [groups, fallbackGroup])
  const orderedValues = useMemo(() => allGroups.flatMap((g) => g.entries.map((e) => e.value)), [allGroups])
  const entryByValue = useMemo(() => {
    const map = new Map<string, Entry>()
    for (const g of allGroups) for (const e of g.entries) map.set(e.value, e)
    return map
  }, [allGroups])

  // A new query or scope starts again from the top.
  useEffect(() => {
    followFirst.current = true
  }, [trimmed, scope])

  useEffect(() => {
    const first = orderedValues[0] ?? ''
    if (followFirst.current || !orderedValues.includes(selected)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (selected !== first) setSelected(first)
    }
  }, [orderedValues, selected])

  useEffect(() => {
    if (!open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setQuery('')
      setScope('all')
    }
  }, [open])

  useEffect(() => {
    if (open) track(AnalyticsEvent.CommandPaletteOpened)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // Report a search to org analytics once the visitor stops typing and the
  // results are in, so half-typed words aren't counted as searches.
  const reportedQuery = useRef('')
  useEffect(() => {
    if (!open || !hasQuery || loading || reportedQuery.current === trimmed) return
    const timer = setTimeout(() => {
      reportedQuery.current = trimmed
      track(AnalyticsEvent.SearchQuery, {
        query: trimmed,
        results_count: all.total,
        surface: 'command_palette',
      })
    }, 1200)
    return () => clearTimeout(timer)
  }, [open, hasQuery, loading, trimmed, all.total, track])

  // Leave a scope that no longer has anything once the query changes.
  useEffect(() => {
    if (!hasQuery && scope !== 'all') {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setScope('all')
    }
  }, [hasQuery, scope])

  const go = (href: string, resultType: string, index: number) => {
    track(AnalyticsEvent.CommandPaletteResultSelected, { result_type: resultType, result_index: index })
    if (hasQuery && resultType !== 'page') recentSearches.add(trimmed)
    setOpen(false)
    router.push(href)
  }

  const runEntry = (entry: Entry, index: number) => {
    switch (entry.kind) {
      case 'page':
        return go(entry.href, 'page', index)
      case 'result':
        return go(entry.result.href, entry.result.type, index)
      case 'viewAll':
        return go(entry.href, 'view_all', entry.count)
      case 'action':
        track(AnalyticsEvent.CommandPaletteResultSelected, { result_type: 'action', result_index: index })
        setOpen(false)
        return entry.action.run()
      case 'recent':
        return setQuery(entry.query)
      case 'scope':
        return setScope(entry.scope)
    }
  }

  const openInNewTab = (entry: Entry | undefined) => {
    const href = hrefOf(entry)
    if (!href) return
    if (hasQuery) recentSearches.add(trimmed)
    window.open(href, '_blank', 'noopener,noreferrer')
  }

  const cycleScope = (dir: 1 | -1) => {
    if (scopes.length < 2) return
    const i = Math.max(0, scopes.findIndex((s) => s.key === scope))
    setScope(scopes[(i + dir + scopes.length) % scopes.length].key)
  }

  const selectedEntry = entryByValue.get(selected)
  const highlight = trimmed

  const renderEntry = (entry: Entry, index: number) => {
    let thumb: React.ReactNode
    let title: React.ReactNode
    let subtitle: React.ReactNode = null
    let trailing: React.ReactNode = null
    switch (entry.kind) {
      case 'page': {
        const Icon = entry.page.icon
        thumb = (
          <span className={ICON_TILE}>
            <Icon size={17} weight="fill" />
          </span>
        )
        title = <Highlight text={t(entry.page.titleKey)} query={highlight} />
        if (entry.page.descriptionKey) subtitle = <Highlight text={t(entry.page.descriptionKey)} query={highlight} />
        if (entry.page.shortcut) trailing = <Keys keys={entry.page.shortcut} tone="muted" className="hidden sm:inline-flex" />
        break
      }
      case 'action':
        thumb = (
          <span className={ICON_TILE}>
            <Keyboard size={17} weight="duotone" />
          </span>
        )
        title = <Highlight text={entry.action.label} query={highlight} />
        trailing = <Keys keys={entry.action.keys} tone="muted" className="hidden sm:inline-flex" />
        break
      case 'result':
        thumb = <ResultThumb result={entry.result} />
        title = <Highlight text={entry.result.title} query={highlight} />
        if (entry.result.subtitle) subtitle = <Highlight text={entry.result.subtitle} query={highlight} />
        break
      case 'recent':
        thumb = (
          <span className={`${ICON_TILE} bg-transparent ring-0`}>
            <ClockCounterClockwise size={17} />
          </span>
        )
        title = entry.query
        trailing = (
          <button
            type="button"
            aria-label={t('search.v2.remove_recent', { query: entry.query })}
            onPointerDown={(e) => {
              e.preventDefault()
              e.stopPropagation()
            }}
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              recentSearches.remove(entry.query)
            }}
            className="flex h-6 w-6 items-center justify-center rounded-md text-neutral-400 opacity-0 transition-opacity hover:bg-neutral-200/70 hover:text-neutral-700 group-hover/item:opacity-100 group-aria-selected/item:opacity-100 max-md:opacity-100"
          >
            <X size={12} weight="bold" />
          </button>
        )
        break
      case 'scope':
        thumb = (
          <span className={ICON_TILE}>
            <MagnifyingGlass size={17} />
          </span>
        )
        title = entry.label
        break
      case 'viewAll':
        thumb = (
          <span className={ICON_TILE}>
            <ArrowRight size={16} className="rtl:rotate-180" />
          </span>
        )
        title = <span className="text-neutral-600">{entry.label}</span>
        trailing = <span className="text-xs tabular-nums text-neutral-400">{entry.count}</span>
        break
    }
    return (
      <Command.Item
        key={entry.value}
        value={entry.value}
        onSelect={() => runEntry(entry, index)}
        className={ITEM_CLASS}
        data-href={hrefOf(entry)}
      >
        {thumb}
        <span className="flex min-w-0 flex-1 flex-col leading-snug">
          <span className="truncate text-sm font-medium text-neutral-900">{title}</span>
          {subtitle && <span className="truncate text-xs text-neutral-500">{subtitle}</span>}
        </span>
        {trailing}
        <span className="hidden text-xs text-neutral-400 md:group-aria-selected/item:inline" aria-hidden="true">
          ↵
        </span>
      </Command.Item>
    )
  }

  let runningIndex = 0

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className="lh-modal-overlay fixed inset-0 bg-black/40"
          style={{ zIndex: 'var(--z-modal-backdrop)' as any }}
        />
        <DialogPrimitive.Content
          aria-label={t('search.palette.placeholder')}
          // Phones: a full-screen search view with Cancel, the way the OS
          // presents search; from md up, the floating palette, with a preview
          // pane beside the list from lg.
          className="lh-search-sheet fixed inset-x-3 top-[8vh] mx-auto flex w-auto max-w-[660px] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl shadow-black/20 ring-1 ring-black/5 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0 data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95 data-[state=open]:duration-150 data-[state=closed]:duration-100 ease-out md:h-[min(580px,80vh)] lg:max-w-[920px] sm:top-[12vh] max-md:inset-0 max-md:h-[100dvh] max-md:max-w-none max-md:rounded-none max-md:ring-0 max-md:pt-[var(--lh-safe-top)] max-md:data-[state=open]:zoom-in-100 max-md:data-[state=closed]:zoom-out-100 max-md:data-[state=open]:slide-in-from-bottom-4"
          style={{ zIndex: 'var(--z-modal)' as any }}
          onOpenAutoFocus={(e) => {
            e.preventDefault()
            const input = (e.currentTarget as HTMLElement).querySelector('input')
            input?.focus()
          }}
        >
          <DialogPrimitive.Title className="sr-only">{t('search.palette.trigger')}</DialogPrimitive.Title>

          <Command
            label={t('search.palette.trigger')}
            shouldFilter={false}
            value={selected}
            onValueChange={(v) => {
              followFirst.current = v === orderedValues[0]
              setSelected(v)
            }}
            className="flex min-h-0 flex-1 flex-col [&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pb-1.5 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-neutral-400"
          >
            {/* ── Input ─────────────────────────────────────────────── */}
            <div className="relative flex items-center gap-3 px-4 md:h-[60px] max-md:px-3 max-md:py-2.5">
              <div className="flex min-w-0 flex-1 items-center gap-3 max-md:h-11 max-md:gap-2 max-md:rounded-xl max-md:bg-neutral-100 max-md:px-3">
                <MagnifyingGlass size={20} className="shrink-0 text-neutral-400 max-md:size-[18px]" />
                <Command.Input
                  value={query}
                  onValueChange={setQuery}
                  placeholder={t('search.palette.placeholder')}
                  autoComplete="off"
                  spellCheck={false}
                  onKeyDown={(e) => {
                    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                      e.preventDefault()
                      e.stopPropagation()
                      openInNewTab(selectedEntry)
                      return
                    }
                    if (e.key === 'Tab' && !e.metaKey && !e.ctrlKey && !e.altKey && scopes.length > 1) {
                      e.preventDefault()
                      cycleScope(e.shiftKey ? -1 : 1)
                    }
                  }}
                  className="min-w-0 flex-1 bg-transparent text-base text-neutral-900 outline-none placeholder:text-neutral-400 md:text-[17px]"
                />
                {query && (
                  <button
                    type="button"
                    onPointerDown={(e) => e.preventDefault()}
                    onClick={() => setQuery('')}
                    aria-label={t('search.v2.clear_query')}
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-neutral-200/70 text-neutral-500 transition-colors hover:bg-neutral-300/70 hover:text-neutral-800"
                  >
                    <X size={11} weight="bold" />
                  </button>
                )}
              </div>
              <kbd className="hidden h-[22px] shrink-0 items-center rounded-md bg-neutral-100 px-1.5 font-sans text-[11px] font-medium text-neutral-500 ring-1 ring-inset ring-black/[0.04] md:inline-flex">
                esc
              </kbd>
              <DialogPrimitive.Close className="shrink-0 px-1 text-[15px] font-medium text-neutral-700 active:opacity-60 md:hidden">
                {t('common.cancel')}
              </DialogPrimitive.Close>
              {/* Loading: a quiet line under the input rather than a spinner. */}
              <span
                aria-hidden
                className={`pointer-events-none absolute inset-x-0 bottom-0 h-px transition-colors ${
                  loading ? 'animate-pulse bg-neutral-400' : 'bg-neutral-100 max-md:bg-transparent'
                }`}
              />
            </div>

            {/* ── Scopes ────────────────────────────────────────────── */}
            {scopes.length > 1 && (
              <div
                role="tablist"
                aria-label={t('search.filter_heading')}
                className="flex shrink-0 items-center gap-1.5 overflow-x-auto border-b border-neutral-100 px-3 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              >
                {scopes.map((s) => {
                  const active = s.key === scope
                  const Icon = s.icon
                  return (
                    <button
                      key={s.key}
                      type="button"
                      role="tab"
                      tabIndex={-1}
                      aria-selected={active}
                      onPointerDown={(e) => e.preventDefault()}
                      onClick={() => setScope(s.key)}
                      className={`inline-flex h-7 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold transition-colors ${
                        active
                          ? 'bg-neutral-900 text-white shadow-[0_1px_1px_rgba(0,0,0,0.08)]'
                          : 'text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900'
                      }`}
                    >
                      {Icon && <Icon size={13} weight={active ? 'fill' : 'regular'} />}
                      {s.label}
                      {s.count !== undefined && (
                        <span className={`tabular-nums ${active ? 'text-white/60' : 'text-neutral-400'}`}>{s.count}</span>
                      )}
                    </button>
                  )
                })}
              </div>
            )}

            <div className="flex min-h-0 flex-1">
              {/* ── Results ─────────────────────────────────────────── */}
              <Command.List
                className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-2 scroll-py-2"
                style={{ scrollbarWidth: 'thin' }}
              >
                {nothingFound && (
                  <div className="flex flex-col items-center px-6 pb-2 pt-10 text-center">
                    <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-neutral-100 text-neutral-400">
                      <MagnifyingGlass size={20} />
                    </div>
                    <p className="text-sm font-semibold text-neutral-900">
                      {hasQuery ? t('search.palette.no_results', { query: trimmed }) : t('search.v2.keep_typing')}
                    </p>
                    <p className="mt-1 max-w-xs text-xs text-neutral-500">
                      {hasQuery ? t('search.v2.no_results_tip') : t('search.v2.min_chars', { count: MIN_QUERY })}
                    </p>
                  </div>
                )}

                {allGroups.map((group) =>
                  group.entries.length === 0 ? null : (
                    <Command.Group key={group.key} heading={group.heading ?? undefined}>
                      {group.entries.map((entry) => renderEntry(entry, runningIndex++))}
                    </Command.Group>
                  ),
                )}

                {showSkeleton && (
                  <div>
                    <div className="px-2.5 pb-1.5 pt-3">
                      <div className="h-2.5 w-16 rounded bg-neutral-100 animate-pulse" />
                    </div>
                    <SkeletonRows count={4} />
                  </div>
                )}
              </Command.List>

              {/* ── Preview ─────────────────────────────────────────── */}
              <aside className="hidden w-[300px] shrink-0 border-s border-neutral-100 bg-neutral-50/60 lg:flex">
                <Preview
                  entry={selectedEntry}
                  query={highlight}
                  totals={all.totals}
                  locale={i18n.language}
                  isMac={isMac}
                  onOpen={() => selectedEntry && runEntry(selectedEntry, orderedValues.indexOf(selected))}
                  onNewTab={() => openInNewTab(selectedEntry)}
                />
              </aside>
            </div>

            {/* ── Key hints ─────────────────────────────────────────── */}
            <div className="flex shrink-0 items-center gap-4 border-t border-neutral-100 px-4 py-2.5 text-[11.5px] text-neutral-500 max-md:hidden">
              <KeyHint label={t('search.palette.keys.navigate')} keys={['↑', '↓']} />
              <KeyHint label={t('search.palette.keys.open')} keys={['↵']} />
              <KeyHint label={t('search.palette.keys.new_tab')} keys={[isMac ? '⌘' : 'Ctrl', '↵']} />
              {scopes.length > 1 && <KeyHint label={t('search.v2.keys.switch_type')} keys={['Tab']} />}
              <KeyHint label={t('search.palette.keys.close')} keys={['esc']} />
              {shortcuts && (
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false)
                    shortcuts.setHelpOpen(true)
                  }}
                  className="ms-auto inline-flex items-center gap-1.5 rounded px-1 text-neutral-500 transition-colors hover:text-neutral-800"
                >
                  <Kbd>?</Kbd>
                  <span>{t('shortcuts.help')}</span>
                </button>
              )}
            </div>
          </Command>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

// ─── Preview pane ────────────────────────────────────────────────────────

function Preview({
  entry,
  query,
  totals,
  locale,
  isMac,
  onOpen,
  onNewTab,
}: {
  entry: Entry | undefined
  query: string
  totals: Record<SiteResultType, number>
  locale: string
  isMac: boolean
  onOpen: () => void
  onNewTab: () => void
}) {
  const { t } = useTranslation()
  if (!entry) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-xs text-neutral-400">
        <MagnifyingGlass size={22} />
        {t('search.palette.empty_hint')}
      </div>
    )
  }

  const canNewTab = !!hrefOf(entry)
  const openLabel =
    entry.kind === 'action'
      ? t('search.v2.run')
      : entry.kind === 'recent' || entry.kind === 'scope'
        ? t('common.search')
        : t('search.palette.keys.open')

  let body: React.ReactNode
  if (entry.kind === 'result') {
    const r = entry.result
    const Icon = TYPE_ICON[r.type]
    const kind = r.type === 'activity' ? activityKind(r.activityType, r.activitySubType) : null
    const updated = formatRelative(r.updatedAt, locale)
    const hasCover = !!r.imageUrl && r.type !== 'user'
    body = (
      <>
        {hasCover ? (
          <div className="aspect-video w-full overflow-hidden rounded-xl bg-neutral-100 ring-1 ring-black/5">
            <ThumbnailImage src={r.imageUrl} loading="eager" className="h-full w-full object-cover" />
          </div>
        ) : (
          <ResultThumb key={r.id} result={r} size="md" />
        )}
        <div className="flex flex-wrap items-center gap-1.5">
          <Chip icon={<Icon size={12} weight="fill" />}>{t(typeOneKey(r.type))}</Chip>
          {kind && <Chip icon={<kind.icon size={12} weight="fill" />}>{t(kind.key)}</Chip>}
        </div>
        <h3 className="text-[15px] font-semibold leading-snug text-neutral-900" dir="auto">
          <Highlight text={r.title} query={query} />
        </h3>
        {(r.description || r.subtitle) && r.type !== 'activity' && r.type !== 'user' && (
          <p className="line-clamp-[7] text-[13px] leading-relaxed text-neutral-500" dir="auto">
            <Highlight text={r.description || r.subtitle} query={query} />
          </p>
        )}
        <dl className="flex flex-col gap-2 text-xs">
          {r.type === 'activity' && r.courseName && (
            <MetaRow label={t('search.course')}>{r.courseName}</MetaRow>
          )}
          {r.type === 'activity' && r.chapterName && (
            <MetaRow label={t('search.v2.chapter')}>{r.chapterName}</MetaRow>
          )}
          {r.type === 'user' && r.subtitle && <MetaRow label={t('search.v2.username')}>{r.subtitle}</MetaRow>}
          {r.people && r.people.length > 0 && (
            <MetaRow label={t('search.v2.by')}>
              <span className="flex min-w-0 items-center gap-2">
                <AvatarStack people={r.people} size={18} />
                <span className="truncate">{r.people.map((p) => p.label).filter(Boolean).join(', ')}</span>
              </span>
            </MetaRow>
          )}
          {updated && <MetaRow label={t('search.v2.updated')}>{updated}</MetaRow>}
        </dl>
      </>
    )
  } else if (entry.kind === 'page') {
    const Icon = entry.page.icon
    body = (
      <>
        <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-white text-neutral-700 shadow-[0_1px_1px_rgba(0,0,0,0.03),0_0_0_1px_rgba(0,0,0,0.07)]">
          <Icon size={22} weight="fill" />
        </span>
        <div>
          <Chip icon={<SquaresFour size={12} weight="fill" />}>{t('search.v2.type_one.page')}</Chip>
        </div>
        <h3 className="text-[15px] font-semibold text-neutral-900">{t(entry.page.titleKey)}</h3>
        {entry.page.descriptionKey && (
          <p className="text-[13px] leading-relaxed text-neutral-500">{t(entry.page.descriptionKey)}</p>
        )}
        {entry.page.shortcut && (
          <p className="flex flex-wrap items-center gap-1.5 text-xs text-neutral-500">
            {t('search.v2.jump_anytime')}
            <Keys keys={entry.page.shortcut} />
          </p>
        )}
      </>
    )
  } else if (entry.kind === 'action') {
    body = (
      <>
        <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-white text-neutral-700 shadow-[0_1px_1px_rgba(0,0,0,0.03),0_0_0_1px_rgba(0,0,0,0.07)]">
          <Keyboard size={22} weight="duotone" />
        </span>
        <h3 className="text-[15px] font-semibold text-neutral-900">{entry.action.label}</h3>
        <p className="flex flex-wrap items-center gap-1.5 text-xs text-neutral-500">
          {t('search.v2.shortcut')}
          <Keys keys={entry.action.keys} />
        </p>
      </>
    )
  } else if (entry.kind === 'viewAll') {
    const types = SITE_RESULT_ORDER.filter((type) => totals[type] > 0)
    body = (
      <>
        <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-white text-neutral-700 shadow-[0_1px_1px_rgba(0,0,0,0.03),0_0_0_1px_rgba(0,0,0,0.07)]">
          <MagnifyingGlass size={22} />
        </span>
        <h3 className="text-[15px] font-semibold text-neutral-900">{entry.label}</h3>
        <ul className="flex flex-col gap-1.5 text-xs text-neutral-600">
          {types.map((type) => {
            const Icon = TYPE_ICON[type]
            return (
              <li key={type} className="flex items-center gap-2">
                <Icon size={14} className="text-neutral-400" />
                <span className="flex-1">{t(typeGroupKey(type))}</span>
                <span className="tabular-nums text-neutral-400">{totals[type]}</span>
              </li>
            )
          })}
        </ul>
      </>
    )
  } else {
    const label = entry.kind === 'recent' ? entry.query : entry.label
    body = (
      <>
        <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-white text-neutral-500 shadow-[0_1px_1px_rgba(0,0,0,0.03),0_0_0_1px_rgba(0,0,0,0.07)]">
          {entry.kind === 'recent' ? <ClockCounterClockwise size={22} /> : <MagnifyingGlass size={22} />}
        </span>
        <h3 className="text-[15px] font-semibold text-neutral-900" dir="auto">
          {entry.kind === 'recent' ? t('search.v2.search_for', { query: label }) : label}
        </h3>
        {entry.kind === 'recent' && <p className="text-xs text-neutral-500">{t('search.v2.recent_hint')}</p>}
      </>
    )
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-5" style={{ scrollbarWidth: 'thin' }}>
        {body}
      </div>
      <div className="flex shrink-0 items-center gap-2 border-t border-neutral-100 px-5 py-3">
        <Button variant="primary" size="sm" onClick={onOpen}>
          {openLabel}
          <Kbd tone="onDark">↵</Kbd>
        </Button>
        {canNewTab && (
          <Button
            variant="secondary"
            size="sm"
            onClick={onNewTab}
            icon={<ArrowSquareOut size={13} />}
            title={`${isMac ? '⌘' : 'Ctrl'} ↵`}
          >
            {t('search.palette.keys.new_tab')}
          </Button>
        )}
      </div>
    </div>
  )
}

function MetaRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 items-baseline gap-3">
      <dt className="w-16 shrink-0 text-neutral-400">{label}</dt>
      <dd className="min-w-0 flex-1 truncate text-neutral-700" dir="auto">
        {children}
      </dd>
    </div>
  )
}

function Kbd({ children, tone = 'light' }: { children: React.ReactNode; tone?: 'light' | 'onDark' }) {
  return (
    <kbd
      className={`inline-flex h-[18px] min-w-[18px] items-center justify-center rounded px-1 font-sans text-[10.5px] font-medium leading-none ${
        tone === 'onDark' ? 'bg-white/15 text-white/80' : 'bg-neutral-100 text-neutral-500 ring-1 ring-inset ring-black/[0.04]'
      }`}
    >
      {children}
    </kbd>
  )
}

function KeyHint({ label, keys }: { label: string; keys: string[] }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {keys.map((k) => (
        <Kbd key={k}>{k}</Kbd>
      ))}
      <span>{label}</span>
    </span>
  )
}
