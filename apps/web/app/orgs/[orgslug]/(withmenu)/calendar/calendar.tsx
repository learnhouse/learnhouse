'use client'
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import {
  Award,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Flag,
  Headphones,
  Hourglass,
  LayoutGrid,
  List,
  LockOpen,
  LogIn,
  Megaphone,
  RotateCw,
  Video,
} from 'lucide-react'
import GeneralWrapperStyled from '@components/Objects/StyledElements/Wrappers/GeneralWrapper'
import TypeOfContentTitle from '@components/Objects/StyledElements/Titles/TypeOfContentTitle'
import ListShortcuts from '@components/Objects/Shortcuts/ListShortcuts'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { getUriWithOrg } from '@services/config/config'
import { getCalendarEvents, type CalendarEvent } from '@services/calendar/calendar'
import { queryKeys } from '@/lib/query/keys'
import { intlLocale } from '@/lib/format'

type View = 'month' | 'agenda'

const VIEW_STORAGE_KEY = 'lh_calendar_view'
const PILL = 'inline-flex shrink-0 items-center gap-1 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide rounded-full'

// ---------------------------------------------------------------------------
// Date helpers. Everything works on local calendar days in the viewer's zone.
// ---------------------------------------------------------------------------

const pad = (n: number) => String(n).padStart(2, '0')
const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const startOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1)
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
const addMonths = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth() + n, 1)

/** A bare `YYYY-MM-DD` is a calendar date, never an instant: build it locally. */
function eventStart(ev: CalendarEvent): Date {
  if (ev.all_day) {
    const [y, m, d] = ev.starts_at.slice(0, 10).split('-').map(Number)
    return new Date(y, m - 1, d)
  }
  return new Date(ev.starts_at)
}

const eventDayKey = (ev: CalendarEvent) => (ev.all_day ? ev.starts_at.slice(0, 10) : dayKey(new Date(ev.starts_at)))

/** First day of the week for a locale, as a JS weekday (0 = Sunday). */
function firstDayOfWeek(locale: string): number {
  try {
    const loc = new Intl.Locale(locale) as any
    const info = typeof loc.getWeekInfo === 'function' ? loc.getWeekInfo() : loc.weekInfo
    if (info?.firstDay) return info.firstDay % 7
  } catch {
    /* older engines: fall through */
  }
  const [lang, region] = locale.split('-u-')[0].split('-')
  if (['ar', 'fa'].includes(lang)) return 6
  if (lang === 'en' && (!region || ['US', 'CA', 'PH'].includes(region))) return 0
  if (['he', 'ja', 'ko', 'zh', 'hi'].includes(lang) || region === 'BR' || region === 'US') return 0
  return 1
}

function viewerTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

// ---------------------------------------------------------------------------
// Event styling
// ---------------------------------------------------------------------------

const TYPE_STYLE: Record<string, { dot: string; icon: string; Icon: typeof Video }> = {
  assignment: { dot: 'bg-sky-500', icon: 'text-sky-600', Icon: ClipboardList },
  live_session: { dot: 'bg-red-500', icon: 'text-red-600', Icon: Video },
  chapter_release: { dot: 'bg-emerald-500', icon: 'text-emerald-600', Icon: LockOpen },
  chapter_close: { dot: 'bg-amber-500', icon: 'text-amber-600', Icon: Hourglass },
  course_start: { dot: 'bg-neutral-900', icon: 'text-neutral-800', Icon: Flag },
  course_update: { dot: 'bg-orange-400', icon: 'text-orange-500', Icon: Megaphone },
  certificate: { dot: 'bg-yellow-400', icon: 'text-yellow-600', Icon: Award },
  podcast_episode: { dot: 'bg-pink-500', icon: 'text-pink-600', Icon: Headphones },
}
// Legend order; only types present in the loaded range are listed.
const TYPE_ORDER = Object.keys(TYPE_STYLE)
const OTHER_STYLE = { dot: 'bg-gray-400', icon: 'text-gray-500', Icon: CalendarDays }
const typeStyle = (type: string) => TYPE_STYLE[type] || OTHER_STYLE

