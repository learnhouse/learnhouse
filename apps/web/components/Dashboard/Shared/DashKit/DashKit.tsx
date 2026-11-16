'use client'
import React from 'react'
import { buttonClass, type ButtonSize, type ButtonVariant } from './buttons'
import { useTranslation } from 'react-i18next'
import { Warning, CaretDown, CaretRight, Info, SquaresFour, ListBullets, CircleNotch, MagnifyingGlass, X } from '@phosphor-icons/react'
import { Breadcrumbs } from '@components/Objects/Breadcrumbs/Breadcrumbs'
import Modal from '@components/Objects/StyledElements/Modal/Modal'
import AskAtlasButton from '@ee/components/Atlas/AskAtlasButton'

// The dashboard look first built for assignments, shared so every dashboard
// page reads as one set: soft white cards, neutral greys, rounded-xl
// controls at h-10.
//
// Buttons carry a very light relief (a hairline ring, a 1px shadow and, on
// dark fills, a faint top highlight) so they read as pressable without looking
// raised. Use <Button> where you can; the BTN_* strings are the same recipes
// for links and older call sites.

export { buttonClass }
export type { ButtonSize, ButtonVariant }

export const BTN_PRIMARY = buttonClass('primary', 'md')
export const BTN_SECONDARY = buttonClass('secondary', 'md')
// Kept for existing callers: the raised white button.
export const BTN_GHOST = buttonClass('secondary', 'md')
export const BTN_PRIMARY_SM = buttonClass('primary', 'sm')
export const BTN_SECONDARY_SM = buttonClass('secondary', 'sm')
export const BTN_DANGER = buttonClass('danger', 'md')

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  size?: ButtonSize
  icon?: React.ReactNode
  loading?: boolean
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', icon, loading, className = '', children, disabled, type = 'button', ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={buttonClass(variant, size, className)}
      {...rest}
    >
      {loading ? <CircleNotch size={size === 'sm' ? 12 : 14} className="animate-spin" /> : icon}
      {children}
    </button>
  )
})

export const INPUT =
  'w-full h-9 px-3 text-sm bg-white rounded-xl ring-1 ring-inset ring-neutral-200 focus:outline-none focus:ring-2 focus:ring-neutral-900/15 placeholder:text-neutral-400 transition-shadow'
export const TEXTAREA =
  'w-full px-3 py-2 text-sm bg-white rounded-xl ring-1 ring-inset ring-neutral-200 focus:outline-none focus:ring-2 focus:ring-neutral-900/15 placeholder:text-neutral-400 transition-shadow resize-none'

export type ChipTone = 'neutral' | 'amber' | 'emerald' | 'rose' | 'sky' | 'violet'

// Labels: a flat tint with a hairline ring in the same hue.
const CHIP_TONES: Record<ChipTone, string> = {
  neutral: 'text-neutral-600 bg-neutral-100/80 ring-neutral-900/5',
  amber: 'text-amber-800 bg-amber-50 ring-amber-600/10',
  emerald: 'text-emerald-800 bg-emerald-50 ring-emerald-600/10',
  rose: 'text-rose-700 bg-rose-50 ring-rose-600/10',
  sky: 'text-sky-800 bg-sky-50 ring-sky-600/10',
  violet: 'text-violet-800 bg-violet-50 ring-violet-600/10',
}

