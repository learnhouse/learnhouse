'use client'

/**
 * More things agents can generate: charts, mind maps, timelines, practice
 * exercises and reminders. Same contract as Blocks.tsx: each block gets the
 * validated JSON an agent wrote in a fenced block (see RICH_BLOCKS_PROMPT in
 * apps/api/src/services/messaging/agents.py).
 */

import React, { useMemo, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Bell, BellSlash, ChartBar, CheckCircle, Lightbulb, PencilSimpleLine, TreeStructure, CalendarBlank } from '@phosphor-icons/react'
import { useQueryClient } from '@tanstack/react-query'
import { useMessaging } from '@components/Messaging/MessagingProvider'
import { cancelReminder, type Reminder } from '@services/messaging/messaging'

export type ChartData = {
  type: 'bar' | 'line' | 'pie'
  title?: string
  unit?: string
  data: { label: string; value: number }[]
}
export type MindmapData = { center: string; branches: { label: string; children?: string[] }[] }
export type TimelineData = { title?: string; events: { date: string; title: string; detail?: string }[] }
export type ExerciseData = { prompt: string; hints?: string[]; solution: string }
export type ReminderData = { text: string; due_at: string }

export type MoreBlockKind = 'chart' | 'mindmap' | 'timeline' | 'exercise' | 'reminder'
export const MORE_KINDS: MoreBlockKind[] = ['chart', 'mindmap', 'timeline', 'exercise', 'reminder']

const isStr = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0

export function validateMore(kind: MoreBlockKind, data: any): boolean {
  if (!data || typeof data !== 'object') return false
  switch (kind) {
    case 'chart':
      return (
        ['bar', 'line', 'pie'].includes(data.type) &&
        Array.isArray(data.data) &&
        data.data.length > 0 &&
        data.data.length <= 40 &&
        data.data.every((d: any) => isStr(String(d?.label ?? '')) && Number.isFinite(Number(d?.value)))
      )
    case 'mindmap':
      return isStr(data.center) && Array.isArray(data.branches) && data.branches.length > 0 && data.branches.every((b: any) => isStr(b?.label))
    case 'timeline':
      return Array.isArray(data.events) && data.events.length > 0 && data.events.every((e: any) => isStr(e?.title))
    case 'exercise':
      return isStr(data.prompt) && isStr(data.solution)
    case 'reminder':
      return isStr(data.text) && isStr(data.due_at)
  }
}

const shell = 'not-prose my-2.5 rounded-xl border border-gray-200 bg-white overflow-hidden text-gray-900'

function Header({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="flex items-center gap-2 px-3.5 h-10 border-b border-gray-100 bg-gray-50/70">
      <span className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-gray-500 truncate">
        {icon}
        {title}
      </span>
    </div>
  )
}

/* ------------------------------------------------------------------------ */
/* Chart                                                                    */
/* ------------------------------------------------------------------------ */

// Neutral greys first, so a single-series chart reads like the rest of the app.
const SERIES = ['#171717', '#525252', '#a3a3a3', '#d4d4d4', '#404040', '#737373', '#e5e5e5', '#262626']

