'use client'
import React from 'react'
import * as Form from '@radix-ui/react-form'
import { CheckCircle, CircleNotch, Info, Warning, WarningCircle, X } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { buttonClass } from '@/design'

// The building blocks every auth screen (login, signup, forgot, reset, verify,
// the sign-in-link and callback pages) is written with, so they share one look:
// V2 neutrals, hairline rings, small refined type. Logic stays in the pages.

// ─── Fields ──────────────────────────────────────────────────────────────────

/** Text field: the DashKit INPUT look at a touch-friendly 40px. */
export const AUTH_INPUT =
  'block w-full h-10 px-3.5 text-sm text-neutral-900 bg-white rounded-xl ring-1 ring-inset ring-neutral-200 shadow-[0_1px_1px_rgba(0,0,0,0.03)] placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-900/15 aria-[invalid=true]:ring-rose-300 aria-[invalid=true]:focus:ring-rose-500/25 disabled:opacity-50 transition-shadow'

export const AUTH_TEXTAREA =
  'block w-full min-h-[84px] px-3.5 py-2.5 text-sm text-neutral-900 bg-white rounded-xl ring-1 ring-inset ring-neutral-200 shadow-[0_1px_1px_rgba(0,0,0,0.03)] placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-900/15 aria-[invalid=true]:ring-rose-300 resize-none transition-shadow'

/** Inline text link inside auth copy. */
export const AUTH_LINK =
  'font-medium text-neutral-900 underline-offset-4 hover:underline rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/20'

/** Quiet text button ("Back to sign in", "Use a backup code instead"). */
export const AUTH_TEXT_BUTTON =
  'inline-flex items-center gap-1.5 text-[13px] font-medium text-neutral-500 hover:text-neutral-900 transition-colors rounded-md disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/20'

/**
 * The label row above a Radix form control: label at the start, the field's
 * error (announced politely) or an extra link (e.g. "Forgot password?") at
 * the end.
 */
export function AuthLabel({
  children,
  error,
  end,
}: {
  children: React.ReactNode
  error?: string | false | null
  end?: React.ReactNode
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 mb-1.5 min-w-0">
      <Form.Label className="text-[13px] font-medium text-neutral-700">{children}</Form.Label>
      <div className="flex items-baseline gap-3 min-w-0">
        <span aria-live="polite" className="min-w-0">
          {error ? <span className="text-xs font-medium text-rose-600">{error}</span> : null}
        </span>
        {end}
      </div>
    </div>
  )
}

/** A field error under a control (used where the label row is busy). */
export function AuthFieldError({ children }: { children?: React.ReactNode }) {
  return (
    <p aria-live="polite" className="mt-1.5 flex items-start gap-1.5 text-xs font-medium text-rose-600 empty:hidden">
      {children ? (
        <>
          <WarningCircle size={14} weight="fill" className="shrink-0 mt-px" aria-hidden="true" />
          <span>{children}</span>
        </>
      ) : null}
    </p>
  )
}

// ─── Buttons ─────────────────────────────────────────────────────────────────

/** Full-width DashKit button at the auth height (40px). */
export function authButtonClass(variant: 'primary' | 'secondary' = 'primary', extra = '') {
  return `${buttonClass(variant, 'lg').replace(' h-9 ', ' h-10 ')} w-full gap-2 ${extra}`
}

type AuthButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  loading?: boolean
  icon?: React.ReactNode
  variant?: 'primary' | 'secondary'
}

/** The form's main action. Shows a spinner in place of the icon while busy. */
export const AuthButton = React.forwardRef<HTMLButtonElement, AuthButtonProps>(function AuthButton(
  { loading, icon, variant = 'primary', className = '', children, disabled, type = 'submit', ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={authButtonClass(variant, className)}
      {...rest}
    >
      {loading ? <CircleNotch size={16} className="animate-spin" aria-hidden="true" /> : icon}
      {children}
    </button>
  )
})