export function Chip({
  tone = 'neutral',
  icon,
  children,
  className = '',
  title,
}: {
  tone?: ChipTone
  icon?: React.ReactNode
  children: React.ReactNode
  className?: string
  title?: string
}) {
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold whitespace-nowrap ring-1 ring-inset ${CHIP_TONES[tone]} ${className}`}
    >
      {icon}
      {children}
    </span>
  )
}

export function DashPageHeader({
  breadcrumbs,
  title,
  subtitle,
  actions,
  atlas = true,
}: {
  breadcrumbs: { label: string; href: string; icon?: React.ReactNode }[]
  title: React.ReactNode
  subtitle?: React.ReactNode
  actions?: React.ReactNode
  /** Show "Ask Atlas" with questions for this page (EE, Pro plan). */
  atlas?: boolean
}) {
  const ask = atlas ? <AskAtlasButton pageTitle={typeof title === 'string' ? title : undefined} /> : null
  return (
    <div className="flex flex-col gap-4 pt-4 sm:pt-6">
      <Breadcrumbs items={breadcrumbs} />
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-neutral-900">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-neutral-500">{subtitle}</p>}
        </div>
        {(actions || ask) && (
          <div className="flex flex-wrap items-center gap-2">
            {ask}
            {actions}
          </div>
        )}
      </div>
    </div>
  )
}

export function StatCard({
  icon,
  iconClass,
  label,
  value,
  active,
  onClick,
}: {
  icon: React.ReactNode
  iconClass: string
  label: string
  value: number | string | null
  active?: boolean
  onClick?: () => void
}) {
  const body = (
    <>
      <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${iconClass}`}>{icon}</div>
      <div className="min-w-0 text-start">
        <p className="text-xs text-neutral-500 truncate">{label}</p>
        {value === null ? (
          <div className="mt-1 h-5 w-8 rounded bg-neutral-100 animate-pulse" />
        ) : (
          <p className="text-xl font-bold text-neutral-900 tabular-nums leading-tight">{value}</p>
        )}
      </div>
    </>
  )
  const base = 'flex items-center gap-3 bg-white nice-shadow rounded-2xl px-4 py-3.5 min-w-0'
  if (!onClick) return <div className={base}>{body}</div>
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`${base} transition-shadow hover:ring-1 hover:ring-neutral-200 ${active ? 'ring-2 ring-neutral-900/80' : ''}`}
    >
      {body}
    </button>
  )
}

// Search box with a "/" shortcut, the way most list UIs focus their filter.
export function SearchInput({
  value,
  onChange,
  placeholder,
  className = '',
}: {
  value: string
  onChange: (value: string) => void
  placeholder: string
  className?: string
}) {
  const { t } = useTranslation()
  const ref = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return
      const target = e.target as HTMLElement | null
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return
      e.preventDefault()
      ref.current?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className={`relative flex-1 min-w-0 ${className}`}>
      <MagnifyingGlass size={16} className="absolute start-3.5 top-1/2 -translate-y-1/2 text-neutral-400" />
      <input
        ref={ref}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            onChange('')
            ref.current?.blur()
          }
        }}
        placeholder={placeholder}
        className="w-full h-9 ps-10 pe-9 text-sm bg-white nice-shadow rounded-xl focus:outline-none focus:ring-2 focus:ring-neutral-900/10 placeholder:text-neutral-400"
      />
      {value ? (
        <button
          type="button"
          onClick={() => onChange('')}
          className="absolute end-3 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600"
          aria-label={t('dashboard.kit.clear_search')}
        >
          <X size={14} />
        </button>
      ) : (
        <kbd className="hidden sm:flex absolute end-3 top-1/2 -translate-y-1/2 h-5 min-w-5 px-1.5 items-center justify-center rounded-md bg-neutral-100 text-[10px] font-semibold text-neutral-400 pointer-events-none">
          /
        </kbd>
      )}
    </div>
  )
}

export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T
  options: { key: T; label: React.ReactNode; count?: number }[]
  onChange: (value: T) => void
  ariaLabel?: string
}) {
  return (
    <div className="inline-flex items-center rounded-xl bg-neutral-200/60 p-1" role="tablist" aria-label={ariaLabel}>
      {options.map((opt) => (
        <button
          key={opt.key}
          type="button"
          role="tab"
          aria-selected={value === opt.key}
          onClick={() => onChange(opt.key)}
          className={`inline-flex items-center gap-1.5 h-7 px-2.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
            value === opt.key ? 'bg-white text-neutral-900 shadow-[0_1px_2px_rgba(0,0,0,0.08),0_0_0_1px_rgba(0,0,0,0.06)]' : 'text-neutral-500 hover:text-neutral-800'
          }`}
        >
          {opt.label}
          {opt.count !== undefined && (
            <span className={`tabular-nums ${value === opt.key ? 'text-neutral-400' : 'text-neutral-400/80'}`}>{opt.count}</span>
          )}
        </button>
      ))}
    </div>
  )
}

