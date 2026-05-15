'use client'

import React from 'react'

import { ArrowRight } from 'lucide-react'

// Single-field "old → new" diff. Used by chapter / course preview cards
// for name, description, lock_type, etc. Highlights only when the value
// actually changed; otherwise renders the unchanged value muted.

interface Props {
  label: string
  before: unknown
  after: unknown
  // Optional renderer for non-primitive values (e.g. seo object).
  format?: (value: unknown) => React.ReactNode
}

export default function FieldDiff({ label, before, after, format }: Props) {
  const fmt = format || defaultFormat
  const changed = !shallowEq(before, after)
  return (
    <div className="space-y-1">
      <div className="text-[10px] uppercase tracking-wider font-semibold text-white/40">
        {label}
      </div>
      {changed ? (
        <div className="flex items-start gap-2 text-sm">
          <span className="flex-1 min-w-0 line-through text-rose-200/70 bg-rose-500/10 ring-1 ring-inset ring-rose-400/15 rounded-md px-2 py-1">
            {fmt(before)}
          </span>
          <ArrowRight size={14} className="text-white/40 mt-1.5 flex-none" />
          <span className="flex-1 min-w-0 text-emerald-100 bg-emerald-500/15 ring-1 ring-inset ring-emerald-400/25 rounded-md px-2 py-1">
            {fmt(after)}
          </span>
        </div>
      ) : (
        <div className="text-sm text-white/60 bg-white/[0.03] ring-1 ring-inset ring-white/[0.06] rounded-md px-2 py-1">
          {fmt(after)}
        </div>
      )}
    </div>
  )
}

function defaultFormat(v: unknown): React.ReactNode {
  if (v === null || v === undefined || v === '') {
    return <span className="italic text-white/35">empty</span>
  }
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  if (Array.isArray(v)) {
    if (v.length === 0) return <span className="italic text-white/35">empty</span>
    return v.map((x) => String(x)).join(', ')
  }
  if (typeof v === 'object') {
    return (
      <pre className="text-[11px] whitespace-pre-wrap">
        {JSON.stringify(v, null, 2)}
      </pre>
    )
  }
  return String(v)
}

function shallowEq(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a === null || a === undefined) return b === null || b === undefined || b === ''
  if (b === null || b === undefined) return a === null || a === undefined || a === ''
  if (typeof a !== typeof b) return false
  if (typeof a === 'object') return JSON.stringify(a) === JSON.stringify(b)
  return false
}
