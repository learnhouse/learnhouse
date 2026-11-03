'use client'
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Clock,
  CloudOff,
  Copy,
  CopyX,
  CreditCard,
  FileWarning,
  Hourglass,
  KeyRound,
  Lock,
  type LucideIcon,
  SearchX,
  ServerCrash,
  Sparkles,
  UploadCloud,
  WandSparkles,
  WifiOff,
  Wrench,
} from 'lucide-react'
import React, { useState } from 'react'

// Presentation only: no router, no auth, no i18n. That's what lets the root
// `global-error` boundary (which renders outside every provider) share the
// exact same screen as the in-app boundaries.

type Tone = 'rose' | 'amber' | 'sky' | 'violet' | 'slate'

const TONES: Record<Tone, { tile: string; icon: string; glow: string }> = {
  rose: { tile: 'bg-rose-50 ring-rose-100', icon: 'text-rose-600', glow: 'from-rose-100/70' },
  amber: { tile: 'bg-amber-50 ring-amber-100', icon: 'text-amber-600', glow: 'from-amber-100/70' },
  sky: { tile: 'bg-sky-50 ring-sky-100', icon: 'text-sky-600', glow: 'from-sky-100/70' },
  violet: { tile: 'bg-violet-50 ring-violet-100', icon: 'text-violet-600', glow: 'from-violet-100/70' },
  slate: { tile: 'bg-gray-50 ring-gray-200/70', icon: 'text-gray-600', glow: 'from-gray-200/60' },
}

// Icon and colour per catalog kind. Warm tones for "something broke", cool
// ones for "nothing's wrong, just do this", so the screen reads at a glance.
const LOOKS: Record<string, { icon: LucideIcon; tone: Tone }> = {
  version_mismatch: { icon: Sparkles, tone: 'violet' },
  chunk_load: { icon: Sparkles, tone: 'violet' },
  auth_session: { icon: KeyRound, tone: 'sky' },
  plan_limit: { icon: Lock, tone: 'violet' },
  permission: { icon: Lock, tone: 'slate' },
  rate_limit: { icon: Hourglass, tone: 'amber' },
  not_found: { icon: SearchX, tone: 'slate' },
  conflict: { icon: CopyX, tone: 'amber' },
  validation: { icon: FileWarning, tone: 'amber' },
  org_config: { icon: Wrench, tone: 'slate' },
  payment: { icon: CreditCard, tone: 'amber' },
  upload: { icon: UploadCloud, tone: 'amber' },
  ai: { icon: WandSparkles, tone: 'violet' },
  offline: { icon: WifiOff, tone: 'sky' },
  service_unavailable: { icon: CloudOff, tone: 'amber' },
  timeout: { icon: Clock, tone: 'amber' },
  server: { icon: ServerCrash, tone: 'rose' },
}
const DEFAULT_LOOK = { icon: AlertTriangle, tone: 'rose' as Tone }

export function lookFor(kind?: string) {
  return (kind && LOOKS[kind]) || DEFAULT_LOOK
}

type ButtonVariant = 'primary' | 'secondary' | 'subtle'

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-black text-white hover:bg-gray-800 shadow-sm',
  secondary: 'bg-white text-gray-800 ring-1 ring-gray-200 hover:bg-gray-50 hover:ring-gray-300',
  subtle: 'text-gray-500 hover:text-gray-900 hover:bg-gray-100',
}

export function ErrorButton({
  onClick,
  href,
  icon,
  label,
  variant = 'secondary',
  disabled,
}: {
  onClick?: () => void
  href?: string
  icon?: React.ReactNode
  label: string
  variant?: ButtonVariant
  disabled?: boolean
}) {
  const cls = `inline-flex items-center justify-center gap-2 h-10 px-4 rounded-xl text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-900/20 ${BUTTON_VARIANTS[variant]}`
  if (href) {
    return (
      <a href={href} className={cls}>
        {icon}
        <span>{label}</span>
      </a>
    )
  }
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={cls}>
      {icon}
      <span>{label}</span>
    </button>
  )
}

/**
 * Lays out recovery actions: the ones that fix things as buttons, the escape
 * hatches (report, sign out, support) as a quieter row underneath.
 */