export function ToolbarSelect({
  value,
  onChange,
  options,
  ariaLabel,
  icon,
}: {
  value: string
  onChange: (value: string) => void
  options: { value: string; label: string }[]
  ariaLabel: string
  icon?: React.ReactNode
}) {
  return (
    <div className="relative min-w-0">
      {icon && (
        <span className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-neutral-400">{icon}</span>
      )}
      <select
        // A value that matches no option (a stale saved filter, options still
        // loading) makes the browser render an empty box; show the first
        // option instead.
        value={options.some((opt) => opt.value === value) ? value : options[0]?.value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        aria-label={ariaLabel}
        className={`appearance-none h-9 ${icon ? 'ps-8' : 'ps-3'} pe-8 max-w-[220px] truncate rounded-xl bg-white nice-shadow text-xs font-semibold text-neutral-700 focus:outline-none focus:ring-2 focus:ring-neutral-900/10 cursor-pointer`}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      <CaretDown size={14} className="pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 text-neutral-400" />
    </div>
  )
}

export type ViewMode = 'grid' | 'list'

export function ViewToggle({ value, onChange }: { value: ViewMode; onChange: (value: ViewMode) => void }) {
  const { t } = useTranslation()
  const options: { key: ViewMode; Icon: typeof SquaresFour; label: string }[] = [
    { key: 'grid', Icon: SquaresFour, label: t('dashboard.kit.grid_view') },
    { key: 'list', Icon: ListBullets, label: t('dashboard.kit.list_view') },
  ]
  return (
    <div className="inline-flex items-center rounded-xl bg-neutral-200/60 p-1">
      {options.map(({ key, Icon, label }) => (
        <button
          key={key}
          type="button"
          onClick={() => onChange(key)}
          aria-pressed={value === key}
          aria-label={label}
          title={label}
          className={`h-7 w-7 inline-flex items-center justify-center rounded-lg transition-colors ${
            value === key ? 'bg-white text-neutral-900 shadow-[0_1px_2px_rgba(0,0,0,0.08),0_0_0_1px_rgba(0,0,0,0.06)]' : 'text-neutral-500 hover:text-neutral-800'
          }`}
        >
          <Icon size={15} />
        </button>
      ))}
    </div>
  )
}

// A per-browser preference (view mode, sort). Storage can be blocked, so
// every access is guarded and the default wins. Without `allowed`, any
// stored string is accepted.
export function useStoredState<T extends string>(key: string, fallback: T, allowed?: readonly T[]) {
  const [value, setValue] = React.useState<T>(fallback)
  React.useEffect(() => {
    try {
      const stored = window.localStorage.getItem(key) as T | null
      if (stored && (!allowed || allowed.includes(stored))) setValue(stored)
    } catch {
      // ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  const update = React.useCallback(
    (next: T) => {
      setValue(next)
      try {
        window.localStorage.setItem(key, next)
      } catch {
        // ignore
      }
    },
    [key]
  )
  return [value, update] as const
}

export function EmptyState({
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
    <div className="flex flex-col items-center justify-center text-center py-16 px-6 gap-3">
      <div className="w-12 h-12 rounded-2xl bg-neutral-100 text-neutral-400 flex items-center justify-center">{icon}</div>
      <div>
        <p className="text-base font-semibold text-neutral-900">{title}</p>
        {description && <p className="mt-1 text-sm text-neutral-500 max-w-sm">{description}</p>}
      </div>
      {action}
    </div>
  )
}

// Floating bar for actions on a selection, docked to the bottom of the view.
export function BulkActionBar({
  count,
  label,
  onClear,
  children,
}: {
  count: number
  label: string
  onClear: () => void
  children: React.ReactNode
}) {
  const { t } = useTranslation()
  if (count === 0) return null
  return (
    <div className="fixed bottom-5 inset-x-0 z-40 flex justify-center px-4 pointer-events-none">
      <div className="pointer-events-auto flex flex-wrap items-center gap-1.5 max-w-full rounded-2xl bg-neutral-900 text-white shadow-2xl ring-1 ring-black/10 ps-4 pe-2 py-2 animate-in fade-in slide-in-from-bottom-3 duration-200">
        <span className="text-sm font-semibold tabular-nums pe-2">{label}</span>
        <span className="w-px h-5 bg-white/15 me-1" />
        {children}
        <button
          type="button"
          onClick={onClear}
          aria-label={t('dashboard.kit.clear_selection')}
          title={t('dashboard.kit.clear_selection')}
          className="h-8 w-8 inline-flex items-center justify-center rounded-lg text-white/60 hover:text-white hover:bg-white/10 transition-colors"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  )
}

export function BulkActionButton({
  icon,
  label,
  onClick,
  danger,
}: {
  icon: React.ReactNode
  label: string
  onClick?: () => void
  danger?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
        danger ? 'text-rose-300 hover:text-white hover:bg-rose-500/80' : 'text-white/80 hover:text-white hover:bg-white/10'
      }`}
    >
      {icon}
      {label}
    </button>
  )
}

// One row in a "pick how to start" modal: icon tile, title, blurb, chevron.
export function OptionCard({
  icon,
  iconClass,
  title,
  description,
  badge,
  onClick,
  disabled,
}: {
  icon: React.ReactNode
  iconClass: string
  title: string
  description: string
  badge?: React.ReactNode
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={() => !disabled && onClick()}
      disabled={disabled}
      className={`group w-full flex items-center gap-4 rounded-2xl border px-4 py-4 text-start transition-all ${
        disabled
          ? 'border-neutral-100 bg-neutral-50 cursor-not-allowed'
          : 'border-neutral-200/70 bg-white hover:border-neutral-300 hover:shadow-md hover:-translate-y-px'
      }`}
    >
      <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${disabled ? 'bg-neutral-100 text-neutral-400' : iconClass}`}>
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className={`text-sm font-semibold ${disabled ? 'text-neutral-400' : 'text-neutral-900'}`}>{title}</span>
          {badge}
        </div>
        <p className={`mt-0.5 text-xs leading-relaxed ${disabled ? 'text-neutral-400' : 'text-neutral-500'}`}>{description}</p>
      </div>
      <CaretRight
        size={16}
        className={`shrink-0 rtl:rotate-180 transition-transform ${disabled ? 'text-neutral-200' : 'text-neutral-300 group-hover:text-neutral-500 group-hover:translate-x-0.5 rtl:group-hover:-translate-x-0.5'}`}
      />
    </button>
  )
}

// Big tappable choice used for visibility and similar either/or settings.
export function ChoiceCard({
  selected,
  onClick,
  icon,
  title,
  description,
}: {
  selected: boolean
  onClick: () => void
  icon: React.ReactNode
  title: string
  description: string
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onClick}
      className={`flex items-start gap-3 rounded-xl px-3.5 py-3 text-start transition-all ${
        selected ? 'bg-white ring-2 ring-neutral-900 shadow-sm' : 'bg-white ring-1 ring-inset ring-neutral-200 hover:ring-neutral-300'
      }`}
    >
      <span className={`mt-0.5 shrink-0 ${selected ? 'text-neutral-900' : 'text-neutral-400'}`}>{icon}</span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-neutral-900">{title}</span>
        <span className="block text-xs text-neutral-500 mt-0.5">{description}</span>
      </span>
    </button>
  )
}

