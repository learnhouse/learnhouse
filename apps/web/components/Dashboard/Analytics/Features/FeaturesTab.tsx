'use client'
import React, { useMemo, useState } from 'react'
import {
  BookOpen,
  Exam,
  UsersThree,
  Sparkle,
  Microphone,
  Kanban,
  Code,
  Path,
  MagnifyingGlass,
  ChatCircleDots,
  Books,
  Certificate,
  PlayCircle,
  Hammer,
  EnvelopeSimple,
  SignIn,
  type Icon,
} from '@phosphor-icons/react'
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts'
import { useTranslation } from 'react-i18next'
import { useAnalyticsPipe } from '../useAnalyticsDashboard'
import { fillDays, percentChange } from '../analyticsFormat'
import TrendPill from '../TrendPill'

const FEATURES: Record<string, { icon: Icon; color: string; bg: string }> = {
  learning: { icon: BookOpen, color: '#6b8de3', bg: 'bg-blue-50 text-blue-500' },
  assessments: { icon: Exam, color: '#f59e0b', bg: 'bg-amber-50 text-amber-500' },
  community: { icon: UsersThree, color: '#10b981', bg: 'bg-emerald-50 text-emerald-500' },
  ai: { icon: Sparkle, color: '#a78bfa', bg: 'bg-violet-50 text-violet-500' },
  podcasts: { icon: Microphone, color: '#ec4899', bg: 'bg-pink-50 text-pink-500' },
  boards: { icon: Kanban, color: '#14b8a6', bg: 'bg-teal-50 text-teal-500' },
  playgrounds: { icon: Code, color: '#64748b', bg: 'bg-slate-100 text-slate-500' },
  paths: { icon: Path, color: '#8b5cf6', bg: 'bg-purple-50 text-purple-500' },
  search: { icon: MagnifyingGlass, color: '#0ea5e9', bg: 'bg-sky-50 text-sky-500' },
  messaging: { icon: ChatCircleDots, color: '#22c55e', bg: 'bg-green-50 text-green-500' },
  library: { icon: Books, color: '#f97316', bg: 'bg-orange-50 text-orange-500' },
  certificates: { icon: Certificate, color: '#eab308', bg: 'bg-yellow-50 text-yellow-600' },
}

