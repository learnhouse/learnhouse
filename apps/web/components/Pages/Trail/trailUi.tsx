'use client'
import React from 'react'

// Section heading used by every block of the Progress page: icon tile, title,
// one-line description, actions on the end side.
export function TrailSection({
  id,
  icon,
  title,
  description,
  count,
  actions,
  children,
}: {
  id: string
  icon: React.ReactNode
  title: React.ReactNode
  description?: React.ReactNode
  count?: number
  actions?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section aria-labelledby={id} className="space-y-4 sm:space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <div className="w-9 h-9 shrink-0 rounded-xl bg-white nice-shadow text-neutral-700 flex items-center justify-center">{icon}</div>
          <div className="min-w-0">
            <h2 id={id} className="flex items-center gap-2 text-lg font-bold text-neutral-900 leading-tight">
              {title}
              {!!count && (
                <span className="text-xs font-semibold tabular-nums text-neutral-500 bg-neutral-100 rounded-full px-2 py-0.5">{count}</span>
              )}
            </h2>
            {description && <p className="mt-0.5 text-sm text-neutral-500">{description}</p>}
          </div>
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      {children}
    </section>
  )
}

// Friendly empty block with an optional call to action.
export function TrailEmpty({
  icon,
  title,
  description,
  action,
}: {
  icon: React.ReactNode
  title: string
  description?: string
  action?: React.ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center text-center gap-3 rounded-2xl bg-white nice-shadow px-6 py-12">
      <div className="w-12 h-12 rounded-2xl bg-neutral-100 text-neutral-400 flex items-center justify-center">{icon}</div>
      <div>
        <p className="text-base font-semibold text-neutral-900">{title}</p>
        {description && <p className="mt-1 text-sm text-neutral-500 max-w-sm">{description}</p>}
      </div>
      {action}
    </div>
  )
}
