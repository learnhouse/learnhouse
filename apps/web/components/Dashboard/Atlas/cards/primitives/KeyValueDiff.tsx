'use client'

import React from 'react'

import FieldDiff from './FieldDiff'

// Renders a stack of FieldDiff rows for every field present in either
// ``before`` or ``after``. Filters to keys that are actually different
// when ``onlyChanged`` is true (default) — otherwise dumps everything
// for full edit-card context.

interface Props {
  before?: Record<string, any> | null
  after: Record<string, any> | null
  labelMap?: Record<string, string>
  formatMap?: Record<string, (value: unknown) => React.ReactNode>
  onlyChanged?: boolean
}

export default function KeyValueDiff({
  before,
  after,
  labelMap,
  formatMap,
  onlyChanged = true,
}: Props) {
  const allKeys = new Set<string>([
    ...Object.keys(before || {}),
    ...Object.keys(after || {}),
  ])
  const keys = Array.from(allKeys).filter((k) => {
    if (!onlyChanged) return true
    const a = (before || {})[k]
    const b = (after || {})[k]
    return JSON.stringify(a) !== JSON.stringify(b)
  })
  if (keys.length === 0) {
    return (
      <div className="text-xs italic text-white/40">
        No changes detected.
      </div>
    )
  }
  return (
    <div className="space-y-3">
      {keys.map((k) => (
        <FieldDiff
          key={k}
          label={labelMap?.[k] || humanize(k)}
          before={before ? (before as any)[k] : undefined}
          after={after ? (after as any)[k] : undefined}
          format={formatMap?.[k]}
        />
      ))}
    </div>
  )
}

function humanize(key: string): string {
  return key
    .replace(/_/g, ' ')
    .replace(/\bid\b/i, 'ID')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}
