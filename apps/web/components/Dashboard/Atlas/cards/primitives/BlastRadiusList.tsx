'use client'

import React from 'react'

import { Warning } from '@phosphor-icons/react'

// Used inside destructive preview cards to spell out everything that
// will be removed: child chapters / activities / counts / per-name list.
// The text-only blast_radius_summary is rendered separately in the
// destructive challenge form.

interface Props {
  title?: string
  summary?: string
  // Free-form facts: ("Activities", 4), ("Quiz attempts", 12)
  counts?: { label: string; value: number }[]
  // Named children that will be removed.
  items?: { uuid?: string; name: string }[]
  maxItems?: number
}

export default function BlastRadiusList({
  title = 'What this removes',
  summary,
  counts,
  items,
  maxItems = 12,
}: Props) {
  const shown = items?.slice(0, maxItems) || []
  const overflow = items ? Math.max(0, items.length - shown.length) : 0
  return (
    <div className="rounded-lg ring-1 ring-inset ring-rose-400/20 bg-rose-500/5 px-3 py-2.5">
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider font-semibold text-rose-200/80 mb-1.5">
        <Warning size={11} className="text-rose-300" />
        {title}
      </div>
      {summary && (
        <p className="text-xs text-rose-100/85 leading-relaxed mb-2">{summary}</p>
      )}
      {counts && counts.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 mb-2">
          {counts.map((c) => (
            <span
              key={c.label}
              className="inline-flex items-center gap-1 rounded-md bg-rose-500/15 ring-1 ring-inset ring-rose-400/25 px-2 py-0.5 text-[11px] text-rose-100"
            >
              <span className="font-semibold">{c.value}</span>
              <span className="text-rose-200/70">{c.label}</span>
            </span>
          ))}
        </div>
      )}
      {shown.length > 0 && (
        <ul className="space-y-0.5 text-[12px] text-rose-100/80">
          {shown.map((it, i) => (
            <li key={it.uuid || `${i}-${it.name}`} className="flex items-center gap-1.5">
              <span className="w-1 h-1 rounded-full bg-rose-300/70 flex-none" />
              <span className="truncate">{it.name}</span>
            </li>
          ))}
          {overflow > 0 && (
            <li className="text-rose-200/50 italic pl-3 mt-0.5">
              … and {overflow} more
            </li>
          )}
        </ul>
      )}
    </div>
  )
}