export function ChartBlock({ data }: { data: ChartData }) {
  const rows = useMemo(() => data.data.map((d) => ({ label: String(d.label), value: Number(d.value) })), [data])
  const fmt = (v: number) => `${v.toLocaleString()}${data.unit ? ` ${data.unit}` : ''}`
  return (
    <div className={shell}>
      <Header icon={<ChartBar size={14} weight="bold" />} title={data.title || 'Chart'} />
      <div className="h-56 px-2 py-3">
        <ResponsiveContainer width="100%" height="100%">
          {data.type === 'pie' ? (
            <PieChart>
              <Pie data={rows} dataKey="value" nameKey="label" innerRadius={45} outerRadius={80} paddingAngle={2} stroke="#fff">
                {rows.map((_, i) => (
                  <Cell key={i} fill={SERIES[i % SERIES.length]} />
                ))}
              </Pie>
              <Tooltip formatter={(v: any) => fmt(Number(v))} />
            </PieChart>
          ) : data.type === 'line' ? (
            <LineChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
              <CartesianGrid stroke="#f3f4f6" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 12, fill: '#6b7280' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 12, fill: '#6b7280' }} axisLine={false} tickLine={false} />
              <Tooltip formatter={(v: any) => fmt(Number(v))} />
              <Line type="monotone" dataKey="value" stroke="#171717" strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          ) : (
            <BarChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
              <CartesianGrid stroke="#f3f4f6" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 12, fill: '#6b7280' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 12, fill: '#6b7280' }} axisLine={false} tickLine={false} />
              <Tooltip formatter={(v: any) => fmt(Number(v))} cursor={{ fill: '#f9fafb' }} />
              <Bar dataKey="value" fill="#171717" radius={[4, 4, 0, 0]} />
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
      {data.type === 'pie' && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 px-3.5 pb-3 text-xs text-gray-600">
          {rows.map((r, i) => (
            <span key={r.label} className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: SERIES[i % SERIES.length] }} />
              {r.label} · {fmt(r.value)}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------------ */
/* Mind map                                                                 */
/* ------------------------------------------------------------------------ */

export function MindmapBlock({ data }: { data: MindmapData }) {
  return (
    <div className={shell}>
      <Header icon={<TreeStructure size={14} weight="bold" />} title="Mind map" />
      <div className="p-4 overflow-x-auto">
        <div className="flex justify-center">
          <span className="rounded-lg bg-gray-900 px-3 py-1.5 text-sm font-semibold text-white">{data.center}</span>
        </div>
        <div className="mx-auto h-4 w-px bg-gray-200" />
        <div
          className="grid gap-3"
          style={{ gridTemplateColumns: `repeat(${Math.min(data.branches.length, 4)}, minmax(140px, 1fr))` }}
        >
          {data.branches.map((b) => (
            <div key={b.label} className="relative pt-3">
              <span className="absolute inset-x-0 top-0 mx-auto h-3 w-px bg-gray-200" />
              <div className="rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-center text-sm font-semibold text-gray-800">
                {b.label}
              </div>
              {b.children && b.children.length > 0 && (
                <ul className="mt-2 ms-3 space-y-1 border-s border-gray-200 ps-3">
                  {b.children.map((c) => (
                    <li key={c} className="relative text-[13px] leading-snug text-gray-600 before:absolute before:-start-3 before:top-2 before:h-px before:w-2 before:bg-gray-200">
                      {c}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------------ */
/* Timeline                                                                 */
/* ------------------------------------------------------------------------ */

export function TimelineBlock({ data }: { data: TimelineData }) {
  return (
    <div className={shell}>
      <Header icon={<CalendarBlank size={14} weight="bold" />} title={data.title || 'Timeline'} />
      <ol className="px-4 py-3">
        {data.events.map((e, i) => (
          <li key={`${e.title}-${i}`} className="relative flex gap-3 pb-3 last:pb-0">
            <div className="flex flex-col items-center">
              <span className="mt-1.5 h-2.5 w-2.5 rounded-full border-2 border-gray-900 bg-white" />
              {i < data.events.length - 1 && <span className="w-px flex-1 bg-gray-200" />}
            </div>
            <div className="min-w-0 pb-1">
              {e.date && <p className="text-xs font-medium text-gray-500">{e.date}</p>}
              <p className="text-sm font-semibold text-gray-900">{e.title}</p>
              {e.detail && <p className="text-[13px] leading-relaxed text-gray-600">{e.detail}</p>}
            </div>
          </li>
        ))}
      </ol>
    </div>
  )
}

/* ------------------------------------------------------------------------ */
/* Exercise                                                                 */
/* ------------------------------------------------------------------------ */

export function ExerciseBlock({ data }: { data: ExerciseData }) {
  const hints = data.hints || []
  const [shownHints, setShownHints] = useState(0)
  const [solved, setSolved] = useState(false)
  const [draft, setDraft] = useState('')
  return (
    <div className={shell}>
      <Header icon={<PencilSimpleLine size={14} weight="bold" />} title="Practice" />
      <div className="space-y-3 px-3.5 py-3">
        <p className="text-sm leading-relaxed text-gray-800 whitespace-pre-wrap">{data.prompt}</p>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={3}
          placeholder="Work it out here (only you see this)"
          className="w-full resize-y rounded-lg border border-gray-200 bg-gray-50/60 px-3 py-2 text-sm outline-none focus:border-gray-300 focus:bg-white"
        />
        {hints.slice(0, shownHints).map((h, i) => (
          <div key={i} className="flex gap-2 rounded-lg bg-gray-50 px-3 py-2 text-[13px] text-gray-700">
            <Lightbulb size={15} weight="fill" className="mt-0.5 shrink-0 text-gray-500" />
            <span>
              <span className="font-semibold">Hint {i + 1}.</span> {h}
            </span>
          </div>
        ))}
        {solved && (
          <div className="rounded-lg border border-gray-200 px-3 py-2.5 text-sm leading-relaxed text-gray-800 whitespace-pre-wrap">
            <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-gray-500">
              <CheckCircle size={14} weight="fill" /> Solution
            </p>
            {data.solution}
          </div>
        )}
        <div className="flex items-center gap-2">
          {shownHints < hints.length && !solved && (
            <button
              type="button"
              onClick={() => setShownHints((n) => n + 1)}
              className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Show a hint
            </button>
          )}
          {!solved && (
            <button
              type="button"
              onClick={() => setSolved(true)}
              className="rounded-lg bg-black px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800"
            >
              Show solution
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------------ */
/* Reminder                                                                 */
/* ------------------------------------------------------------------------ */

export function formatDue(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  const tomorrow = new Date(now)
  tomorrow.setDate(now.getDate() + 1)
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  if (sameDay) return `Today at ${time}`
  if (d.toDateString() === tomorrow.toDateString()) return `Tomorrow at ${time}`
  return `${d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })} at ${time}`
}

/**
 * A reminder the agent scheduled. ``reminder`` is the stored one (live
 * status, cancellable); without it the agent's time didn't validate and
 * nothing was scheduled.
 */
export function ReminderBlock({ data, reminder }: { data: ReminderData; reminder?: Reminder }) {
  const { token, orgId } = useMessaging()
  const qc = useQueryClient()
  // The stored reminder arrives with the finished reply; a cancel here overrides it.
  const [override, setOverride] = useState<Reminder['status'] | null>(null)
  const status = override ?? reminder?.status
  const [busy, setBusy] = useState(false)
  const due = reminder?.due_at || data.due_at

  const cancel = async () => {
    if (!reminder || !token) return
    setBusy(true)
    try {
      const r = await cancelReminder(reminder.reminder_uuid, token)
      setOverride(r.status)
      qc.invalidateQueries({ queryKey: ['messaging', orgId ?? 0, 'reminders'] })
    } finally {
      setBusy(false)
    }
  }

  const label =
    status === 'cancelled' ? 'Cancelled' : status === 'sent' ? 'Sent' : status === 'pending' ? formatDue(due) : 'Not scheduled'
  return (
    <div className="my-2.5 flex items-center gap-3 rounded-lg border border-gray-200 bg-white px-3.5 py-2.5">
      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${status === 'pending' ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-500'}`}>
        {status === 'cancelled' ? <BellSlash size={18} weight="fill" /> : <Bell size={18} weight="fill" />}
      </span>
      <div className="min-w-0 flex-1">
        <p className={`text-sm font-semibold ${status === 'cancelled' ? 'text-gray-400 line-through' : 'text-gray-900'}`}>{data.text}</p>
        <p className="text-xs text-gray-500">{label}</p>
      </div>
      {status === 'pending' && reminder && (
        <button
          type="button"
          onClick={cancel}
          disabled={busy}
          className="rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
        >
          Cancel
        </button>
      )}
    </div>
  )
}
