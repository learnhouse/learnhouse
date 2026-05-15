'use client'

import React, { useMemo, useState } from 'react'

import { AtlasEvent } from '@services/ai/atlas'
import {
  Check,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  CircleX,
  Loader2,
  Search,
  Sparkles,
} from 'lucide-react'

// Per-message inline timeline of agent actions. Reads directly from
// ``msg.events`` (the ordered raw log applyEvent populates). One row
// per tool start/end, entity.resolved, and applied result. Collapses
// to a one-line summary once the message finishes streaming.

interface Props {
  events: AtlasEvent[] | undefined
  streaming?: boolean
}

interface TimelineRow {
  key: string
  kind: 'tool' | 'entity' | 'applied' | 'error'
  status: 'pending' | 'ok' | 'error' | 'info'
  primary: React.ReactNode
  secondary?: React.ReactNode
  duration_ms?: number
}

export default function ActionTimeline({ events, streaming }: Props) {
  const rows = useMemo(() => buildRows(events || []), [events])
  const [expanded, setExpanded] = useState(streaming)

  // Keep expanded while streaming so the user sees live activity.
  React.useEffect(() => {
    if (streaming) setExpanded(true)
  }, [streaming])

  if (rows.length === 0) return null

  const summary = useMemo(() => {
    const counts = { tool: 0, ok: 0, err: 0, applied: 0, entity: 0 }
    for (const r of rows) {
      if (r.kind === 'tool') counts.tool++
      if (r.kind === 'tool' && r.status === 'ok') counts.ok++
      if (r.kind === 'tool' && r.status === 'error') counts.err++
      if (r.kind === 'applied') counts.applied++
      if (r.kind === 'entity') counts.entity++
    }
    const parts: string[] = []
    if (counts.tool > 0) parts.push(`${counts.tool} tool${counts.tool === 1 ? '' : 's'}`)
    if (counts.entity > 0) parts.push(`${counts.entity} resolved`)
    if (counts.applied > 0) parts.push(`${counts.applied} applied`)
    if (counts.err > 0) parts.push(`${counts.err} error${counts.err === 1 ? '' : 's'}`)
    return parts.join(' · ') || 'No activity'
  }, [rows])

  return (
    <div className="mt-2 rounded-xl ring-1 ring-inset ring-white/[0.06] bg-white/[0.02] overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-white/55 hover:text-white/80 hover:bg-white/[0.03] transition-colors"
      >
        {expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        <Sparkles size={11} className={streaming ? 'text-violet-300 animate-pulse' : 'text-violet-300/60'} />
        <span className="flex-1 text-left font-medium">
          {streaming ? 'Atlas is working…' : 'Activity'}
        </span>
        <span className="text-white/40 font-mono text-[10px]">{summary}</span>
      </button>
      {expanded && (
        <ul className="border-t border-white/[0.04] divide-y divide-white/[0.03]">
          {rows.map((r) => (
            <TimelineRowView key={r.key} row={r} />
          ))}
        </ul>
      )}
    </div>
  )
}

function TimelineRowView({ row }: { row: TimelineRow }) {
  let icon: React.ReactNode
  if (row.kind === 'tool' && row.status === 'pending') {
    icon = <Loader2 size={11} className="animate-spin text-violet-300" />
  } else if (row.kind === 'tool' && row.status === 'ok') {
    icon = <CircleCheck size={11} className="text-emerald-300" />
  } else if (row.kind === 'tool' && row.status === 'error') {
    icon = <CircleX size={11} className="text-rose-300" />
  } else if (row.kind === 'entity') {
    icon = <Search size={11} className="text-sky-300" />
  } else if (row.kind === 'applied') {
    icon = <Check size={11} className="text-emerald-300" />
  } else {
    icon = <CircleX size={11} className="text-rose-300" />
  }
  return (
    <li className="flex items-start gap-2 px-3 py-1.5 text-[11px]">
      <span className="flex-none mt-[3px]">{icon}</span>
      <div className="flex-1 min-w-0">
        <div className="text-white/85 truncate">{row.primary}</div>
        {row.secondary && (
          <div className="text-white/40 truncate font-mono text-[10px] mt-0.5">{row.secondary}</div>
        )}
      </div>
      {row.duration_ms !== undefined && (
        <span className="flex-none text-white/35 font-mono text-[10px]">
          {row.duration_ms}ms
        </span>
      )}
    </li>
  )
}

function buildRows(events: AtlasEvent[]): TimelineRow[] {
  // Pair tool.start with tool.end on call_id so each tool gets a single
  // row with duration + final status.
  type Pending = { startEvent: Extract<AtlasEvent, { type: 'tool.start' }> }
  const toolPairs: Record<string, Pending> = {}
  const out: TimelineRow[] = []

  for (const evt of events) {
    if (evt.type === 'tool.start') {
      toolPairs[evt.call_id] = { startEvent: evt }
      // Pre-insert a pending row; later we'll mutate it on tool.end.
      out.push({
        key: `tool-${evt.call_id}`,
        kind: 'tool',
        status: 'pending',
        primary: <span className="font-mono">{evt.name}</span>,
        secondary: formatArgsPreview(evt.args_redacted),
      })
    } else if (evt.type === 'tool.end') {
      const idx = out.findIndex((r) => r.key === `tool-${evt.call_id}`)
      if (idx !== -1) {
        out[idx] = {
          ...out[idx],
          status: evt.ok ? 'ok' : 'error',
          duration_ms: evt.duration_ms,
        }
      }
    } else if (evt.type === 'entity.resolved') {
      out.push({
        key: `ent-${evt.uuid}-${out.length}`,
        kind: 'entity',
        status: 'info',
        primary: (
          <>
            Matched {evt.kind} <span className="font-medium text-white">{evt.name}</span>
            {' '}
            <span className="text-white/40 text-[10px]">
              (via {evt.via}
              {typeof evt.score === 'number' && evt.score < 1 ? ` · ${evt.score.toFixed(2)}` : ''})
            </span>
          </>
        ),
      })
    } else if (evt.type === 'applied') {
      out.push({
        key: `app-${evt.pending_id}`,
        kind: 'applied',
        status: 'ok',
        primary: (
          <>
            Applied{' '}
            <span className="font-medium text-white">{evt.target.name || '(unnamed)'}</span>
            {typeof evt.version_after === 'number' && (
              <span className="text-white/40 text-[10px] ml-1">v{evt.version_after}</span>
            )}
          </>
        ),
      })
    }
  }

  return out
}

function formatArgsPreview(args: Record<string, any> | undefined): string | undefined {
  if (!args) return undefined
  const entries = Object.entries(args)
  if (!entries.length) return undefined
  return entries
    .slice(0, 3)
    .map(([k, v]) => {
      const s = typeof v === 'string' ? v : JSON.stringify(v)
      return `${k}=${s.length > 32 ? s.slice(0, 29) + '…' : s}`
    })
    .join(' · ')
}
