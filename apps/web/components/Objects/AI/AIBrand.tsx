'use client'
import React from 'react'
import Image from 'next/image'
import { useTranslation } from 'react-i18next'
import { CircleNotch } from '@phosphor-icons/react'
import lrnaiIcon from 'public/lrnai_icon.png'
import aiAppIcon from 'public/learnhouse_ai_simple_colored.png'
import aiAvatar from 'public/ai_avatar.png'

// LearnHouse AI brand kit. Every AI feature wears the same mark and the same
// navy-to-violet gradient, so learners and authors can tell at a glance that
// something is AI-powered. The rest of the app keeps a very light relief; the
// gradient is the one exception, reserved for AI identity.
//
//   <AIMark />                       the logo on its gradient tile
//   <AIButton variant="solid">       the "Ask AI" gradient pill
//   <AIChip />                       a small "AI" label
//   aiSurface / <AISurfaceHeader>    tinted header + accent line for AI panels
//   <AIAvatar />                     the assistant's face in chat threads
//   <AIThinking /> / <AIShimmer />   loading states in brand colours

// ─── Brand tokens ────────────────────────────────────────────────────────────

/** The conic gradient of the original "Ask AI" pill and the "Start with AI" tile. */
export const AI_GRADIENT =
  'conic-gradient(from 32deg at 53.75% 50%, rgb(35, 40, 93) 4deg, rgba(20, 0, 52, 0.95) 59deg, rgba(164, 45, 238, 0.88) 281deg)'

/** A horizontal version for thin accents (lines, progress bars, text). */
export const AI_GRADIENT_LINEAR = 'linear-gradient(90deg, rgb(35, 40, 93) 0%, rgb(109, 40, 217) 55%, rgb(164, 45, 238) 100%)'

/** The midnight surface of the dark AI panels (editor AI, Magic Blocks, AI course modal). */
export const AI_DARK_SURFACE =
  'linear-gradient(0deg, rgba(0, 0, 0, 0.2) 0%, rgba(0, 0, 0, 0.2) 100%), radial-gradient(105.16% 105.16% at 50% -5.16%, rgba(255, 255, 255, 0.18) 0%, rgba(0, 0, 0, 0) 100%), rgb(2 1 25 / 98%)'

// Tailwind arbitrary-property twins of the tokens above, so class-only call
// sites (a <Link>, a className prop) get the same paint without a style prop.
const BG_AI_LINEAR = '[background:linear-gradient(90deg,rgb(35,40,93)_0%,rgb(109,40,217)_55%,rgb(164,45,238)_100%)]'
// Calm fill for buttons and chips: one soft violet ramp (no dark two-tone
// split like the conic tile), so the AI pill stays recognisable but quiet.
const BG_AI_SOFT_FILL = '[background:linear-gradient(180deg,rgb(139,92,246)_0%,rgb(124,58,237)_100%)]'

// ─── AIMark ──────────────────────────────────────────────────────────────────

export type AIMarkVariant = 'app' | 'tile' | 'plain'

type AIMarkProps = {
  /** Outer size in px. The source PNG is 160px, so it stays crisp up to ~64. */
  size?: number
  /**
   * app   – the LearnHouse AI logo (white "l" and star on the navy-to-violet
   *         rounded square). The default, on light and dark surfaces alike.
   * tile  – legacy alias of app.
   * plain – the bare white star, only for spots where the full logo can't fit.
   */
  variant?: AIMarkVariant
  /** Legacy, ignored: the logo carries its own rounded-square shape. */
  shape?: 'rounded' | 'circle'
  /** Legacy, ignored. Use `pulse` for loading states. */
  animated?: boolean
  /** Gentle breathing, for "AI is working" states. */
  pulse?: boolean
  className?: string
  /** Accessible name. Pass '' when a visible label already says "AI". */
  alt?: string
}

export function AIMark({ size = 20, variant = 'app', pulse = false, className = '', alt }: AIMarkProps) {
  const { t } = useTranslation()
  const label = alt ?? t('ai_brand.mark_alt')
  return (
    <Image
      src={variant === 'plain' ? lrnaiIcon : aiAppIcon}
      alt={label}
      width={size}
      height={size}
      draggable={false}
      className={`shrink-0 select-none ${pulse ? 'animate-pulse' : ''} ${className}`}
      style={{ width: size, height: size }}
    />
  )
}

/**
 * The mark with Phosphor-shaped props, for icon maps that store a component
 * (search entries, plan highlights, tab lists): <Icon size={16} />.
 */
export function AIMarkIcon({ size = 16, className = '' }: { size?: number | string; className?: string; weight?: string }) {
  const px = typeof size === 'number' ? size : parseInt(size, 10) || 16
  return <AIMark size={px} alt="" className={className} />
}

// ─── AIButton ────────────────────────────────────────────────────────────────

