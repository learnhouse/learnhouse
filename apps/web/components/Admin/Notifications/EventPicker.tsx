'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { Check, MagnifyingGlass } from '@phosphor-icons/react'
import { INPUT } from '@/design'
import type { NotificationEvent } from '@services/ee/platform/ops'
import { SeverityPill } from '@components/Admin/Shared/OpsKit'

// Event picker for notification rules: `*` (everything), `<group>.*` per
// group, or single events. A wildcard covers the events under it, so those
// show as checked and locked.

export function patternCovers(pattern: string, key: string): boolean {
  if (pattern === '*') return true
  if (pattern.endsWith('.*')) return key.startsWith(pattern.slice(0, -1))
  return pattern === key
}

// Grouped by the key's first segment, which is what `<prefix>.*` matches.
function groupOf(e: NotificationEvent): string {
  return e.key.split('.')[0]
}

function Box({ on, locked }: { on: boolean; locked?: boolean }) {
  return (
    <span
      className={`h-4 w-4 shrink-0 rounded inline-flex items-center justify-center ring-1 ring-inset ${
        on ? (locked ? 'bg-neutral-300 ring-neutral-300 text-white' : 'bg-neutral-900 ring-neutral-900 text-white') : 'ring-neutral-300'
      }`}
    >
      {on && <Check size={11} weight="bold" />}
    </span>
  )
}

export default function EventPicker({ events, value, onChange }: { events: NotificationEvent[]; value: string[]; onChange: (_v: string[]) => void }) {
  const { t } = useTranslation()
  const [q, setQ] = React.useState('')
  const all = value.includes('*')
  const needle = q.trim().toLowerCase()
  const shown = needle ? events.filter((e) => e.key.includes(needle) || e.label.toLowerCase().includes(needle)) : events
  const groups = Array.from(new Set(shown.map(groupOf)))

  const toggle = (pattern: string) => {
    if (value.includes(pattern)) onChange(value.filter((v) => v !== pattern))
    else if (pattern === '*') onChange(['*'])
    else if (pattern.endsWith('.*')) onChange([...value.filter((v) => !patternCovers(pattern, v) || v === '*'), pattern])
    else onChange([...value, pattern])
  }

  const row = 'w-full flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-start text-[13px] hover:bg-neutral-100 disabled:hover:bg-transparent disabled:cursor-default'

  return (
    <div className="rounded-xl ring-1 ring-inset ring-neutral-200 p-1.5">
      <div className="relative mb-1">
        <MagnifyingGlass size={13} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-neutral-400" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('admin.notifications.rules.find_event')} className={`${INPUT} h-8 ps-8 text-[13px]`} />
      </div>
      <div className="max-h-72 overflow-y-auto">
        {!needle && (
          <button type="button" className={row} onClick={() => toggle('*')} aria-pressed={all}>
            <Box on={all} />
            <span className="flex-1 font-semibold text-neutral-900">{t('admin.notifications.rules.all_events')}</span>
            <code className="text-[11px] text-neutral-400" dir="ltr">
              *
            </code>
          </button>
        )}
        {groups.map((g) => {
          const wildcard = `${g}.*`
          const groupOn = all || value.includes(wildcard)
          return (
            <div key={g} className="mt-1">
              <button type="button" className={row} onClick={() => toggle(wildcard)} disabled={all} aria-pressed={groupOn}>
                <Box on={groupOn} locked={all} />
                <span className="flex-1 font-semibold text-neutral-800">{t('admin.notifications.rules.group_all', { group: t(`admin.notifications.groups.${g}`, { defaultValue: g }) })}</span>
                <code className="text-[11px] text-neutral-400" dir="ltr">
                  {wildcard}
                </code>
              </button>
              {shown
                .filter((e) => groupOf(e) === g)
                .map((e) => {
                  const covered = all || value.includes(wildcard)
                  const on = covered || value.includes(e.key)
                  return (
                    <button key={e.key} type="button" className={`${row} ps-7`} onClick={() => toggle(e.key)} disabled={covered} aria-pressed={on}>
                      <Box on={on} locked={covered} />
                      <span className="flex-1 min-w-0 truncate text-neutral-700">{e.label}</span>
                      {e.severity && e.severity !== 'info' && <SeverityPill severity={e.severity} />}
                    </button>
                  )
                })}
            </div>
          )
        })}
        {groups.length === 0 && <p className="px-2.5 py-3 text-xs text-neutral-400">{t('admin.filters.no_options')}</p>}
      </div>
    </div>
  )
}