const TOOLTIP_STYLE = { borderRadius: 12, border: '1px solid #f3f4f6', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)', fontSize: 12 }
const shortDate = (v: string) => new Date(v).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
const num = (v: unknown) => Number(v ?? 0)
const humanize = (v: unknown) => {
  const text = String(v || '—').replace(/_/g, ' ')
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function Card({
  icon: IconCmp,
  iconClass,
  title,
  subtitle,
  loading,
  empty,
  children,
  className = '',
}: {
  icon: Icon
  iconClass: string
  title: string
  subtitle?: string
  loading?: boolean
  empty?: boolean
  children: React.ReactNode
  className?: string
}) {
  const { t } = useTranslation()
  return (
    <div className={`bg-white rounded-xl nice-shadow p-5 min-h-[280px] overflow-hidden min-w-0 ${className}`}>
      <div className="flex items-start gap-3 mb-4">
        <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${iconClass}`}>
          <IconCmp size={16} weight="duotone" />
        </div>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-gray-700">{title}</h3>
          {subtitle && <p className="text-xs text-gray-400">{subtitle}</p>}
        </div>
      </div>
      {loading ? (
        <div className="h-44 flex items-center justify-center text-gray-300 text-sm">{t('analytics.common.loading')}</div>
      ) : empty ? (
        <div className="h-44 flex items-center justify-center text-gray-300 text-sm">{t('analytics.common.no_data')}</div>
      ) : (
        children
      )}
    </div>
  )
}

/** Horizontal share bar used by the list widgets. */
function ShareBar({ label, value, max, color, suffix }: { label: string; value: number; max: number; color: string; suffix?: React.ReactNode }) {
  const pct = max > 0 ? Math.max((value / max) * 100, value > 0 ? 3 : 0) : 0
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-6 bg-gray-50 rounded-md overflow-hidden relative">
        <div className="h-full rounded-md" style={{ width: `${pct}%`, background: color, opacity: 0.25 }} />
        <span className="absolute inset-0 flex items-center px-2 text-[11px] text-gray-700 font-medium truncate">{label}</span>
      </div>
      <span className="text-[11px] text-gray-500 tabular-nums w-12 text-right">{value.toLocaleString()}</span>
      {suffix}
    </div>
  )
}

function FeatureAdoption({ days }: { days: string }) {
  const { t } = useTranslation()
  const { data, isLoading } = useAnalyticsPipe('feature_summary', { days })
  const { data: daily } = useAnalyticsPipe('feature_usage_daily', { days })
  const rows: any[] = useMemo(
    () => [...(data?.data ?? [])].sort((a, b) => num(b.actors) - num(a.actors)),
    [data],
  )
  const [selected, setSelected] = useState<string | null>(null)
  const shown = useMemo(
    () => (selected ? [selected] : rows.slice(0, 5).map((r) => String(r.feature))),
    [selected, rows],
  )

  const chartRows = useMemo(() => {
    const dailyRows: any[] = daily?.data ?? []
    return fillDays(
      Number(days),
      Object.fromEntries(
        shown.map((feature) => [feature, { rows: dailyRows.filter((r) => r.feature === feature), key: 'actors' }]),
      ),
    )
  }, [daily, days, shown])

  return (
    <div className="bg-white rounded-xl nice-shadow overflow-hidden">
      <div className="px-5 pt-5">
        <h3 className="text-sm font-semibold text-gray-700">{t('analytics.features.adoption_title')}</h3>
        <p className="text-xs text-gray-400">{t('analytics.features.adoption_subtitle')}</p>
      </div>
      {isLoading ? (
        <div className="h-40 flex items-center justify-center text-gray-300 text-sm">{t('analytics.common.loading')}</div>
      ) : rows.length === 0 ? (
        <div className="h-40 flex items-center justify-center text-gray-300 text-sm">{t('analytics.common.no_data')}</div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 p-5">
            {rows.map((row) => {
              const meta = FEATURES[row.feature] ?? FEATURES.learning
              const IconCmp = meta.icon
              const active = selected === row.feature
              return (
                <button
                  key={row.feature}
                  onClick={() => setSelected(active ? null : row.feature)}
                  className={`text-left rounded-xl border px-3 py-2.5 transition-colors ${
                    active ? 'border-gray-300 bg-gray-50' : 'border-gray-100 hover:bg-gray-50'
                  }`}
                >
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className={`flex h-5 w-5 items-center justify-center rounded-md ${meta.bg}`}>
                      <IconCmp size={12} weight="duotone" />
                    </span>
                    <span className="text-[11px] font-medium text-gray-500 truncate">
                      {t(`analytics.features.names.${row.feature}`, { defaultValue: row.feature })}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-xl font-bold text-gray-900 tabular-nums">{num(row.actors).toLocaleString()}</span>
                    <TrendPill change={percentChange(num(row.actors), num(row.prev_actors))} />
                  </div>
                  <p className="text-[10px] text-gray-300">
                    {t('analytics.features.events_count', { value: num(row.events).toLocaleString() })}
                  </p>
                </button>
              )
            })}
          </div>
          <div className="border-t border-gray-100 px-5 pt-4 pb-2">
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={chartRows}>
                <defs>
                  {shown.map((feature) => (
                    <linearGradient key={feature} id={`feat-${feature}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={(FEATURES[feature] ?? FEATURES.learning).color} stopOpacity={0.25} />
                      <stop offset="100%" stopColor={(FEATURES[feature] ?? FEATURES.learning).color} stopOpacity={0.02} />
                    </linearGradient>
                  ))}
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="#9ca3af" tickFormatter={shortDate} axisLine={false} tickLine={false} minTickGap={24} />
                <YAxis tick={{ fontSize: 11 }} stroke="#9ca3af" axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip
                  contentStyle={TOOLTIP_STYLE}
                  labelFormatter={(v) => shortDate(String(v))}
                  formatter={(value, name) => [Number(value).toLocaleString(), t(`analytics.features.names.${name}`, { defaultValue: String(name) })]}
                />
                {shown.map((feature) => (
                  <Area
                    key={feature}
                    type="monotone"
                    dataKey={feature}
                    stroke={(FEATURES[feature] ?? FEATURES.learning).color}
                    strokeWidth={2}
                    fill={`url(#feat-${feature})`}
                    dot={false}
                  />
                ))}
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </div>
  )
}