export function FieldLabel({ children, hint, error }: { children: React.ReactNode; hint?: React.ReactNode; error?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 mb-1.5">
      <span className="text-sm font-semibold text-neutral-800">{children}</span>
      {error ? (
        <span className="text-xs font-medium text-rose-600">{error}</span>
      ) : (
        hint && <span className="text-xs text-neutral-400">{hint}</span>
      )}
    </div>
  )
}

// "3 min ago" style dates for list rows, falling back to a short date.
export function formatRelative(value: string | null | undefined, locale: string): string | null {
  if (!value) return null
  const date = new Date(value)
  const time = date.getTime()
  if (isNaN(time)) return null
  const seconds = Math.round((time - Date.now()) / 1000)
  const abs = Math.abs(seconds)
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  if (abs < 60) return rtf.format(seconds, 'second')
  if (abs < 3600) return rtf.format(Math.round(seconds / 60), 'minute')
  if (abs < 86400) return rtf.format(Math.round(seconds / 3600), 'hour')
  if (abs < 86400 * 30) return rtf.format(Math.round(seconds / 86400), 'day')
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(date)
}

// ---------- editor building blocks (course + path editors) ----------

// A settings section: white card, title row with optional icon and actions,
// then the body. Editors stack these instead of grey header bars.
export function SectionCard({
  title,
  description,
  icon,
  actions,
  children,
  className = '',
  bodyClassName = 'p-5',
}: {
  title?: React.ReactNode
  description?: React.ReactNode
  icon?: React.ReactNode
  actions?: React.ReactNode
  children?: React.ReactNode
  className?: string
  bodyClassName?: string
}) {
  return (
    <section className={`bg-white rounded-2xl nice-shadow ${className}`}>
      {(title || actions) && (
        <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-5">
          <div className="flex items-start gap-3 min-w-0">
            {icon && (
              <div className="w-9 h-9 rounded-xl bg-neutral-100 text-neutral-600 flex items-center justify-center shrink-0">{icon}</div>
            )}
            <div className="min-w-0">
              {title && <h2 className="text-base font-semibold text-neutral-900 leading-tight">{title}</h2>}
              {description && <p className="mt-0.5 text-sm text-neutral-500">{description}</p>}
            </div>
          </div>
          {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
        </div>
      )}
      {children && <div className={bodyClassName}>{children}</div>}
    </section>
  )
}

// One setting line: label + hint on the start side, control on the end side.
export function SettingRow({
  title,
  description,
  control,
  icon,
}: {
  title: React.ReactNode
  description?: React.ReactNode
  control: React.ReactNode
  icon?: React.ReactNode
}) {
  return (
    <div className="flex items-start justify-between gap-6 py-4 first:pt-0 last:pb-0">
      <div className="flex items-start gap-3 min-w-0">
        {icon && <span className="mt-0.5 text-neutral-400 shrink-0">{icon}</span>}
        <div className="min-w-0">
          <div className="text-sm font-semibold text-neutral-900">{title}</div>
          {description && <p className="text-xs text-neutral-500 mt-0.5 max-w-xl">{description}</p>}
        </div>
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  )
}

// Docked bar that appears while a form has unsaved edits.
export function StickySaveBar({
  visible,
  saving,
  onSave,
  onDiscard,
  saveLabel,
  disabled,
}: {
  visible: boolean
  saving?: boolean
  onSave: () => void
  onDiscard?: () => void
  saveLabel?: string
  disabled?: boolean
}) {
  const { t } = useTranslation()
  if (!visible) return null
  return (
    <div className="sticky bottom-4 z-30 flex justify-center px-4 mt-6 pointer-events-none">
      <div className="pointer-events-auto flex items-center gap-3 rounded-2xl bg-neutral-900 text-white shadow-2xl ps-4 pe-2 py-2 animate-in fade-in slide-in-from-bottom-3 duration-200">
        <span className="flex items-center gap-2 text-sm font-medium">
          <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
          {t('dashboard.kit.unsaved_changes')}
        </span>
        {onDiscard && (
          <button
            type="button"
            onClick={onDiscard}
            disabled={saving}
            className="h-8 px-3 rounded-lg text-xs font-semibold text-white/70 hover:text-white hover:bg-white/10 transition-colors"
          >
            {t('dashboard.kit.discard')}
          </button>
        )}
        <button
          type="button"
          onClick={onSave}
          disabled={saving || disabled}
          className="h-8 px-4 rounded-lg bg-white text-neutral-900 text-xs font-semibold hover:bg-neutral-100 transition-colors disabled:opacity-50"
        >
          {saving ? t('dashboard.kit.saving') : saveLabel || t('dashboard.kit.save')}
        </button>
      </div>
    </div>
  )
}

// Controlled confirm dialog. Opening a confirm from inside a dropdown item
// unmounts the trigger with the menu, so callers own the open state instead.
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  message,
  confirmLabel,
  tone = 'danger',
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  message: React.ReactNode
  confirmLabel: string
  tone?: 'danger' | 'info'
  onConfirm: () => unknown | Promise<unknown>
}) {
  const { t } = useTranslation()
  const [pending, setPending] = React.useState(false)
  const run = async () => {
    setPending(true)
    try {
      await onConfirm()
      onOpenChange(false)
    } finally {
      setPending(false)
    }
  }
  return (
    <Modal
      isDialogOpen={open}
      onOpenChange={onOpenChange}
      preventClose={pending}
      size="sm"
      dialogContent={
        <div className="flex flex-col gap-5">
          <div className="flex items-start gap-3">
            <div
              className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                tone === 'danger' ? 'bg-rose-50 text-rose-600' : 'bg-sky-50 text-sky-600'
              }`}
            >
              {tone === 'danger' ? <Warning size={18} /> : <Info size={18} />}
            </div>
            <div className="min-w-0">
              <p className="text-base font-semibold text-neutral-900">{title}</p>
              <div className="mt-1 text-sm text-neutral-500">{message}</div>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => onOpenChange(false)} disabled={pending} className={BTN_SECONDARY}>
              {t('common.cancel')}
            </button>
            <button
              type="button"
              onClick={run}
              disabled={pending}
              className={
                tone === 'danger'
                  ? BTN_DANGER
                  : BTN_PRIMARY
              }
            >
              {pending && <CircleNotch size={15} className="animate-spin" />}
              {confirmLabel}
            </button>
          </div>
        </div>
      }
    />
  )
}

// Overlapping author avatars with a "+N" tail.
export function AvatarStack({
  people,
  max = 3,
  size = 22,
}: {
  people: { key: string; src: string; label: string }[]
  max?: number
  size?: number
}) {
  const shown = people.slice(0, max)
  const rest = people.length - shown.length
  if (!people.length) return null
  return (
    <div className="flex items-center -space-x-1.5 rtl:space-x-reverse">
      {shown.map((p) =>
        p.src ? (
          <img
            key={p.key}
            src={p.src}
            alt={p.label}
            title={p.label}
            style={{ width: size, height: size }}
            className="rounded-full object-cover ring-2 ring-white bg-neutral-100"
          />
        ) : (
          <span
            key={p.key}
            title={p.label}
            style={{ width: size, height: size }}
            className="rounded-full ring-2 ring-white bg-neutral-200 text-neutral-600 text-[10px] font-bold flex items-center justify-center uppercase"
          >
            {p.label.slice(0, 1)}
          </span>
        )
      )}
      {rest > 0 && (
        <span
          style={{ width: size, height: size }}
          className="rounded-full ring-2 ring-white bg-neutral-100 text-neutral-500 text-[10px] font-bold flex items-center justify-center tabular-nums"
        >
          +{rest}
        </span>
      )}
    </div>
  )
}
