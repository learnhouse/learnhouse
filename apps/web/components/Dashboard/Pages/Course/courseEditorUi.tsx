'use client'
import React from 'react'
import { Warning, Check } from '@phosphor-icons/react'
import * as Form from '@radix-ui/react-form'
import { Chip } from '@components/Dashboard/Shared/DashKit/DashKit'

// Course editor building blocks that sit on top of DashKit. Kept local to the
// course editor so the shared kit stays small.

// Tab body: page gutters only. Content spans the same width as the header
// so nothing leaves an empty band on the end side. `width` is kept for
// callers but no longer caps anything.
export function EditorPage({
  children,
  width = 'form',
  className = '',
}: {
  children: React.ReactNode
  width?: 'form' | 'wide'
  className?: string
}) {
  return (
    <div className={`px-4 sm:px-10 pt-6 sm:pt-8 pb-16 ${className}`}>
      <div className="w-full space-y-5" data-width={width}>{children}</div>
    </div>
  )
}

// Loading placeholder shaped like a stack of section cards.
export function EditorSkeleton({ sections = 2, rows = 3 }: { sections?: number; rows?: number }) {
  return (
    <div className="space-y-5 animate-pulse">
      {Array.from({ length: sections }).map((_, i) => (
        <div key={i} className="bg-white rounded-2xl nice-shadow p-5 space-y-5">
          <div className="space-y-2">
            <div className="h-4 w-40 rounded bg-neutral-200" />
            <div className="h-3 w-72 max-w-full rounded bg-neutral-100" />
          </div>
          {Array.from({ length: rows }).map((__, j) => (
            <div key={j} className="space-y-2">
              <div className="h-3 w-24 rounded bg-neutral-200" />
              <div className="h-9 w-full rounded-lg bg-neutral-100" />
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

export function ErrorNotice({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 rounded-xl bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-200 px-4 py-3 text-sm font-medium">
      <Warning size={16} className="shrink-0" />
      <span>{children}</span>
    </div>
  )
}

// A labelled field inside a Radix Form: label on the start side, error or
// counter on the end side, the control (wrapped in Form.Control by the
// caller) below, then an optional hint.
export function FormRow({
  name,
  label,
  error,
  aside,
  hint,
  children,
}: {
  name: string
  label: React.ReactNode
  error?: string
  aside?: React.ReactNode
  hint?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <Form.Field name={name} className="grid">
      <div className="flex items-baseline justify-between gap-3 mb-1.5">
        <Form.Label className="text-sm font-semibold text-neutral-800">{label}</Form.Label>
        <span className="flex items-center gap-2 text-xs">
          {error && <span className="font-medium text-rose-600">{error}</span>}
          {aside}
        </span>
      </div>
      {children}
      {hint && <FieldHint>{hint}</FieldHint>}
    </Form.Field>
  )
}

// Hint line under a field.
export function FieldHint({ children }: { children: React.ReactNode }) {
  return <p className="mt-1.5 text-xs text-neutral-400">{children}</p>
}

// "12/70" counter for length-limited fields.
export function CharCount({ current, max }: { current: number; max: number }) {
  return (
    <span className={`tabular-nums ${current > max ? 'text-rose-600 font-medium' : 'text-neutral-400'}`}>
      {current}/{max}
    </span>
  )
}

// Square checkbox drawn by hand so selection rows look the same everywhere.
export function SelectBox({
  checked,
  onClick,
  disabled,
  label,
  inverse = false,
  className = '',
}: {
  checked: boolean
  onClick?: (_e: React.MouseEvent) => void
  disabled?: boolean
  label?: string
  // For use on a dark surface (the selection bar).
  inverse?: boolean
  className?: string
}) {
  const tone = inverse
    ? checked
      ? 'bg-white text-neutral-900'
      : 'ring-1 ring-inset ring-white/40 hover:ring-white/70'
    : checked
      ? 'bg-neutral-900 text-white'
      : 'bg-white ring-1 ring-inset ring-neutral-300 hover:ring-neutral-400'
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={`h-[18px] w-[18px] shrink-0 rounded-md flex items-center justify-center transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${tone} ${className}`}
    >
      {checked && <Check size={12} weight="bold" />}
    </button>
  )
}

// Either/or setting card (public vs users only, open vs closed). Unlike
// DashKit's ChoiceCard it forwards its ref and extra props, so it can be a
// Radix `asChild` trigger for a confirmation dialog.
type ChoiceTileProps = {
  icon: React.ElementType
  title: string
  description: string
  selected: boolean
  activeLabel?: string
} & React.HTMLAttributes<HTMLDivElement>

export const ChoiceTile = React.forwardRef<HTMLDivElement, ChoiceTileProps>(function ChoiceTile(
  { icon: Icon, title, description, selected, activeLabel, className, ...rest },
  ref
) {
  return (
    <div
      ref={ref}
      role="radio"
      aria-checked={selected}
      {...rest}
      className={`relative w-full flex items-start gap-3 rounded-xl px-4 py-4 text-start cursor-pointer select-none transition-all ${
        selected ? 'bg-white ring-2 ring-neutral-900 shadow-sm' : 'bg-white ring-1 ring-inset ring-neutral-200 hover:ring-neutral-300'
      } ${className || ''}`}
    >
      <div
        className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 transition-colors ${
          selected ? 'bg-neutral-900 text-white' : 'bg-neutral-100 text-neutral-500'
        }`}
      >
        <Icon size={18} />
      </div>
      <div className="min-w-0 grow">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-semibold text-neutral-900">{title}</span>
          {selected && activeLabel && (
            <Chip tone="emerald" icon={<Check size={12} weight="bold" />}>
              {activeLabel}
            </Chip>
          )}
        </div>
        <p className="mt-1 text-xs text-neutral-500 leading-relaxed">{description}</p>
      </div>
    </div>
  )
})

export function ChoiceTileSkeleton() {
  return (
    <div className="w-full rounded-xl ring-1 ring-inset ring-neutral-200 animate-pulse flex items-start gap-3 px-4 py-4">
      <div className="w-10 h-10 rounded-xl bg-neutral-100" />
      <div className="grow space-y-2">
        <div className="h-4 w-28 rounded bg-neutral-100" />
        <div className="h-3 w-full rounded bg-neutral-100" />
      </div>
    </div>
  )
}
