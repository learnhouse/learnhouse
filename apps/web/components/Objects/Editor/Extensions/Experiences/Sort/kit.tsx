'use client'
/*
 Small UI pieces the Sort, Sequence and Match experiences share: the
 author-form parts (sections, inline hints, icon buttons, "add" rows) and the
 learner bits (result badges, the drag ghost, the "not ready" note).
 Kept here, next to the blocks that use them, rather than in shared/.
*/
import React from 'react'
import { createPortal } from 'react-dom'
import { CheckCircle, Info, Plus, Warning, XCircle } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'

export type Issue = { code: string; id?: string; severity: 'error' | 'warning' }

/** A titled group in the single-column author form. */
export function FormSection({ title, hint, children, end }: { title: React.ReactNode; hint?: React.ReactNode; children: React.ReactNode; end?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h4 className="m-0 text-xs font-semibold tracking-wide text-neutral-500 uppercase">{title}</h4>
        {end}
      </div>
      {hint && <p className="m-0 -mt-1 text-[12px] leading-snug text-neutral-400">{hint}</p>}
      {children}
    </div>
  )
}

/** Inline validation hint under a row or at the top of the form. Never blocks. */
export function InlineHint({ severity, children }: { severity: 'error' | 'warning' | 'info'; children: React.ReactNode }) {
  const Icon = severity === 'info' ? Info : Warning
  return (
    <p
      className={cn(
        'm-0 flex items-start gap-1.5 text-[12px] leading-snug',
        severity === 'error' ? 'text-rose-600' : severity === 'warning' ? 'text-amber-700' : 'text-neutral-500',
      )}
    >
      <Icon size={13} weight="bold" className="mt-px shrink-0" aria-hidden />
      <span>{children}</span>
    </p>
  )
}

/** Block-level hints (no `id`) listed above the form. */
export function BlockHints({ issues, text }: { issues: Issue[]; text: (_code: string) => string }) {
  const blockLevel = issues.filter((i) => !i.id)
  if (!blockLevel.length) return null
  return (
    <div className="flex flex-col gap-1 rounded-xl bg-neutral-50 px-3 py-2">
      {blockLevel.map((i) => (
        <InlineHint key={i.code} severity={i.severity}>
          {text(i.code)}
        </InlineHint>
      ))}
    </div>
  )
}

/** Hints for one row. */
export function RowHints({ issues, id, text }: { issues: Issue[]; id: string; text: (_code: string) => string }) {
  const mine = issues.filter((i) => i.id === id)
  if (!mine.length) return null
  return (
    <div className="flex flex-col gap-0.5 ps-1">
      {mine.map((i) => (
        <InlineHint key={i.code} severity={i.severity}>
          {text(i.code)}
        </InlineHint>
      ))}
    </div>
  )
}

export const ICON_BTN =
  'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-neutral-400 outline-none transition-colors hover:bg-neutral-100 hover:text-neutral-700 focus-visible:ring-2 focus-visible:ring-sky-500/40 disabled:pointer-events-none disabled:opacity-30'

export function AddRowButton({ onClick, disabled, children }: { onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-neutral-200 text-[13px] font-medium text-neutral-500 outline-none transition-colors hover:border-neutral-300 hover:bg-neutral-50 hover:text-neutral-800 focus-visible:ring-2 focus-visible:ring-sky-500/40 disabled:pointer-events-none disabled:opacity-40"
    >
      <Plus size={14} weight="bold" aria-hidden />
      {children}
    </button>
  )
}

/** ✓ / ✗ next to an answer: colour plus icon plus a screen-reader word. */
export function ResultIcon({ ok, size = 16, label }: { ok: boolean; size?: number; label?: string }) {
  const { t } = useTranslation()
  const Icon = ok ? CheckCircle : XCircle
  return (
    <>
      <Icon size={size} weight="fill" aria-hidden className={cn('pointer-events-none shrink-0', ok ? 'text-emerald-600' : 'text-rose-600')} />
      <span className="sr-only">{label ?? (ok ? t('activities.experiences.sort.correct', 'Correct') : t('activities.experiences.sort.wrong', 'Wrong'))}</span>
    </>
  )
}

/** Result surfaces, so green / red always come with an icon too. */
export const RESULT_CLASS = {
  correct: 'bg-emerald-50 text-emerald-900 ring-emerald-300',
  wrong: 'bg-rose-50 text-rose-900 ring-rose-300',
} as const

/** The chip that follows the pointer while dragging (portaled: no transformed ancestor). */
export function DragGhost({ x, y, children }: { x: number; y: number; children: React.ReactNode }) {
  if (typeof document === 'undefined') return null
  return createPortal(
    <div
      aria-hidden
      className="pointer-events-none fixed z-[1000] max-w-[16rem] -translate-x-1/2 -translate-y-1/2 rotate-[-2deg] rounded-xl bg-white px-3 py-2 text-sm font-medium text-neutral-900 shadow-[0_8px_24px_rgba(0,0,0,0.16),0_0_0_1px_rgba(0,0,0,0.08)]"
      style={{ left: x, top: y }}
    >
      {children}
    </div>,
    document.body,
  )
}

/** Shown to learners when the author hasn't finished the block. */
export function NotReady({ children }: { children: React.ReactNode }) {
  return (
    <p className="m-0 flex items-center gap-2 rounded-xl bg-neutral-50 px-3 py-3 text-[13px] text-neutral-500">
      <Info size={15} aria-hidden className="shrink-0" />
      {children}
    </p>
  )
}

/** Learner state resets when the content changes (author edits seen in preview). */
export function contentKey(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return String(Date.now())
  }
}
