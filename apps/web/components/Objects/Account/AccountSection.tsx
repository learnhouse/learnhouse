'use client'
import React from 'react'
import { INPUT, TEXTAREA, buttonClass, type ButtonSize, type ButtonVariant } from '@/design'
import { CircleNotch } from '@phosphor-icons/react'

// Shared pieces for the account pages: the one header every section opens
// with, and thin field/button wrappers so the older forms (Formik + the
// shadcn call shapes) render with the V2 design-system look.

export function AccountSectionHeader({
  title,
  description,
  actions,
}: {
  title: React.ReactNode
  description?: React.ReactNode
  actions?: React.ReactNode
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3 mb-5">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold tracking-tight text-neutral-900">{title}</h1>
        {description && <p className="mt-1 text-sm text-neutral-500">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

export const AccountInput = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function AccountInput({ className = '', ...rest }, ref) {
    return <input ref={ref} className={`${INPUT} disabled:opacity-60 ${className}`} {...rest} />
  }
)

export const AccountTextarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function AccountTextarea({ className = '', ...rest }, ref) {
    return <textarea ref={ref} className={`${TEXTAREA} ${className}`} {...rest} />
  }
)

export function AccountLabel({
  htmlFor,
  hint,
  error,
  className = '',
  children,
}: {
  htmlFor?: string
  hint?: React.ReactNode
  error?: string | false | null
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={`flex items-baseline justify-between gap-3 mb-1.5 ${className}`}>
      <label htmlFor={htmlFor} className="text-sm font-semibold text-neutral-800">
        {children}
      </label>
      {error ? (
        <span className="text-xs font-medium text-rose-600">{error}</span>
      ) : (
        hint && <span className="text-xs text-neutral-400">{hint}</span>
      )}
    </div>
  )
}

// Maps the shadcn variant names the older forms use onto the DashKit recipes.
const VARIANT: Record<string, ButtonVariant> = {
  default: 'primary',
  primary: 'primary',
  outline: 'secondary',
  secondary: 'secondary',
  ghost: 'ghost',
  destructive: 'danger',
  danger: 'danger',
  'danger-ghost': 'danger-ghost',
}

export const AccountButton = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: keyof typeof VARIANT
    size?: ButtonSize | 'default'
    loading?: boolean
  }
>(function AccountButton({ variant = 'default', size = 'md', loading, className = '', type = 'button', disabled, children, ...rest }, ref) {
  const resolvedSize: ButtonSize = size === 'default' ? 'md' : size
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={buttonClass(VARIANT[variant] ?? 'secondary', resolvedSize, className)}
      {...rest}
    >
      {loading && <CircleNotch size={14} className="animate-spin" />}
      {children}
    </button>
  )
})

/** Inline notice inside a panel (warnings before a destructive save, errors). */
export function AccountNotice({
  tone = 'warning',
  icon,
  children,
}: {
  tone?: 'warning' | 'danger' | 'success' | 'neutral'
  icon?: React.ReactNode
  children: React.ReactNode
}) {
  const tones = {
    warning: 'bg-amber-50 text-amber-800 ring-amber-600/10',
    danger: 'bg-rose-50 text-rose-700 ring-rose-600/10',
    success: 'bg-emerald-50 text-emerald-800 ring-emerald-600/10',
    neutral: 'bg-neutral-50 text-neutral-600 ring-neutral-900/5',
  } as const
  return (
    <div className={`flex items-start gap-2 rounded-xl px-3 py-2.5 text-sm ring-1 ring-inset ${tones[tone]}`}>
      {icon && <span className="mt-0.5 shrink-0">{icon}</span>}
      <div className="min-w-0">{children}</div>
    </div>
  )
}
