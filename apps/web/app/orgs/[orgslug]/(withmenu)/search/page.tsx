'use client'

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import {
  ArrowClockwise,
  ArrowRight,
  CaretRight,
  ClockCounterClockwise,
  MagnifyingGlass,
  Warning,
  X,
} from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'

import { searchOrgContent } from '@services/search/search'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrg } from '@components/Contexts/OrgContext'
import ListShortcuts from '@components/Objects/Shortcuts/ListShortcuts'
import GeneralWrapperStyled from '@components/Objects/StyledElements/Wrappers/GeneralWrapper'
import CourseCard, { type CourseCardCourse } from '@components/Objects/Thumbnails/CourseCard'
import { Button, Chip, EmptyState, SegmentedControl, formatRelative } from '@components/Dashboard/Shared/DashKit/DashKit'
import { getUriWithOrg } from '@services/config/config'
import { useLHAnalytics, AnalyticsEvent } from '@services/analytics'
import { useSitePages } from '@/lib/site-search/useSitePages'
import { useRecentSearches } from '@/lib/site-search/recent'
import { coursePath } from '@/lib/seo/paths'
import { useContentLanguage } from '@/hooks/useContentLanguage'
import {
  MIN_QUERY,
  SITE_RESULT_ORDER,
  emptyTotals,
  normalizeSiteResults,
  type SiteResult,
  type SiteResultType,
  type SiteSearchData,
} from '@/lib/site-search/useSiteSearch'
import {
  Highlight,
  PLURAL_TO_TYPE,
  ResultThumb,
  SkeletonRows,
  TYPE_ICON,
  TYPE_PLURAL,
  activityKind,
  typeGroupKey,
} from '@components/Objects/Search/searchUi'

// The full search page: every type the org search returns, with counts per
// type, a short section per type on "All" and a longer, paged list once a
// type is picked. The query and type live in the URL (?q=…&type=…) so a
// search can be shared and survives back/forward.

type Scope = 'all' | SiteResultType

interface PageData {
  courses: CourseCardCourse[]
  normalized: SiteSearchData
}

/** Per type on "All": up to two rows of course cards, a short list for the rest. */
const PER_TYPE_ALL = 8
/** Per page once a type is picked ("Show more" fetches the next page). */
const PER_PAGE_SCOPED = 18
/** Rows shown per list section on "All". */
const ROWS_ALL = 5

function useSearchFetcher() {
  const { t } = useTranslation()
  const session = useLHSession() as any
  const org = useOrg() as any
  const orgslug: string = org?.slug ?? ''
  const orgUuid: string = org?.org_uuid ?? ''
  const accessToken = session?.data?.tokens?.access_token ?? null
  // Course names in the learner's content language (published translations).
  const { lang } = useContentLanguage()

  const fetchPage = useCallback(
    async (query: string, page: number, limit: number): Promise<PageData> => {
      const res = await searchOrgContent(orgslug, query, page, limit, null, accessToken, lang || undefined)
      if (!res?.success) {
        const detail = typeof res?.data?.detail === 'string' ? res.data.detail : ''
        throw new Error(detail || t('search.v2.error'))
      }
      const lessonLocation = (course: string, chapter: string) => t('search.lesson_location', { course, chapter })
      return {
        courses: Array.isArray(res.data?.courses) ? res.data.courses : [],
        normalized: normalizeSiteResults(res.data, orgslug, orgUuid, lessonLocation),
      }
    },
    [orgslug, orgUuid, accessToken, t, lang],
  )
  return { fetchPage, orgslug, orgUuid, accessToken, lang }
}