export type AIButtonVariant = 'solid' | 'soft' | 'outline'
export type AIButtonSize = 'sm' | 'md' | 'lg'

const AI_BTN_BASE =
  'inline-flex items-center justify-center font-semibold whitespace-nowrap select-none rounded-lg transition-[filter,background-color,box-shadow,color] duration-150 active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/40 focus-visible:ring-offset-2'

const AI_BTN_VARIANTS: Record<AIButtonVariant, string> = {
  // The Ask AI pill: a single soft violet ramp, white label, a 1px inner
  // ring and a soft shadow. Kept as the one gradient button in the app.
  solid: `text-white ${BG_AI_SOFT_FILL} ring-1 ring-inset ring-white/15 shadow-[0_1px_2px_rgba(91,33,182,0.22)] hover:brightness-[1.06] hover:shadow-[0_2px_6px_-1px_rgba(91,33,182,0.3)]`,
  // Quieter: violet tint with the gradient tile mark. For secondary AI actions.
  soft: 'text-violet-900 bg-violet-50 ring-1 ring-inset ring-violet-600/15 hover:bg-violet-100/70',
  // Matches DashKit's secondary button, with the AI mark for identity.
  outline:
    'text-neutral-700 bg-white shadow-[0_1px_1px_rgba(0,0,0,0.03),0_0_0_1px_rgba(0,0,0,0.07)] hover:text-neutral-900 hover:bg-neutral-50',
}

const AI_BTN_SIZES: Record<AIButtonSize, string> = {
  sm: 'h-7 ps-2 pe-3 gap-1.5 text-xs',
  md: 'h-8 ps-2.5 pe-3.5 gap-1.5 text-[13px]',
  lg: 'h-9 ps-3 pe-4 gap-2 text-sm',
}

const AI_BTN_MARK: Record<AIButtonSize, number> = { sm: 14, md: 16, lg: 18 }

/** Class recipe for links and other non-button elements styled as an AI button. */
export function aiButtonClass(variant: AIButtonVariant = 'solid', size: AIButtonSize = 'md', extra = '') {
  return `${AI_BTN_BASE} ${AI_BTN_VARIANTS[variant]} ${AI_BTN_SIZES[size]} ${extra}`
}

/** The mark that belongs inside an AI button of a given variant and size. */
export function AIButtonMark({ variant = 'solid', size = 'md' }: { variant?: AIButtonVariant; size?: AIButtonSize }) {
  const px = AI_BTN_MARK[size]
  // The real logo on every variant; on the violet pill a hairline ring keeps
  // its edge from melting into the fill.
  return <AIMark size={px} alt="" className={variant === 'solid' ? 'rounded-[5px] ring-1 ring-white/25' : ''} />
}

type AIButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: AIButtonVariant
  size?: AIButtonSize
  /** Replaces the AI mark. Pass null to show the label only. */
  icon?: React.ReactNode | null
  loading?: boolean
}

export const AIButton = React.forwardRef<HTMLButtonElement, AIButtonProps>(function AIButton(
  { variant = 'solid', size = 'md', icon, loading, className = '', children, disabled, type = 'button', ...rest },
  ref
) {
  const px = AI_BTN_MARK[size]
  const lead = loading ? (
    <span className="inline-flex items-center justify-center shrink-0" style={{ width: px, height: px }}>
      <CircleNotch size={Math.round(px * 0.8)} className="animate-spin" />
    </span>
  ) : icon === undefined ? (
    <AIButtonMark variant={variant} size={size} />
  ) : (
    icon
  )
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={aiButtonClass(variant, size, `${!lead ? 'ps-3' : ''} ${className}`)}
      {...rest}
    >
      {lead}
      {children}
    </button>
  )
})

// ─── AIChip ──────────────────────────────────────────────────────────────────