const MILESTONES = ['reached_25', 'reached_50', 'reached_75', 'reached_100'] as const

function VideoEngagement({ days }: { days: string }) {
  const { t } = useTranslation()
  const { data, isLoading } = useAnalyticsPipe('video_engagement', { days })
  const rows: any[] = data?.data ?? []
  return (
    <Card icon={PlayCircle} iconClass="bg-blue-50 text-blue-500" title={t('analytics.features.video_title')} subtitle={t('analytics.features.video_subtitle')} loading={isLoading} empty={rows.length === 0}>
      <div className="space-y-3 max-h-[260px] overflow-y-auto pe-1">
        {rows.slice(0, 8).map((row, i) => {
          const start = num(row.reached_25)
          return (
            <div key={i}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-medium text-gray-700 truncate">{row.activity_name || row.activity_uuid}</span>
                <span className="text-[11px] text-gray-400 tabular-nums">
                  {start > 0 ? `${Math.round((num(row.reached_100) / start) * 100)}%` : '0%'} {t('analytics.features.finished').toLowerCase()}
                </span>
              </div>
              <div className="grid grid-cols-4 gap-1">
                {MILESTONES.map((m, j) => {
                  const share = start > 0 ? num(row[m]) / start : 0
                  return (
                    <div key={m} className="h-2 rounded-full bg-gray-100 overflow-hidden" title={`${(j + 1) * 25}%: ${num(row[m])}`}>
                      <div className="h-full rounded-full bg-blue-400" style={{ width: `${Math.round(share * 100)}%` }} />
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
        <div className="grid grid-cols-4 gap-1 text-[10px] text-gray-300 pt-1">
          <span>25%</span><span>50%</span><span>75%</span><span>100%</span>
        </div>
      </div>
    </Card>
  )
}

function PodcastEngagement({ days }: { days: string }) {
  const { t } = useTranslation()
  const { data, isLoading } = useAnalyticsPipe('podcast_engagement', { days })
  const rows: any[] = data?.data ?? []
  const max = Math.max(0, ...rows.map((r) => num(r.plays)))
  return (
    <Card icon={Microphone} iconClass="bg-pink-50 text-pink-500" title={t('analytics.features.podcast_title')} subtitle={t('analytics.features.podcast_subtitle')} loading={isLoading} empty={rows.length === 0}>
      <div className="space-y-1.5 max-h-[260px] overflow-y-auto">
        {rows.slice(0, 8).map((row, i) => (
          <ShareBar
            key={i}
            label={row.episode_title || row.episode_uuid}
            value={num(row.plays)}
            max={max}
            color="#ec4899"
            suffix={
              <span className="text-[10px] text-gray-400 tabular-nums w-14 text-right" title={t('analytics.features.finished')}>
                {num(row.plays) > 0 ? Math.round((num(row.reached_100) / num(row.plays)) * 100) : 0}% ✓
              </span>
            }
          />
        ))}
      </div>
    </Card>
  )
}

function Assessments({ days }: { days: string }) {
  const { t } = useTranslation()
  const { data, isLoading } = useAnalyticsPipe('assessment_summary', { days })
  const { data: daily } = useAnalyticsPipe('assessment_daily', { days })
  const rows: any[] = data?.data ?? []
  const chart = useMemo(
    () =>
      fillDays(Number(days), {
        submissions: { rows: daily?.data ?? [], key: 'submissions' },
        passed: { rows: daily?.data ?? [], key: 'passed' },
      }),
    [daily, days],
  )
  return (
    <Card icon={Exam} iconClass="bg-amber-50 text-amber-500" title={t('analytics.features.assessments_title')} subtitle={t('analytics.features.assessments_subtitle')} loading={isLoading} empty={rows.length === 0} className="lg:col-span-2">
      <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-6">
        <div className="space-y-2">
          {(['assignment', 'quiz', 'code'] as const).map((kind) => {
            const row = rows.find((r) => r.kind === kind)
            const submissions = num(row?.submissions)
            const graded = num(row?.graded)
            const passRate = graded > 0 ? Math.round((num(row?.passed) / graded) * 100) : null
            return (
              <div key={kind} className="rounded-xl border border-gray-100 px-4 py-3">
                <div className="text-xs font-medium text-gray-500 mb-1.5">{t(`analytics.features.${kind}`)}</div>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <div className="text-lg font-bold text-gray-900 tabular-nums">{submissions.toLocaleString()}</div>
                    <div className="text-[10px] text-gray-400">{t('analytics.features.submissions')}</div>
                  </div>
                  <div>
                    <div className="text-lg font-bold text-gray-900 tabular-nums">{passRate === null ? '—' : `${passRate}%`}</div>
                    <div className="text-[10px] text-gray-400">{t('analytics.features.pass_rate')}</div>
                  </div>
                  <div>
                    <div className="text-lg font-bold text-gray-900 tabular-nums">{row?.avg_score_pct == null ? '—' : `${Math.round(num(row.avg_score_pct))}%`}</div>
                    <div className="text-[10px] text-gray-400">{t('analytics.features.avg_score')}</div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
        <div>
          <ResponsiveContainer width="100%" height={230}>
            <BarChart data={chart} barGap={0}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="#9ca3af" tickFormatter={shortDate} axisLine={false} tickLine={false} minTickGap={24} />
              <YAxis tick={{ fontSize: 11 }} stroke="#9ca3af" axisLine={false} tickLine={false} allowDecimals={false} />
              <Tooltip
                contentStyle={TOOLTIP_STYLE}
                labelFormatter={(v) => shortDate(String(v))}
                formatter={(value, name) => [Number(value).toLocaleString(), t(`analytics.features.${name}`)]}
              />
              <Bar dataKey="submissions" fill="#fcd34d" radius={[3, 3, 0, 0]} />
              <Bar dataKey="passed" fill="#f59e0b" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </Card>
  )
}

const COMMUNITY_SERIES = [
  { key: 'discussions', color: '#10b981' },
  { key: 'comments', color: '#34d399' },
  { key: 'reactions', color: '#6ee7b7' },
  { key: 'upvotes', color: '#a7f3d0' },
]

function Community({ days }: { days: string }) {
  const { t } = useTranslation()
  const { data, isLoading } = useAnalyticsPipe('community_daily', { days })
  const { data: top } = useAnalyticsPipe('top_communities', { days })
  const dailyRows: any[] = useMemo(() => data?.data ?? [], [data])
  const topRows: any[] = top?.data ?? []
  const chart = useMemo(
    () => fillDays(Number(days), Object.fromEntries(COMMUNITY_SERIES.map((s) => [s.key, { rows: dailyRows, key: s.key }]))),
    [dailyRows, days],
  )
  const contributors = Math.max(0, ...dailyRows.map((r) => num(r.contributors)))
  const maxContributors = Math.max(0, ...topRows.map((r) => num(r.contributors)))
  return (
    <Card icon={UsersThree} iconClass="bg-emerald-50 text-emerald-500" title={t('analytics.features.community_title')} subtitle={t('analytics.features.community_subtitle')} loading={isLoading} empty={dailyRows.length === 0 && topRows.length === 0} className="lg:col-span-2">
      <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] gap-6">
        <div>
          <div className="flex flex-wrap gap-3 mb-2">
            {COMMUNITY_SERIES.map((s) => (
              <span key={s.key} className="flex items-center gap-1.5 text-[11px] text-gray-500">
                <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
                {t(`analytics.features.${s.key}`)}
              </span>
            ))}
            <span className="ms-auto text-[11px] text-gray-400">
              {t('analytics.features.peak_contributors', { value: contributors })}
            </span>
          </div>
          <ResponsiveContainer width="100%" height={210}>
            <BarChart data={chart}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="#9ca3af" tickFormatter={shortDate} axisLine={false} tickLine={false} minTickGap={24} />
              <YAxis tick={{ fontSize: 11 }} stroke="#9ca3af" axisLine={false} tickLine={false} allowDecimals={false} />
              <Tooltip contentStyle={TOOLTIP_STYLE} labelFormatter={(v) => shortDate(String(v))} formatter={(value, name) => [Number(value).toLocaleString(), t(`analytics.features.${name}`)]} />
              {COMMUNITY_SERIES.map((s) => (
                <Bar key={s.key} dataKey={s.key} stackId="c" fill={s.color} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div>
          <div className="text-xs font-medium text-gray-500 mb-2">{t('analytics.features.top_communities')}</div>
          <div className="space-y-1.5">
            {topRows.slice(0, 6).map((row, i) => (
              <ShareBar
                key={i}
                label={row.community_name || row.community_uuid}
                value={num(row.contributors)}
                max={maxContributors}
                color="#10b981"
                suffix={<span className="text-[10px] text-gray-400 tabular-nums w-14 text-right">{num(row.views).toLocaleString()} 👁</span>}
              />
            ))}
            {topRows.length === 0 && <div className="text-xs text-gray-300">{t('analytics.common.no_data')}</div>}
          </div>
        </div>
      </div>
    </Card>
  )
}

function AiAssistant({ days }: { days: string }) {
  const { t } = useTranslation()
  const { data, isLoading } = useAnalyticsPipe('ai_daily', { days })
  const { data: surfaces } = useAnalyticsPipe('ai_by_surface', { days })
  const rows: any[] = useMemo(() => data?.data ?? [], [data])
  const surfaceRows: any[] = surfaces?.data ?? []
  const chart = useMemo(
    () => fillDays(Number(days), { messages: { rows, key: 'messages' }, users: { rows, key: 'users' } }),
    [rows, days],
  )
  const totalMessages = rows.reduce((s, r) => s + num(r.messages), 0)
  const maxSurface = Math.max(0, ...surfaceRows.map((r) => num(r.messages)))
  return (
    <Card icon={Sparkle} iconClass="bg-violet-50 text-violet-500" title={t('analytics.features.ai_title')} subtitle={t('analytics.features.ai_subtitle')} loading={isLoading} empty={rows.length === 0}>
      <div className="flex items-baseline gap-2 mb-2">
        <span className="text-2xl font-bold text-gray-900 tabular-nums">{totalMessages.toLocaleString()}</span>
        <span className="text-xs text-gray-400">{t('analytics.features.messages').toLowerCase()}</span>
      </div>
      <ResponsiveContainer width="100%" height={120}>
        <AreaChart data={chart}>
          <defs>
            <linearGradient id="ai-msg" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#a78bfa" stopOpacity={0.3} />
              <stop offset="100%" stopColor="#a78bfa" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <XAxis dataKey="date" hide />
          <YAxis hide allowDecimals={false} />
          <Tooltip contentStyle={TOOLTIP_STYLE} labelFormatter={(v) => shortDate(String(v))} formatter={(value, name) => [Number(value).toLocaleString(), t(`analytics.features.${name}`)]} />
          <Area type="monotone" dataKey="messages" stroke="#a78bfa" strokeWidth={2} fill="url(#ai-msg)" dot={false} />
          <Area type="monotone" dataKey="users" stroke="#7c3aed" strokeWidth={1.5} strokeDasharray="4 3" fill="none" dot={false} />
        </AreaChart>
      </ResponsiveContainer>
      {surfaceRows.length > 0 && (
        <div className="mt-3 space-y-1.5">
          <div className="text-[11px] font-medium text-gray-400">{t('analytics.features.by_surface')}</div>
          {surfaceRows.slice(0, 4).map((row, i) => (
            <ShareBar key={i} label={humanize(row.surface)} value={num(row.messages)} max={maxSurface} color="#a78bfa" />
          ))}
        </div>
      )}
    </Card>
  )
}

const ACQUISITION_KINDS = ['signup', 'join', 'login', 'invite'] as const
const METHOD_COLORS = ['#6b8de3', '#818cf8', '#a78bfa', '#c4b5fd', '#ddd6fe']

function Acquisition({ days }: { days: string }) {
  const { t } = useTranslation()
  const { data, isLoading } = useAnalyticsPipe('acquisition_methods', { days })
  const rows: any[] = data?.data ?? []
  return (
    <Card icon={SignIn} iconClass="bg-indigo-50 text-indigo-500" title={t('analytics.features.acquisition_title')} subtitle={t('analytics.features.acquisition_subtitle')} loading={isLoading} empty={rows.length === 0}>
      <div className="space-y-4">
        {ACQUISITION_KINDS.map((kind) => {
          const kindRows = rows.filter((r) => r.kind === kind).sort((a, b) => num(b.events) - num(a.events))
          const total = kindRows.reduce((s, r) => s + num(r.events), 0)
          if (total === 0) return null
          return (
            <div key={kind}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-medium text-gray-600">{t(`analytics.features.${kind}`)}</span>
                <span className="text-xs font-semibold text-gray-900 tabular-nums">{total.toLocaleString()}</span>
              </div>
              <div className="flex h-2.5 rounded-full overflow-hidden bg-gray-100">
                {kindRows.map((r, i) => (
                  <div key={r.method} title={`${r.method}: ${num(r.events)}`} style={{ width: `${(num(r.events) / total) * 100}%`, background: METHOD_COLORS[i % METHOD_COLORS.length] }} />
                ))}
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
                {kindRows.slice(0, 5).map((r, i) => (
                  <span key={r.method} className="flex items-center gap-1 text-[10px] text-gray-400">
                    <span className="h-1.5 w-1.5 rounded-full" style={{ background: METHOD_COLORS[i % METHOD_COLORS.length] }} />
                    {humanize(r.method)} · {Math.round((num(r.events) / total) * 100)}%
                  </span>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </Card>
  )
}

function Nudges({ days }: { days: string }) {
  const { t } = useTranslation()
  const { data, isLoading } = useAnalyticsPipe('nudge_effectiveness', { days })
  const rows: any[] = data?.data ?? []
  return (
    <Card icon={EnvelopeSimple} iconClass="bg-rose-50 text-rose-500" title={t('analytics.features.nudges_title')} subtitle={t('analytics.features.nudges_subtitle')} loading={isLoading} empty={rows.length === 0}>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-[10px] uppercase tracking-wider text-gray-400 border-b border-gray-100">
            <th className="pb-2 text-left font-medium">{t('analytics.common.type')}</th>
            <th className="pb-2 text-right font-medium">{t('analytics.features.sent')}</th>
            <th className="pb-2 text-right font-medium">{t('analytics.features.returned')}</th>
            <th className="pb-2 text-right font-medium">{t('analytics.features.return_rate')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-gray-50 last:border-0">
              <td className="py-2 text-gray-700">{humanize(row.nudge_type)}</td>
              <td className="py-2 text-right tabular-nums text-gray-500">{num(row.sent).toLocaleString()}</td>
              <td className="py-2 text-right tabular-nums text-gray-500">{num(row.returned).toLocaleString()}</td>
              <td className="py-2 text-right tabular-nums font-semibold text-gray-900">{num(row.return_rate)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  )
}

function ListCard({
  icon,
  iconClass,
  title,
  query,
  days,
  color,
  label,
  value,
  extra,
}: {
  icon: Icon
  iconClass: string
  title: string
  query: string
  days: string
  color: string
  label: (_row: any) => string
  value: (_row: any) => number
  extra?: (_row: any) => React.ReactNode
}) {
  const { data, isLoading } = useAnalyticsPipe(query, { days })
  const rows: any[] = data?.data ?? []
  const max = Math.max(0, ...rows.map(value))
  return (
    <Card icon={icon} iconClass={iconClass} title={title} loading={isLoading} empty={rows.length === 0}>
      <div className="space-y-1.5 max-h-[230px] overflow-y-auto">
        {rows.slice(0, 8).map((row, i) => (
          <ShareBar key={i} label={label(row)} value={value(row)} max={max} color={color} suffix={extra?.(row)} />
        ))}
      </div>
    </Card>
  )
}

const CREATION_SERIES = [
  { key: 'courses_created', color: '#6b8de3' },
  { key: 'courses_published', color: '#22c55e' },
  { key: 'activities_created', color: '#a78bfa' },
  { key: 'boards_created', color: '#14b8a6' },
  { key: 'playgrounds_created', color: '#64748b' },
  { key: 'episodes_published', color: '#ec4899' },
]

function ContentCreation({ days }: { days: string }) {
  const { t } = useTranslation()
  const { data, isLoading } = useAnalyticsPipe('content_creation_daily', { days })
  const rows: any[] = useMemo(() => data?.data ?? [], [data])
  const chart = useMemo(
    () => fillDays(Number(days), Object.fromEntries(CREATION_SERIES.map((s) => [s.key, { rows, key: s.key }]))),
    [rows, days],
  )
  const totals = CREATION_SERIES.map((s) => ({ ...s, total: rows.reduce((sum, r) => sum + num(r[s.key]), 0) }))
  return (
    <Card icon={Hammer} iconClass="bg-sky-50 text-sky-500" title={t('analytics.features.creation_title')} subtitle={t('analytics.features.creation_subtitle')} loading={isLoading} empty={rows.length === 0} className="lg:col-span-3">
      <div className="grid grid-cols-3 md:grid-cols-6 gap-2 mb-3">
        {totals.map((s) => (
          <div key={s.key} className="rounded-lg bg-gray-50 px-3 py-2">
            <div className="flex items-center gap-1.5 text-[10px] text-gray-400">
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: s.color }} />
              {t(`analytics.features.${s.key}`)}
            </div>
            <div className="text-lg font-bold text-gray-900 tabular-nums">{s.total.toLocaleString()}</div>
          </div>
        ))}
      </div>
      <ResponsiveContainer width="100%" height={160}>
        <BarChart data={chart}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
          <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="#9ca3af" tickFormatter={shortDate} axisLine={false} tickLine={false} minTickGap={24} />
          <YAxis tick={{ fontSize: 11 }} stroke="#9ca3af" axisLine={false} tickLine={false} allowDecimals={false} />
          <Tooltip contentStyle={TOOLTIP_STYLE} labelFormatter={(v) => shortDate(String(v))} formatter={(value, name) => [Number(value).toLocaleString(), t(`analytics.features.${name}`)]} />
          {CREATION_SERIES.map((s) => (
            <Bar key={s.key} dataKey={s.key} stackId="cc" fill={s.color} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </Card>
  )
}

/** The "Features" tab: how each part of the platform is used. */
export default function FeaturesTab({ days }: { days: string }) {
  const { t } = useTranslation()
  return (
    <div className="space-y-6 max-w-[1600px] mx-auto w-full">
      <FeatureAdoption days={days} />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <VideoEngagement days={days} />
        <PodcastEngagement days={days} />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Assessments days={days} />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Community days={days} />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <AiAssistant days={days} />
        <Acquisition days={days} />
        <Nudges days={days} />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <ListCard
          icon={Path}
          iconClass="bg-purple-50 text-purple-500"
          title={t('analytics.features.paths_title')}
          query="paths_summary"
          days={days}
          color="#8b5cf6"
          label={(r) => r.path_name || r.path_uuid}
          value={(r) => num(r.enrollments)}
          extra={(r) => (
            <span className="text-[10px] text-gray-400 tabular-nums w-14 text-right" title={t('analytics.common.completions')}>
              {num(r.completions).toLocaleString()} ✓
            </span>
          )}
        />
        <ListCard
          icon={Kanban}
          iconClass="bg-teal-50 text-teal-500"
          title={t('analytics.features.boards_title')}
          query="top_boards_playgrounds"
          days={days}
          color="#14b8a6"
          label={(r) => `${r.kind === 'playground' ? '⌘ ' : ''}${r.name || r.uuid}`}
          value={(r) => num(r.viewers)}
        />
        <ListCard
          icon={Books}
          iconClass="bg-orange-50 text-orange-500"
          title={t('analytics.features.library_title')}
          query="library_top_resources"
          days={days}
          color="#f97316"
          label={(r) => r.resource_name || r.resource_uuid}
          value={(r) => num(r.opens)}
        />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <ContentCreation days={days} />
      </div>
    </div>
  )
}