function SearchPage() {
  const { t, i18n } = useTranslation()
  const router = useRouter()
  const searchParams = useSearchParams()
  const { track } = useLHAnalytics('learner')
  const { fetchPage, orgslug, orgUuid, accessToken, lang } = useSearchFetcher()
  const recentSearches = useRecentSearches(orgslug)
  const pages = useSitePages()

  const urlQuery = (searchParams.get('q') ?? '').trim()
  const typeParam = searchParams.get('type') ?? ''
  const scope: Scope = (PLURAL_TO_TYPE[typeParam] as SiteResultType | undefined) ?? 'all'
  const validQuery = urlQuery.length >= MIN_QUERY

  // ── Input ⇄ URL ────────────────────────────────────────────────────────
  const [inputValue, setInputValue] = useState(urlQuery)
  const lastPushed = useRef(urlQuery)
  const inputRef = useRef<HTMLInputElement>(null)

  // Back/forward (or a link from the palette) changes the URL under us.
  useEffect(() => {
    if (urlQuery !== lastPushed.current) {
      lastPushed.current = urlQuery
      setInputValue(urlQuery)
    }
  }, [urlQuery])

  const replaceParams = useCallback(
    (updates: Record<string, string | null>) => {
      const next = new URLSearchParams(Array.from(searchParams.entries()))
      next.delete('page') // the old paginated page used it; "Show more" replaced it
      for (const [key, value] of Object.entries(updates)) {
        if (!value) next.delete(key)
        else next.set(key, value)
      }
      const qs = next.toString()
      router.replace(qs ? `?${qs}` : '?', { scroll: false })
    },
    [router, searchParams],
  )

  const commitQuery = useCallback(
    (raw: string, source: 'typing' | 'submit') => {
      const q = raw.trim()
      if (q === lastPushed.current && source === 'typing') return
      lastPushed.current = q
      if (q.length >= MIN_QUERY) {
        track(AnalyticsEvent.SearchExecuted, { query_length: q.length, source: 'search_page' })
      }
      replaceParams({ q: q || null })
    },
    [replaceParams, track],
  )

  // Search as you type, once the typing pauses.
  useEffect(() => {
    const id = window.setTimeout(() => commitQuery(inputValue, 'typing'), 350)
    return () => window.clearTimeout(id)
  }, [inputValue, commitQuery])

  // "/" focuses the field, like the list filters across the app.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return
      const target = e.target as HTMLElement | null
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return
      e.preventDefault()
      inputRef.current?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const q = inputValue.trim()
    if (!q) return
    if (q.length >= MIN_QUERY) recentSearches.add(q)
    commitQuery(q, 'submit')
  }

  const setScope = (next: Scope) => replaceParams({ type: next === 'all' ? null : TYPE_PLURAL[next] })

  // ── Data ───────────────────────────────────────────────────────────────
  // "All" always runs: it carries the per-type counts for the scope bar.
  const allQuery = useQuery({
    queryKey: ['site-search-page', orgslug, urlQuery, 'all', accessToken, lang],
    queryFn: () => fetchPage(urlQuery, 1, PER_TYPE_ALL),
    enabled: validQuery && !!orgslug,
    placeholderData: (prev) => prev,
    refetchOnWindowFocus: false,
    staleTime: 30_000,
    retry: false,
  })

  const scopedQuery = useInfiniteQuery({
    queryKey: ['site-search-page', 'scoped', orgslug, urlQuery, scope, accessToken, lang],
    queryFn: ({ pageParam }) => fetchPage(urlQuery, pageParam, PER_PAGE_SCOPED),
    initialPageParam: 1,
    getNextPageParam: (last, all) => {
      if (scope === 'all') return undefined
      const loaded = all.reduce((n, p) => n + p.normalized.results.filter((r) => r.type === scope).length, 0)
      const returned = last.normalized.results.filter((r) => r.type === scope).length
      return returned > 0 && loaded < last.normalized.totals[scope] ? all.length + 1 : undefined
    },
    enabled: validQuery && !!orgslug && scope !== 'all',
    refetchOnWindowFocus: false,
    staleTime: 30_000,
    retry: false,
  })

  const allData = allQuery.data?.normalized
  const totals = allData?.totals ?? emptyTotals()
  const grandTotal = allData?.total ?? 0
  // Placeholder data from the previous query still shows while typing; only
  // trust its counts once it belongs to this query.
  const settled = !!allQuery.data && !allQuery.isPlaceholderData

  // Report each search to org analytics once its results are in. The ref keeps
  // paging, scope changes and re-renders from counting the same search again.
  const reportedQuery = useRef<string | null>(null)
  useEffect(() => {
    if (!validQuery || !settled || reportedQuery.current === urlQuery) return
    reportedQuery.current = urlQuery
    track(AnalyticsEvent.SearchQuery, { query: urlQuery, results_count: grandTotal, surface: 'search_page' })
  }, [validQuery, settled, urlQuery, grandTotal, track])

  const scopedResults = useMemo(() => {
    if (scope === 'all') return [] as SiteResult[]
    const seen = new Set<string>()
    const out: SiteResult[] = []
    for (const p of scopedQuery.data?.pages ?? []) {
      for (const r of p.normalized.results) {
        if (r.type !== scope || seen.has(r.id)) continue
        seen.add(r.id)
        out.push(r)
      }
    }
    return out
  }, [scope, scopedQuery.data])

  const scopedCourses = useMemo(() => {
    if (scope !== 'course') return [] as CourseCardCourse[]
    const seen = new Set<string>()
    return (scopedQuery.data?.pages ?? []).flatMap((p) => p.courses).filter((c) => {
      if (!c?.course_uuid || seen.has(c.course_uuid)) return false
      seen.add(c.course_uuid)
      return true
    })
  }, [scope, scopedQuery.data])

  const loadingFirst =
    validQuery && (scope === 'all' ? !settled && !allQuery.isError : scopedQuery.isPending && !scopedQuery.isError)
  const error = scope === 'all' ? allQuery.error : scopedQuery.error
  const activeTotal = scope === 'all' ? grandTotal : totals[scope]
  const typing = inputValue.trim() !== urlQuery

  const onResultClick = (type: string, position: number) => {
    track(AnalyticsEvent.SearchResultClicked, { result_type: type, position })
    recentSearches.add(urlQuery)
  }

  const scopeOptions = useMemo(() => {
    const opts: { key: Scope; label: React.ReactNode; count?: number }[] = [
      { key: 'all', label: t('search.types.all'), count: settled ? grandTotal : undefined },
    ]
    for (const type of SITE_RESULT_ORDER) {
      if (!settled || totals[type] > 0 || type === scope) {
        const Icon = TYPE_ICON[type]
        // Before the counts arrive, list nothing but the active scope.
        if (!settled && type !== scope) continue
        opts.push({
          key: type,
          label: (
            <>
              <Icon size={13} weight={type === scope ? 'fill' : 'regular'} />
              {t(typeGroupKey(type))}
            </>
          ),
          count: settled ? totals[type] : undefined,
        })
      }
    }
    return opts
  }, [settled, grandTotal, totals, scope, t])

  const courseHref = (c: CourseCardCourse) => getUriWithOrg(orgslug, coursePath(c as { slug?: string | null; course_uuid: string }))
  const browsePages = pages.filter((p) => p.id !== 'site.search' && p.id !== 'site.home' && !p.requiresAuth).slice(0, 6)

  // ── Render ─────────────────────────────────────────────────────────────
  let body: React.ReactNode
  if (!urlQuery) {
    body = (
      <StartState
        recent={recentSearches.recent}
        onPick={(q) => {
          setInputValue(q)
          commitQuery(q, 'submit')
        }}
        onRemove={recentSearches.remove}
        onClear={recentSearches.clear}
        pages={browsePages}
        orgslug={orgslug}
      />
    )
  } else if (!validQuery) {
    body = (
      <EmptyState
        icon={<MagnifyingGlass size={22} />}
        title={t('search.v2.keep_typing')}
        description={t('search.v2.min_chars', { count: MIN_QUERY })}
      />
    )
  } else if (error) {
    body = (
      <EmptyState
        icon={<Warning size={22} />}
        title={t('search.v2.error_title')}
        description={(error as Error).message}
        action={
          <Button
            variant="secondary"
            icon={<ArrowClockwise size={14} />}
            onClick={() => (scope === 'all' ? allQuery.refetch() : scopedQuery.refetch())}
          >
            {t('search.v2.retry')}
          </Button>
        }
      />
    )
  } else if (loadingFirst) {
    body = <LoadingState scope={scope} />
  } else if (activeTotal === 0) {
    body = (
      <NoResults
        query={urlQuery}
        scoped={scope !== 'all'}
        anyResults={grandTotal > 0}
        onSearchAll={() => setScope('all')}
        pages={browsePages}
        orgslug={orgslug}
      />
    )
  } else if (scope === 'all') {
    const results = allData?.results ?? []
    const courses = allQuery.data?.courses ?? []
    const listTypes = SITE_RESULT_ORDER.filter((type) => type !== 'course' && results.some((r) => r.type === type))
    body = (
      <div className="flex flex-col gap-10">
        {courses.length > 0 && (
          <Section
            type="course"
            total={totals.course}
            shown={courses.length}
            onSeeAll={() => setScope('course')}
          >
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {courses.map((course, i) => (
                <CourseCard
                  key={course.course_uuid}
                  course={course}
                  orgUuid={orgUuid}
                  href={courseHref(course)}
                  onOpen={() => onResultClick('courses', i + 1)}
                />
              ))}
            </div>
          </Section>
        )}
        {listTypes.length > 0 && (
          <div className="grid grid-cols-1 gap-x-6 gap-y-10 xl:grid-cols-2">
            {listTypes.map((type) => {
              const items = results.filter((r) => r.type === type).slice(0, ROWS_ALL)
              return (
                <Section
                  key={type}
                  type={type}
                  total={totals[type]}
                  shown={items.length}
                  onSeeAll={() => setScope(type)}
                >
                  <ResultList
                    items={items}
                    query={urlQuery}
                    locale={i18n.language}
                    onClick={(r, i) => onResultClick(TYPE_PLURAL[r.type], i + 1)}
                  />
                </Section>
              )
            })}
          </div>
        )}
      </div>
    )
  } else {
    const shown = scope === 'course' ? scopedCourses.length : scopedResults.length
    body = (
      <div className="flex flex-col gap-6">
        {scope === 'course' ? (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {scopedCourses.map((course, i) => (
              <CourseCard
                key={course.course_uuid}
                course={course}
                orgUuid={orgUuid}
                href={courseHref(course)}
                onOpen={() => onResultClick('courses', i + 1)}
              />
            ))}
          </div>
        ) : scope === 'user' ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {scopedResults.map((r, i) => (
              <Link
                key={r.id}
                data-kbd-item=""
                href={r.href}
                prefetch={false}
                onClick={() => onResultClick('users', i + 1)}
                className="flex items-center gap-3 rounded-2xl bg-white p-3.5 nice-shadow transition-shadow hover:ring-1 hover:ring-neutral-200"
              >
                <ResultThumb result={r} size="md" />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-neutral-900">
                    <Highlight text={r.title} query={urlQuery} />
                  </span>
                  {r.subtitle && (
                    <span className="block truncate text-xs text-neutral-500">
                      <Highlight text={r.subtitle} query={urlQuery} />
                    </span>
                  )}
                </span>
              </Link>
            ))}
          </div>
        ) : (
          <ResultList
            items={scopedResults}
            query={urlQuery}
            locale={i18n.language}
            detailed
            onClick={(r, i) => onResultClick(TYPE_PLURAL[r.type], i + 1)}
          />
        )}
        {scopedQuery.hasNextPage && (
          <div className="flex flex-col items-center gap-2">
            <Button
              variant="secondary"
              loading={scopedQuery.isFetchingNextPage}
              onClick={() => scopedQuery.fetchNextPage()}
            >
              {t('search.v2.show_more')}
            </Button>
            <span className="text-xs tabular-nums text-neutral-400">
              {t('search.v2.showing', { shown, total: totals[scope] || shown })}
            </span>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="w-full">
      <GeneralWrapperStyled>
        <ListShortcuts />
        <div className="flex flex-col gap-5 pb-10">
          {/* ── Header ──────────────────────────────────────────────── */}
          <div className="flex flex-col gap-1 pt-2">
            <h1 className="text-2xl font-bold tracking-tight text-neutral-900 sm:text-3xl">{t('common.search')}</h1>
            <p className="text-sm text-neutral-500">{t('search.start_subtitle')}</p>
          </div>

          <form onSubmit={handleSubmit} role="search" className="relative">
            <MagnifyingGlass
              size={18}
              className="pointer-events-none absolute start-4 top-1/2 -translate-y-1/2 text-neutral-400"
            />
            <input
              ref={inputRef}
              type="search"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape' && inputValue) {
                  e.preventDefault()
                  setInputValue('')
                }
              }}
              aria-label={t('search.search_placeholder')}
              placeholder={t('search.palette.placeholder')}
              autoComplete="off"
              spellCheck={false}
              enterKeyHint="search"
              className="h-12 w-full rounded-2xl bg-white ps-11 pe-14 text-[15px] text-neutral-900 nice-shadow placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-900/10 [&::-webkit-search-cancel-button]:hidden"
            />
            <div className="absolute end-3 top-1/2 flex -translate-y-1/2 items-center gap-2">
              {inputValue ? (
                <button
                  type="button"
                  onClick={() => {
                    setInputValue('')
                    inputRef.current?.focus()
                  }}
                  aria-label={t('search.v2.clear_query')}
                  className="flex h-6 w-6 items-center justify-center rounded-full bg-neutral-100 text-neutral-500 transition-colors hover:bg-neutral-200 hover:text-neutral-800"
                >
                  <X size={11} weight="bold" />
                </button>
              ) : (
                <kbd className="pointer-events-none hidden h-6 min-w-6 items-center justify-center rounded-md bg-neutral-100 px-1.5 text-[11px] font-semibold text-neutral-400 sm:flex">
                  /
                </kbd>
              )}
            </div>
            {/* Typing or loading: a quiet line along the field's bottom edge. */}
            <span
              aria-hidden
              className={`pointer-events-none absolute inset-x-4 bottom-0 h-px rounded-full transition-opacity ${
                validQuery && (typing || allQuery.isFetching || scopedQuery.isFetching)
                  ? 'animate-pulse bg-neutral-400 opacity-100'
                  : 'opacity-0'
              }`}
            />
          </form>

          {validQuery && (
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
              <div className="-mx-1 max-w-full overflow-x-auto px-1 py-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                <SegmentedControl<Scope>
                  value={scope}
                  options={scopeOptions}
                  onChange={setScope}
                  ariaLabel={t('search.filter_heading')}
                />
              </div>
              {settled && activeTotal > 0 && !error && (
                <p className="text-xs text-neutral-500" aria-live="polite">
                  {t('search.found_results', { count: activeTotal, query: urlQuery })}
                </p>
              )}
            </div>
          )}

          <div>{body}</div>
        </div>
      </GeneralWrapperStyled>
    </div>
  )
}