const STATUS_STYLE: Record<string, string> = {
  open: 'bg-gray-100 text-gray-600',
  overdue: 'bg-red-100 text-red-700',
  submitted: 'bg-sky-100 text-sky-700',
  graded: 'bg-green-100 text-green-700',
  late: 'bg-yellow-100 text-yellow-700',
  draft: 'bg-gray-100 text-gray-400',
  closed: 'bg-gray-100 text-gray-500',
  scheduled: 'bg-green-100 text-green-700',
  live: 'bg-red-100 text-red-700',
  ended: 'bg-gray-100 text-gray-500',
  upcoming: 'bg-gray-100 text-gray-600',
  unlocked: 'bg-emerald-100 text-emerald-700',
  closing: 'bg-amber-100 text-amber-700',
  started: 'bg-green-100 text-green-700',
  earned: 'bg-yellow-100 text-yellow-800',
}

/** Chapter and course events name what happens, not just the thing. */
function useEventTitle() {
  const { t } = useTranslation()
  return useCallback(
    (ev: CalendarEvent) => {
      switch (ev.type) {
        case 'chapter_release':
          return t('calendar.titles.chapter_release', { name: ev.title })
        case 'chapter_close':
          return t('calendar.titles.chapter_close', { name: ev.title })
        case 'course_start':
          return t('calendar.titles.course_start', { name: ev.title })
        case 'certificate':
          return t('calendar.titles.certificate', { name: ev.title })
        default:
          return ev.title
      }
    },
    [t]
  )
}

function StatusPill({ status }: { status: string | null }) {
  const { t } = useTranslation()
  if (!status || !STATUS_STYLE[status]) return null
  return (
    <span className={`${PILL} ${STATUS_STYLE[status]}`}>
      {status === 'live' && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />}
      {t(`calendar.status.${status}`)}
    </span>
  )
}

function useFormatters(lng: string) {
  return useMemo(() => {
    const locale = intlLocale(lng)
    return {
      locale,
      month: new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }),
      time: new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' }),
      weekdayShort: new Intl.DateTimeFormat(locale, { weekday: 'short' }),
      weekdayNarrow: new Intl.DateTimeFormat(locale, { weekday: 'narrow' }),
      dayNumber: new Intl.DateTimeFormat(locale, { day: 'numeric' }),
      longDay: new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long' }),
      fullDate: new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
    }
  }, [lng])
}

type Formatters = ReturnType<typeof useFormatters>

/** "All day", "Due 5:00 PM" or "10:00 – 11:00". */
function useEventTimeLabel(fmt: Formatters) {
  const { t } = useTranslation()
  return useCallback(
    (ev: CalendarEvent) => {
      if (ev.all_day) return t('calendar.all_day')
      const start = fmt.time.format(new Date(ev.starts_at))
      if (ev.type === 'assignment') return t('calendar.due_at', { time: start })
      if (ev.type === 'chapter_release') return t('calendar.opens_at', { time: start })
      if (ev.type === 'chapter_close') return t('calendar.closes_at', { time: start })
      if (ev.ends_at) return `${start} – ${fmt.time.format(new Date(ev.ends_at))}`
      return start
    },
    [fmt, t]
  )
}

function EventLink({
  ev,
  orgslug,
  className,
  children,
}: {
  ev: CalendarEvent
  orgslug: string
  className: string
  children: React.ReactNode
}) {
  if (!ev.url) return <div className={className}>{children}</div>
  return (
    <Link href={getUriWithOrg(orgslug, ev.url)} className={className} data-kbd-item="">
      {children}
    </Link>
  )
}

// ---------------------------------------------------------------------------
// Month grid
// ---------------------------------------------------------------------------