/** A small "AI" label for menus, cards and headings. */
export function AIChip({
  tone = 'solid',
  children,
  className = '',
  title,
}: {
  tone?: 'solid' | 'soft'
  children?: React.ReactNode
  className?: string
  title?: string
}) {
  const { t } = useTranslation()
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 h-5 ps-1 pe-1.5 rounded-full text-[10px] font-bold uppercase tracking-wide whitespace-nowrap ring-1 ring-inset ${
        tone === 'solid' ? `text-white ${BG_AI_SOFT_FILL} ring-white/15` : 'text-violet-800 bg-violet-50 ring-violet-600/15'
      } ${className}`}
    >
      <AIMark size={12} alt="" className="rounded-[3px]" />
      {children ?? t('ai_brand.badge')}
    </span>
  )
}

// ─── Surfaces ────────────────────────────────────────────────────────────────

/**
 * Class recipes for light AI panels and drawers. Dark panels keep using
 * AI_DARK_SURFACE (as a style background) with the same accent line.
 */
export const aiSurface = {
  /** White card that holds an AI tool. */
  panel: 'bg-white rounded-2xl nice-shadow overflow-hidden',
  /** Soft violet wash for the top of an AI panel or modal body. */
  header: 'bg-gradient-to-b from-violet-50/80 to-white',
  /** 2px brand-gradient line along the top edge of an AI panel. */
  accent: `h-0.5 w-full ${BG_AI_LINEAR}`,
  /** Tinted callout inside an AI panel (tips, context, previews). */
  tint: 'bg-violet-50/60 ring-1 ring-inset ring-violet-600/10 rounded-xl',
  /** Prompt box: white field that glows violet on focus. */
  prompt:
    'rounded-2xl bg-white ring-1 ring-inset ring-neutral-200 focus-within:ring-2 focus-within:ring-violet-500/30 transition-shadow',
  /** Gradient text for an AI heading word. */
  text: `bg-clip-text text-transparent ${BG_AI_LINEAR}`,
} as const

/** Gradient accent line, for the top edge of AI panels (light or dark). */
export function AIAccentLine({ className = '' }: { className?: string }) {
  return <div aria-hidden="true" className={`${aiSurface.accent} ${className}`} />
}

/**
 * Header for a light AI panel or drawer: accent line, violet wash, the mark,
 * a title and a one-line description, with optional trailing actions.
 */
export function AISurfaceHeader({
  title,
  description,
  actions,
  className = '',
}: {
  title: React.ReactNode
  description?: React.ReactNode
  actions?: React.ReactNode
  className?: string
}) {
  return (
    <div className={`shrink-0 ${className}`}>
      <AIAccentLine />
      <div className={`flex items-center gap-3 px-4 py-3 ${aiSurface.header}`}>
        <AIMark size={28} alt="" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-neutral-900 truncate">{title}</div>
          {description && <div className="text-xs text-neutral-500 truncate">{description}</div>}
        </div>
        {actions && <div className="flex items-center gap-1.5 shrink-0">{actions}</div>}
      </div>
    </div>
  )
}

/** The assistant's avatar for AI messages in a chat thread. */
export function AIAvatar({ size = 28, className = '' }: { size?: number; className?: string }) {
  const { t } = useTranslation()
  return (
    <Image
      src={aiAvatar}
      alt={t('ai_brand.mark_alt')}
      width={size}
      height={size}
      draggable={false}
      className={`shrink-0 select-none ring-1 ring-inset ring-black/5 ${className}`}
      style={{ width: size, height: size, borderRadius: Math.max(6, Math.round(size * 0.27)) }}
    />
  )
}

// ─── Loading states ──────────────────────────────────────────────────────────

/**
 * "AI is thinking" indicator: three brand-violet dots breathing in turn,
 * with an optional label. tone="dark" for the midnight panels.
 */
export function AIThinking({
  label,
  tone = 'light',
  showLabel = true,
  className = '',
}: {
  /** Overrides the default "AI is thinking…" text. */
  label?: React.ReactNode
  tone?: 'light' | 'dark'
  showLabel?: boolean
  className?: string
}) {
  const { t } = useTranslation()
  const text = label ?? t('ai_brand.thinking')
  const dot = tone === 'dark' ? 'bg-violet-300' : 'bg-violet-500'
  return (
    <span role="status" aria-live="polite" className={`inline-flex items-center gap-2 ${className}`}>
      <span className="inline-flex items-center gap-1" aria-hidden="true">
        {[0, 160, 320].map((delay) => (
          <span
            key={delay}
            className={`w-1.5 h-1.5 rounded-full ${dot} animate-pulse`}
            style={{ animationDelay: `${delay}ms`, animationDuration: '1.2s' }}
          />
        ))}
      </span>
      {showLabel ? (
        <span className={`text-xs font-medium ${tone === 'dark' ? 'text-white/60' : 'text-violet-700/80'}`}>{text}</span>
      ) : (
        <span className="sr-only">{text}</span>
      )}
    </span>
  )
}

/** Skeleton lines with a violet shimmer, for content an AI is writing. */
export function AIShimmer({ lines = 3, tone = 'light', className = '' }: { lines?: number; tone?: 'light' | 'dark'; className?: string }) {
  const base = tone === 'dark' ? 'bg-white/[0.06]' : 'bg-violet-50'
  const sweep = tone === 'dark' ? 'via-violet-300/15' : 'via-violet-200/70'
  return (
    <div className={`flex flex-col gap-2 ${className}`} aria-hidden="true">
      {Array.from({ length: lines }).map((_, i) => (
        <div
          key={i}
          className={`relative h-3 rounded-full overflow-hidden ${base}`}
          style={{ width: i === lines - 1 && lines > 1 ? '60%' : '100%' }}
        >
          <div className={`absolute inset-0 animate-shimmer bg-gradient-to-r from-transparent ${sweep} to-transparent`} />
        </div>
      ))}
    </div>
  )
}