// ─── Sections & rows ────────────────────────────────────────────────────

function Section({
  type,
  total,
  shown,
  onSeeAll,
  children,
}: {
  type: SiteResultType
  total: number
  shown: number
  onSeeAll: () => void
  children: React.ReactNode
}) {
  const { t } = useTranslation()
  const Icon = TYPE_ICON[type]
  return (
    <section className="flex min-w-0 flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-neutral-900">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-white text-neutral-600 shadow-[0_1px_1px_rgba(0,0,0,0.03),0_0_0_1px_rgba(0,0,0,0.07)]">
            <Icon size={15} weight="fill" />
          </span>
          {t(typeGroupKey(type))}
          <span className="font-normal tabular-nums text-neutral-400">{total}</span>
        </h2>
        {total > shown && (
          <Button variant="ghost" size="sm" onClick={onSeeAll}>
            {t('search.v2.see_all', { count: total })}
            <ArrowRight size={12} className="rtl:rotate-180" />
          </Button>
        )}
      </div>
      {children}
    </section>
  )
}

function ResultList({
  items,
  query,
  locale,
  detailed = false,
  onClick,
}: {
  items: SiteResult[]
  query: string
  locale: string
  detailed?: boolean
  onClick: (_r: SiteResult, _index: number) => void
}) {
  const { t } = useTranslation()
  return (
    <ul className="divide-y divide-neutral-100 overflow-hidden rounded-2xl bg-white nice-shadow">
      {items.map((r, i) => {
        const kind = r.type === 'activity' ? activityKind(r.activityType, r.activitySubType) : null
        const updated = r.type === 'discussion' || r.type === 'community' ? formatRelative(r.updatedAt, locale) : null
        return (
          <li key={`${r.type}-${r.id}`}>
            <Link
              data-kbd-item=""
              href={r.href}
              prefetch={false}
              onClick={() => onClick(r, i)}
              className="group flex items-center gap-3.5 px-4 py-3 transition-colors hover:bg-neutral-50 focus-visible:bg-neutral-50 focus-visible:outline-none data-[kbd-active]:bg-neutral-50"
            >
              <ResultThumb result={r} size="md" />
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate text-sm font-semibold text-neutral-900">
                  <Highlight text={r.title} query={query} />
                </span>
                {r.subtitle && (
                  <span className={`text-xs text-neutral-500 ${detailed ? 'line-clamp-2' : 'truncate'}`}>
                    <Highlight text={r.subtitle} query={query} />
                  </span>
                )}
              </span>
              {kind && (
                <span className="hidden shrink-0 sm:inline-flex">
                  <Chip icon={<kind.icon size={12} weight="fill" />}>{t(kind.key)}</Chip>
                </span>
              )}
              {updated && <span className="hidden shrink-0 text-xs text-neutral-400 sm:inline">{updated}</span>}
              <CaretRight
                size={14}
                className="shrink-0 text-neutral-300 transition-colors group-hover:text-neutral-500 rtl:rotate-180"
              />
            </Link>
          </li>
        )
      })}
    </ul>
  )
}