function MonthGrid({
  cursor,
  weekStart,
  byDay,
  todayKey,
  selected,
  onSelect,
  orgslug,
  fmt,
  loading,
}: {
  cursor: Date
  weekStart: number
  byDay: Map<string, CalendarEvent[]>
  todayKey: string
  selected: string | null
  onSelect: (_key: string) => void
  orgslug: string
  fmt: Formatters
  loading: boolean
}) {
  const { t } = useTranslation()
  const timeLabel = useEventTimeLabel(fmt)
  const eventTitle = useEventTitle()
  const monthStart = startOfMonth(cursor)
  const lead = (monthStart.getDay() - weekStart + 7) % 7
  const gridStart = addDays(monthStart, -lead)
  const daysInMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate()
  const weeks = Math.ceil((lead + daysInMonth) / 7)
  const days = Array.from({ length: weeks * 7 }, (_, i) => addDays(gridStart, i))
  const MAX_CHIPS = 3

  return (
    <div className={`overflow-hidden rounded-xl bg-white nice-shadow transition-opacity ${loading ? 'opacity-60' : ''}`}>
      <div className="grid grid-cols-7 border-b border-gray-100 bg-gray-50/60" aria-hidden="true">
        {days.slice(0, 7).map((d) => (
          <div key={d.getDay()} className="py-2 text-center text-[10px] font-bold uppercase tracking-widest text-gray-400">
            <span className="sm:hidden">{fmt.weekdayNarrow.format(d)}</span>
            <span className="hidden sm:inline">{fmt.weekdayShort.format(d)}</span>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((d, i) => {
          const key = dayKey(d)
          const inMonth = d.getMonth() === cursor.getMonth()
          const isToday = key === todayKey
          const isSelected = key === selected
          const events = byDay.get(key) || []
          const lastCol = i % 7 === 6
          const lastRow = i >= days.length - 7
          return (
            <div
              key={key}
              onClick={() => onSelect(key)}
              className={[
                'group relative flex min-h-[64px] cursor-pointer flex-col gap-1 p-1 transition-colors sm:p-1.5 md:min-h-[116px]',
                lastCol ? '' : 'border-e border-gray-100',
                lastRow ? '' : 'border-b border-gray-100',
                inMonth ? 'bg-white hover:bg-gray-50/80' : 'bg-gray-50/50 hover:bg-gray-50',
                isSelected ? 'ring-2 ring-inset ring-gray-900/80' : '',
              ].join(' ')}
            >
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onSelect(key)
                }}
                aria-label={fmt.fullDate.format(d)}
                aria-current={isToday ? 'date' : undefined}
                aria-pressed={isSelected}
                className={[
                  'flex h-6 w-6 items-center justify-center self-start rounded-full text-xs font-semibold tabular-nums',
                  isToday ? 'bg-gray-900 text-white' : inMonth ? 'text-gray-700' : 'text-gray-300',
                ].join(' ')}
              >
                {fmt.dayNumber.format(d)}
              </button>

              {/* Phone: one dot per event, the day panel below has the details. */}
              {events.length > 0 && (
                <div className="flex flex-wrap gap-0.5 px-0.5 md:hidden" aria-hidden="true">
                  {events.slice(0, 4).map((ev) => (
                    <span key={ev.id} className={`h-1.5 w-1.5 rounded-full ${typeStyle(ev.type).dot}`} />
                  ))}
                </div>
              )}

              <div className="hidden min-w-0 flex-col gap-0.5 md:flex">
                {events.slice(0, MAX_CHIPS).map((ev) => (
                  <EventLink
                    key={ev.id}
                    ev={ev}
                    orgslug={orgslug}
                    className={`flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[11px] leading-tight transition-colors hover:bg-gray-100 ${
                      inMonth ? 'text-gray-700' : 'text-gray-400'
                    }`}
                  >
                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${typeStyle(ev.type).dot}`} />
                    {!ev.all_day && (
                      <span className="hidden shrink-0 tabular-nums text-gray-400 xl:inline">{fmt.time.format(new Date(ev.starts_at))}</span>
                    )}
                    <span className="truncate font-medium" dir="auto" title={`${eventTitle(ev)} · ${timeLabel(ev)}`}>
                      {eventTitle(ev)}
                    </span>
                  </EventLink>
                ))}
                {events.length > MAX_CHIPS && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      onSelect(key)
                    }}
                    className="self-start rounded-md px-1.5 text-[10px] font-bold uppercase tracking-wide text-gray-400 hover:text-gray-900"
                  >
                    {t('calendar.more_events', { count: events.length - MAX_CHIPS })}
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Event rows (day panel and agenda)
// ---------------------------------------------------------------------------

function EventRow({ ev, orgslug, fmt }: { ev: CalendarEvent; orgslug: string; fmt: Formatters }) {
  const timeLabel = useEventTimeLabel(fmt)
  const eventTitle = useEventTitle()
  const style = typeStyle(ev.type)
  const Icon = style.Icon
  const context = ev.course?.name || (ev.meta?.podcast as string | undefined)
  return (
    <EventLink
      ev={ev}
      orgslug={orgslug}
      className="group flex items-center gap-3 rounded-xl bg-white p-3 nice-shadow transition-colors hover:bg-gray-50"
    >
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gray-50">
        <Icon className={`h-4 w-4 ${style.icon}`} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 text-sm font-bold leading-tight text-gray-900 sm:line-clamp-1" dir="auto">
          {eventTitle(ev)}
        </p>
        <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11px] text-gray-500">
          <span className="shrink-0 tabular-nums">{timeLabel(ev)}</span>
          {context && (
            <>
              <span className="text-gray-300">·</span>
              <span className="truncate" dir="auto">
                {context}
              </span>
            </>
          )}
        </p>
      </div>
      <StatusPill status={ev.status} />
    </EventLink>
  )
}

function DayPanel({
  dateKey,
  events,
  todayKey,
  orgslug,
  fmt,
}: {
  dateKey: string
  events: CalendarEvent[]
  todayKey: string
  orgslug: string
  fmt: Formatters
}) {
  const { t } = useTranslation()
  const [y, m, d] = dateKey.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  return (
    <section className="space-y-3">
      <h2 className="flex items-center gap-2 text-lg font-bold text-gray-900">
        <span className="inline-block first-letter:uppercase">{fmt.longDay.format(date)}</span>
        {dateKey === todayKey && <span className={`${PILL} bg-gray-900 text-white`}>{t('calendar.today')}</span>}
        {events.length > 0 && <span className="text-sm font-medium text-gray-400">{events.length}</span>}
      </h2>
      {events.length ? (
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-3">
          {events.map((ev) => (
            <EventRow key={ev.id} ev={ev} orgslug={orgslug} fmt={fmt} />
          ))}
        </div>
      ) : (
        <p className="text-sm text-gray-400">{t('calendar.nothing_this_day')}</p>
      )}
    </section>
  )
}

function Agenda({
  cursor,
  byDay,
  todayKey,
  orgslug,
  fmt,
}: {
  cursor: Date
  byDay: Map<string, CalendarEvent[]>
  todayKey: string
  orgslug: string
  fmt: Formatters
}) {
  const { t } = useTranslation()
  const days = useMemo(() => {
    const out: { date: Date; key: string; events: CalendarEvent[] }[] = []
    const count = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate()
    for (let i = 0; i < count; i++) {
      const date = new Date(cursor.getFullYear(), cursor.getMonth(), i + 1)
      const key = dayKey(date)
      const events = byDay.get(key)
      if (events?.length) out.push({ date, key, events })
    }
    return out
  }, [cursor, byDay])

  if (!days.length) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-gray-100 bg-gray-50/30 px-4 py-12">
        <div className="mb-4 rounded-full bg-white p-4 nice-shadow">
          <CalendarDays className="h-8 w-8 text-gray-300" strokeWidth={1.5} />
        </div>
        <h2 className="mb-2 text-center text-xl font-bold text-gray-600">{t('calendar.empty_month_title')}</h2>
        <p className="max-w-xs text-center text-gray-400">{t('calendar.empty_month_body')}</p>
      </div>
    )
  }

  return (
    <ol className="space-y-5">
      {days.map(({ date, key, events }) => {
        const isToday = key === todayKey
        const past = key < todayKey
        return (
          <li key={key} className="flex gap-3 sm:gap-5">
            <div className="flex w-12 shrink-0 flex-col items-center pt-1 sm:w-14">
              <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">
                {fmt.weekdayShort.format(date)}
              </span>
              <span
                className={[
                  'mt-0.5 flex h-9 w-9 items-center justify-center rounded-full text-lg font-bold tabular-nums',
                  isToday ? 'bg-gray-900 text-white' : past ? 'text-gray-400' : 'text-gray-900',
                ].join(' ')}
              >
                {fmt.dayNumber.format(date)}
              </span>
            </div>
            <div className={`min-w-0 flex-1 space-y-2 ${past ? 'opacity-70' : ''}`}>
              {events.map((ev) => (
                <EventRow key={ev.id} ev={ev} orgslug={orgslug} fmt={fmt} />
              ))}
            </div>
          </li>
        )
      })}
    </ol>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function CalendarClient({ orgslug, orgId }: { orgslug: string; orgId: number }) {
  const { t, i18n } = useTranslation()
  const lh = useLHSession() as any
  const token = lh?.data?.tokens?.access_token
  const isAuthenticated = lh?.status === 'authenticated'
  const fmt = useFormatters(i18n.language)
  const weekStart = useMemo(() => firstDayOfWeek(fmt.locale), [fmt.locale])

  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    // Keep "today" right for a tab left open past midnight.
    const id = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(id)
  }, [])
  const todayKey = dayKey(now)

  const [cursor, setCursor] = useState(() => startOfMonth(new Date()))
  const [selected, setSelected] = useState<string | null>(() => dayKey(new Date()))
  const [view, setView] = useState<View>('month')
  useEffect(() => {
    try {
      const stored = localStorage.getItem(VIEW_STORAGE_KEY)
      // Read after hydration so the server render and the first client render agree.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (stored === 'month' || stored === 'agenda') setView(stored)
    } catch {
      /* storage unavailable */
    }
  }, [])
  const changeView = (next: View) => {
    setView(next)
    try {
      localStorage.setItem(VIEW_STORAGE_KEY, next)
    } catch {
      /* storage unavailable */
    }
  }

  const goTo = useCallback(
    (month: Date) => {
      setCursor(month)
      const today = new Date()
      setSelected(
        month.getFullYear() === today.getFullYear() && month.getMonth() === today.getMonth()
          ? dayKey(today)
          : dayKey(month)
      )
    },
    []
  )

  // One window covers the visible grid (and so the whole month for the
  // agenda). Padded by a day on each side: all-day events are matched against
  // UTC days on the server, which can sit a few hours off the local ones.
  const range = useMemo(() => {
    const monthStart = startOfMonth(cursor)
    const lead = (monthStart.getDay() - weekStart + 7) % 7
    const start = addDays(monthStart, -lead - 1)
    const end = addDays(monthStart, -lead + 43)
    return { start, end }
  }, [cursor, weekStart])

  const query = useQuery({
    queryKey: queryKeys.calendar.events(orgId, range.start.toISOString(), range.end.toISOString()),
    queryFn: () => getCalendarEvents(orgId, range.start, range.end, token),
    enabled: !!orgId && isAuthenticated && !!token,
    staleTime: 30_000,
    refetchInterval: 60_000,
    placeholderData: (prev) => prev,
  })

  const legendTypes = useMemo(() => {
    const present = new Set((query.data || []).map((ev) => ev.type))
    return TYPE_ORDER.filter((type) => present.has(type))
  }, [query.data])

  const byDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>()
    for (const ev of query.data || []) {
      const key = eventDayKey(ev)
      const list = map.get(key) || []
      list.push(ev)
      map.set(key, list)
    }
    for (const list of map.values()) {
      list.sort((a, b) => {
        if (a.all_day !== b.all_day) return a.all_day ? -1 : 1
        return eventStart(a).getTime() - eventStart(b).getTime()
      })
    }
    return map
  }, [query.data])

  if (lh?.status !== 'loading' && !isAuthenticated) {
    return (
      <div className="w-full">
        <GeneralWrapperStyled>
          <TypeOfContentTitle title={t('calendar.title')} type="cal" />
          <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-gray-100 bg-gray-50/30 px-4 py-12">
            <div className="mb-4 rounded-full bg-white p-4 nice-shadow">
              <LogIn className="h-8 w-8 text-gray-300" strokeWidth={1.5} />
            </div>
            <h1 className="mb-2 text-center text-xl font-bold text-gray-600">{t('calendar.sign_in_title')}</h1>
            <p className="max-w-xs text-center text-gray-400">{t('calendar.sign_in_body')}</p>
          </div>
        </GeneralWrapperStyled>
      </div>
    )
  }

  const isCurrentMonth = cursor.getFullYear() === now.getFullYear() && cursor.getMonth() === now.getMonth()
  const toggleBtn = (active: boolean) =>
    `flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-bold transition-colors ${
      active ? 'bg-gray-900 text-white' : 'text-gray-500 hover:text-gray-900'
    }`
  const navBtn =
    'flex h-8 w-8 items-center justify-center rounded-lg bg-white text-gray-600 nice-shadow transition-colors hover:bg-gray-50 hover:text-gray-900'

  return (
    <div className="w-full">
      <GeneralWrapperStyled>
        <ListShortcuts
          onNextPage={() => goTo(addMonths(cursor, 1))}
          onPrevPage={() => goTo(addMonths(cursor, -1))}
          hasNextPage
          hasPrevPage
        />
        <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
          <TypeOfContentTitle title={t('calendar.title')} type="cal" />
          <div role="group" aria-label={t('calendar.view_label')} className="flex items-center gap-1 self-start rounded-lg bg-white p-1 nice-shadow sm:self-auto">
            <button type="button" aria-pressed={view === 'month'} onClick={() => changeView('month')} className={toggleBtn(view === 'month')}>
              <LayoutGrid className="h-3.5 w-3.5" />
              {t('calendar.views.month')}
            </button>
            <button type="button" aria-pressed={view === 'agenda'} onClick={() => changeView('agenda')} className={toggleBtn(view === 'agenda')}>
              <List className="h-3.5 w-3.5" />
              {t('calendar.views.agenda')}
            </button>
          </div>
        </div>

        <div className="mb-4 mt-2 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => goTo(addMonths(cursor, -1))} className={navBtn} aria-label={t('calendar.previous_month')}>
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button type="button" onClick={() => goTo(addMonths(cursor, 1))} className={navBtn} aria-label={t('calendar.next_month')}>
              <ChevronRight className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => goTo(startOfMonth(new Date()))}
              disabled={isCurrentMonth}
              className="h-8 rounded-lg bg-white px-3 text-xs font-bold text-gray-700 nice-shadow transition-colors hover:bg-gray-50 disabled:cursor-default disabled:text-gray-300 disabled:hover:bg-white"
            >
              {t('calendar.today')}
            </button>
            <h2 className="ms-1 text-lg font-bold tracking-tight text-gray-900 first-letter:uppercase" aria-live="polite">
              {fmt.month.format(cursor)}
            </h2>
            {query.isFetching && <RotateCw className="h-3.5 w-3.5 animate-spin text-gray-300" aria-hidden="true" />}
          </div>
          <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] font-medium text-gray-500" aria-label={t('calendar.legend')}>
            {legendTypes.map((type) => (
              <li key={type} className="flex items-center gap-1.5">
                <span className={`h-2 w-2 rounded-full ${TYPE_STYLE[type].dot}`} />
                {t(`calendar.types.${type}`)}
              </li>
            ))}
          </ul>
        </div>

        {query.isError && (
          <div className="mb-4 flex items-center justify-between gap-3 rounded-lg bg-red-50 px-4 py-2.5 text-sm text-red-700">
            <span>{t('calendar.load_error')}</span>
            <button type="button" onClick={() => query.refetch()} className="text-xs font-bold uppercase tracking-wide hover:text-red-900">
              {t('calendar.retry')}
            </button>
          </div>
        )}

        {view === 'month' ? (
          <div className="space-y-8">
            <MonthGrid
              cursor={cursor}
              weekStart={weekStart}
              byDay={byDay}
              todayKey={todayKey}
              selected={selected}
              onSelect={setSelected}
              orgslug={orgslug}
              fmt={fmt}
              loading={query.isLoading}
            />
            {selected && (
              <DayPanel dateKey={selected} events={byDay.get(selected) || []} todayKey={todayKey} orgslug={orgslug} fmt={fmt} />
            )}
          </div>
        ) : query.isLoading ? (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-16 animate-pulse rounded-xl bg-white nice-shadow" />
            ))}
          </div>
        ) : (
          <Agenda cursor={cursor} byDay={byDay} todayKey={todayKey} orgslug={orgslug} fmt={fmt} />
        )}

        <p className="mt-6 text-[11px] text-gray-400">{t('calendar.timezone_note', { timezone: viewerTimezone() })}</p>
      </GeneralWrapperStyled>
    </div>
  )
}