export function ErrorActionRows({ main, quiet }: { main: React.ReactNode[]; quiet?: React.ReactNode[] }) {
  const mainItems = main.filter(Boolean)
  const quietItems = (quiet ?? []).filter(Boolean)
  return (
    <div className="flex flex-col items-center gap-3">
      {mainItems.length > 0 && <div className="flex flex-wrap items-center justify-center gap-2">{mainItems}</div>}
      {quietItems.length > 0 && <div className="flex flex-wrap items-center justify-center gap-1">{quietItems}</div>}
    </div>
  )
}

/** Collapsible technical details with a one-click copy for support tickets. */
export function ErrorDetails({ rows }: { rows: [string, React.ReactNode][] }) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const present = rows.filter(([, value]) => value !== undefined && value !== null && value !== '')
  if (present.length === 0) return null

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(present.map(([k, v]) => `${k}: ${v}`).join('\n'))
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      // Clipboard blocked (insecure context, iframe): the text is still selectable.
    }
  }

  return (
    <div className="w-full border-t border-gray-100 pt-3">
      <div className={`flex items-center gap-2 ${open ? 'justify-between' : 'justify-center'}`}>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="inline-flex items-center gap-1 text-xs font-medium text-gray-400 hover:text-gray-700 transition-colors"
        >
          <ChevronDown size={14} className={`transition-transform ${open ? '' : '-rotate-90 rtl:rotate-90'}`} />
          <span>Technical details</span>
        </button>
        {open && (
          <button
            type="button"
            onClick={copy}
            className="inline-flex items-center gap-1 text-xs font-medium text-gray-400 hover:text-gray-700 transition-colors"
          >
            {copied ? <Check size={13} /> : <Copy size={13} />}
            <span>{copied ? 'Copied' : 'Copy'}</span>
          </button>
        )}
      </div>
      {open && (
        <dl className="mt-2.5 rounded-xl bg-gray-50 ring-1 ring-gray-100 px-3.5 py-3 text-start text-[11px] font-mono text-gray-600 space-y-1.5">
          {present.map(([label, value]) => (
            <div key={label} className="flex gap-3">
              <dt className="w-12 shrink-0 text-gray-400">{label}</dt>
              <dd className="min-w-0 break-all select-all">{value}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  )
}

/**
 * The error screen itself: a soft card with a category icon, a plain-language
 * headline and explanation, the recovery actions, and the details tucked away.
 */
export default function ErrorShell({
  kind,
  title,
  description,
  actions,
  details,
  children,
  compact,
  flush,
}: {
  kind?: string
  title: string
  description: string
  actions?: React.ReactNode
  details?: React.ReactNode
  /** Extra content between the explanation and the actions. */
  children?: React.ReactNode
  compact?: boolean
  /** Drop the outer spacing when the page around it handles layout. */
  flush?: boolean
}) {
  const { icon: Icon, tone } = lookFor(kind)
  const t = TONES[tone]

  return (
    <div className={`w-full flex justify-center antialiased ${flush ? '' : compact ? 'py-6 px-4' : 'py-16 sm:py-24 px-4'}`}>
      <div
        role="alert"
        className={`relative w-full overflow-hidden bg-white rounded-2xl nice-shadow ${compact ? 'max-w-md' : 'max-w-lg'}`}
      >
        {/* Soft colour wash behind the icon, keyed to the category. */}
        <div
          aria-hidden
          className={`pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b ${t.glow} to-transparent`}
        />
        <div className={`relative flex flex-col items-center text-center ${compact ? 'p-6 gap-4' : 'p-8 sm:p-10 gap-5'}`}>
          <div className={`flex items-center justify-center rounded-2xl ring-1 ${t.tile} ${compact ? 'w-12 h-12' : 'w-14 h-14'}`}>
            <Icon className={t.icon} size={compact ? 22 : 26} strokeWidth={2} />
          </div>

          <div className="flex flex-col gap-2">
            <h2 className={`font-bold tracking-tight text-gray-900 ${compact ? 'text-lg' : 'text-xl sm:text-2xl'}`}>
              {title}
            </h2>
            <p className={`text-gray-500 leading-relaxed max-w-sm mx-auto ${compact ? 'text-sm' : 'text-[15px]'}`}>
              {description}
            </p>
          </div>

          {children}
          {actions && <div className="pt-1">{actions}</div>}
          {details}
        </div>
      </div>
    </div>
  )
}