// ─── States ─────────────────────────────────────────────────────────────

function LoadingState({ scope }: { scope: Scope }) {
  const cards = scope === 'all' || scope === 'course'
  return (
    <div className="flex flex-col gap-10" aria-busy="true">
      {cards && (
        <div className="flex flex-col gap-3">
          <div className="h-7 w-32 rounded-lg bg-neutral-100 animate-pulse" />
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="overflow-hidden rounded-2xl bg-white nice-shadow">
                <div className="aspect-video bg-neutral-100 animate-pulse" />
                <div className="flex flex-col gap-2 p-4">
                  <div className="h-3.5 w-3/4 rounded bg-neutral-100 animate-pulse" />
                  <div className="h-3 w-1/2 rounded bg-neutral-100 animate-pulse" />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {scope !== 'course' && (
        <div className="grid grid-cols-1 gap-x-6 gap-y-10 xl:grid-cols-2">
          {Array.from({ length: scope === 'all' ? 2 : 1 }).map((_, i) => (
            <div key={i} className="flex flex-col gap-3">
              <div className="h-7 w-28 rounded-lg bg-neutral-100 animate-pulse" />
              <div className="rounded-2xl bg-white p-2 nice-shadow">
                <SkeletonRows count={scope === 'all' ? 4 : 6} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function BrowseLinks({ pages, orgslug }: { pages: ReturnType<typeof useSitePages>; orgslug: string }) {
  const { t } = useTranslation()
  if (pages.length === 0) return null
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {pages.map((page) => {
        const Icon = page.icon
        return (
          <Link
            key={page.id}
            data-kbd-item=""
            href={getUriWithOrg(orgslug, page.href)}
            className="group flex items-center gap-3 rounded-2xl bg-white p-3.5 nice-shadow transition-shadow hover:ring-1 hover:ring-neutral-200"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-neutral-100 text-neutral-600">
              <Icon size={18} weight="fill" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-neutral-900">{t(page.titleKey)}</span>
              {page.descriptionKey && (
                <span className="block truncate text-xs text-neutral-500">{t(page.descriptionKey)}</span>
              )}
            </span>
            <CaretRight size={14} className="shrink-0 text-neutral-300 group-hover:text-neutral-500 rtl:rotate-180" />
          </Link>
        )
      })}
    </div>
  )
}

function StartState({
  recent,
  onPick,
  onRemove,
  onClear,
  pages,
  orgslug,
}: {
  recent: string[]
  onPick: (_q: string) => void
  onRemove: (_q: string) => void
  onClear: () => void
  pages: ReturnType<typeof useSitePages>
  orgslug: string
}) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col gap-10 pt-2">
      {recent.length > 0 && (
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-neutral-900">
              <ClockCounterClockwise size={16} className="text-neutral-400" />
              {t('search.v2.recent')}
            </h2>
            <Button variant="ghost" size="sm" onClick={onClear}>
              {t('search.v2.clear_recent')}
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            {recent.map((q) => (
              <span
                key={q}
                className="inline-flex h-8 items-center rounded-xl bg-white text-[13px] text-neutral-700 shadow-[0_1px_1px_rgba(0,0,0,0.03),0_0_0_1px_rgba(0,0,0,0.07)]"
              >
                <button type="button" onClick={() => onPick(q)} className="h-full ps-3 pe-1.5 hover:text-neutral-900" dir="auto">
                  {q}
                </button>
                <button
                  type="button"
                  onClick={() => onRemove(q)}
                  aria-label={t('search.v2.remove_recent', { query: q })}
                  className="me-1 flex h-6 w-6 items-center justify-center rounded-lg text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
                >
                  <X size={11} weight="bold" />
                </button>
              </span>
            ))}
          </div>
        </section>
      )}
      {pages.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-neutral-900">{t('search.v2.browse')}</h2>
          <BrowseLinks pages={pages} orgslug={orgslug} />
        </section>
      )}
      {recent.length === 0 && pages.length === 0 && (
        <EmptyState icon={<MagnifyingGlass size={22} />} title={t('search.start_heading')} />
      )}
    </div>
  )
}

function NoResults({
  query,
  scoped,
  anyResults,
  onSearchAll,
  pages,
  orgslug,
}: {
  query: string
  scoped: boolean
  anyResults: boolean
  onSearchAll: () => void
  pages: ReturnType<typeof useSitePages>
  orgslug: string
}) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col gap-8">
      <div className="rounded-2xl bg-white nice-shadow">
        <EmptyState
          icon={<MagnifyingGlass size={22} />}
          title={t('search.palette.no_results', { query })}
          description={t('search.v2.no_results_tip')}
          action={
            scoped && anyResults ? (
              <Button variant="secondary" onClick={onSearchAll}>
                {t('search.v2.search_all_types')}
              </Button>
            ) : undefined
          }
        />
      </div>
      {pages.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-neutral-900">{t('search.v2.browse_instead')}</h2>
          <BrowseLinks pages={pages} orgslug={orgslug} />
        </section>
      )}
    </div>
  )
}

export default SearchPage