/** "Continue with Google / SSO / a sign-in link" rows. */
export function AuthProviderButton({
  icon,
  children,
  className = '',
  type = 'button',
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { icon?: React.ReactNode }) {
  return (
    <button type={type} className={authButtonClass('secondary', className)} {...rest}>
      {icon}
      <span>{children}</span>
    </button>
  )
}

/** Google's "G" mark, inline so the page doesn't fetch it from Google. */
export function GoogleMark({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" className="shrink-0">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  )
}

/** Hairline "or" between the password form and the other sign-in options. */
export function AuthDivider({ label }: { label?: string }) {
  const { t } = useTranslation()
  return (
    <div className="flex items-center gap-3 my-5" role="separator">
      <span className="h-px flex-1 bg-neutral-200/80" />
      <span className="text-[11px] font-medium uppercase tracking-wide text-neutral-400">{label ?? t('common.or')}</span>
      <span className="h-px flex-1 bg-neutral-200/80" />
    </div>
  )
}

// ─── Text ────────────────────────────────────────────────────────────────────

/** Page heading: one title and a one-line description. */
export function AuthHeading({
  title,
  description,
  center = false,
}: {
  title: React.ReactNode
  description?: React.ReactNode
  center?: boolean
}) {
  return (
    <div className={center ? 'text-center' : ''}>
      <h1 className="text-2xl font-semibold tracking-tight text-neutral-900 leading-tight">{title}</h1>
      {description && <p className="mt-1.5 text-sm text-neutral-500 leading-relaxed">{description}</p>}
    </div>
  )
}

/** The centred line under a form ("Don't have an account? Sign up"). */
export function AuthFootnote({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <p className={`mt-6 text-center text-[13px] text-neutral-500 ${className}`}>{children}</p>
}

// ─── Notices ─────────────────────────────────────────────────────────────────

export type AuthNoticeTone = 'danger' | 'warning' | 'success' | 'info'

const NOTICE_TONE: Record<AuthNoticeTone, string> = {
  danger: 'bg-rose-50 text-rose-800 ring-rose-600/10',
  warning: 'bg-amber-50 text-amber-900 ring-amber-600/15',
  success: 'bg-emerald-50 text-emerald-800 ring-emerald-600/10',
  info: 'bg-neutral-50 text-neutral-700 ring-neutral-900/[0.06]',
}

const NOTICE_ICON: Record<AuthNoticeTone, React.ReactNode> = {
  danger: <WarningCircle size={16} weight="fill" />,
  warning: <Warning size={16} weight="fill" />,
  success: <CheckCircle size={16} weight="fill" />,
  info: <Info size={16} weight="fill" />,
}

/**
 * An inline message above (or inside) the form. Errors and warnings are
 * announced assertively, confirmations politely.
 */
export function AuthNotice({
  tone = 'danger',
  icon,
  title,
  children,
  onDismiss,
  className = '',
}: {
  tone?: AuthNoticeTone
  icon?: React.ReactNode
  title?: React.ReactNode
  children?: React.ReactNode
  onDismiss?: () => void
  className?: string
}) {
  const { t } = useTranslation()
  const urgent = tone === 'danger' || tone === 'warning'
  return (
    <div
      role={urgent ? 'alert' : 'status'}
      className={`flex items-start gap-2.5 rounded-xl ring-1 ring-inset px-3.5 py-3 text-[13px] leading-snug animate-in fade-in duration-200 ${NOTICE_TONE[tone]} ${className}`}
    >
      <span className="shrink-0 mt-px opacity-80" aria-hidden="true">
        {icon ?? NOTICE_ICON[tone]}
      </span>
      <div className="flex-1 min-w-0 break-words">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={title ? 'mt-0.5 opacity-90' : 'font-medium'}>{children}</div>}
      </div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label={t('common.dismiss')}
          className="shrink-0 -m-1 p-1 rounded-md opacity-60 hover:opacity-100 hover:bg-black/5 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current/30"
        >
          <X size={14} weight="bold" />
        </button>
      )}
    </div>
  )
}

// ─── Status ──────────────────────────────────────────────────────────────────

export type AuthStatusTone = 'neutral' | 'success' | 'warning' | 'danger'

const STATUS_TILE: Record<AuthStatusTone, string> = {
  neutral: 'bg-neutral-100 text-neutral-600',
  success: 'bg-emerald-50 text-emerald-600',
  warning: 'bg-amber-50 text-amber-600',
  danger: 'bg-rose-50 text-rose-600',
}

/**
 * A centred state: icon tile, title, one sentence, then actions
 * ("Check your email", "Email verified", "Link expired").
 */
export function AuthStatus({
  icon,
  tone = 'neutral',
  loading = false,
  title,
  description,
  children,
}: {
  icon?: React.ReactNode
  tone?: AuthStatusTone
  loading?: boolean
  title: React.ReactNode
  description?: React.ReactNode
  children?: React.ReactNode
}) {
  return (
    <div className="flex flex-col items-center text-center" aria-busy={loading || undefined}>
      <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${STATUS_TILE[tone]}`} aria-hidden="true">
        {loading ? <CircleNotch size={22} className="animate-spin" /> : icon}
      </div>
      <h1 className="mt-4 text-lg font-semibold tracking-tight text-neutral-900">{title}</h1>
      {description && <div className="mt-1.5 text-sm text-neutral-500 leading-relaxed max-w-sm break-words">{description}</div>}
      {children && <div className="mt-6 w-full flex flex-col gap-2.5">{children}</div>}
    </div>
  )
}

// ─── Backdrop ────────────────────────────────────────────────────────────────

/**
 * The fine dot grid the dashboard home and sidebar footer use, fading out
 * from one edge. Decorative.
 */
export function AuthDots({ tone = 'dark', from = 'top', className = '' }: { tone?: 'dark' | 'light'; from?: 'top' | 'bottom'; className?: string }) {
  const dot = tone === 'dark' ? 'rgba(0,0,0,0.11)' : 'rgba(255,255,255,0.16)'
  const mask =
    from === 'top'
      ? 'radial-gradient(110% 100% at 50% 0%, black 0%, transparent 70%)'
      : 'radial-gradient(130% 100% at 50% 100%, black 0%, transparent 72%)'
  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none absolute inset-x-0 ${from === 'top' ? 'top-0' : 'bottom-0'} ${className}`}
      style={{
        backgroundImage: `radial-gradient(${dot} 1px, transparent 1.2px)`,
        backgroundSize: '14px 14px',
        backgroundPosition: from === 'top' ? 'center top' : 'center bottom',
        maskImage: mask,
        WebkitMaskImage: mask,
      }}
    />
  )
}

/**
 * Standalone auth screens with nothing to fill in (sign-in link, OAuth and
 * SSO callbacks, token exchange): a single card on the canvas.
 */
export function AuthStatusScreen({ children, wide = false }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <main className="lh-auth relative isolate min-h-dvh bg-[#f8f8f8] flex items-center justify-center px-4 py-10">
      <AuthDots className="h-80 -z-10" />
      <div className={`w-full ${wide ? 'max-w-lg' : 'max-w-sm'} bg-white rounded-2xl nice-shadow p-6 sm:p-8`}>{children}</div>
    </main>
  )
}
