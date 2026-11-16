'use client'
import React from 'react'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import * as PopoverPrimitive from '@radix-ui/react-popover'
import { CaretDown, Check, X } from '@phosphor-icons/react'
import { StatusPill, type Status } from '@/design'
import { getTeam } from '@services/ee/platform/api'
import { platformKeys } from '@services/ee/platform/keys'
import { getEventCatalog, listChannels, opsKeys, type NotificationEvent } from '@services/ee/platform/ops'
import { shouldRetry, useAccessToken, usePlatformMe, useUrlQuery } from '@components/Admin/hooks'
import { CopyLinkButton, OrgLogo, PlanChip, adminPath, asList, orgDisplayName } from './AdminKit'

// Pieces the §9 / §11 console pages share (notifications, follows, tasks,
// deletions, emails, settings): colored icon tiles, the side drawer that
// deep links open, URL tabs, severity pills, and the team / event catalog
// queries. Kept apart from AdminKit so those pages can grow without touching
// the console's base kit.

// ─── tones ───────────────────────────────────────────────────────────────────

// emerald/amber/rose/sky/violet/blue are remapped by the dark theme; the rest
// use a translucent fill with a mid shade that reads on both themes.
export const TONE = {
  neutral: 'bg-neutral-100 text-neutral-600',
  emerald: 'bg-emerald-50 text-emerald-600',
  amber: 'bg-amber-50 text-amber-600',
  rose: 'bg-rose-50 text-rose-600',
  sky: 'bg-sky-50 text-sky-600',
  violet: 'bg-violet-50 text-violet-600',
  blue: 'bg-blue-50 text-blue-600',
  pink: 'bg-pink-500/12 text-pink-500',
  indigo: 'bg-indigo-500/12 text-indigo-500',
  teal: 'bg-teal-500/12 text-teal-500',
  orange: 'bg-orange-500/12 text-orange-500',
  cyan: 'bg-cyan-500/12 text-cyan-500',
} as const
export type Tone = keyof typeof TONE

export function IconTile({ icon, tone = 'neutral', size = 'md', className = '' }: { icon: React.ReactNode; tone?: Tone; size?: 'sm' | 'md' | 'lg'; className?: string }) {
  const box = size === 'sm' ? 'w-7 h-7 rounded-lg' : size === 'lg' ? 'w-11 h-11 rounded-xl' : 'w-9 h-9 rounded-xl'
  return <span className={`${box} inline-flex items-center justify-center shrink-0 ${TONE[tone]} ${className}`}>{icon}</span>
}

/** SectionCard with a colored icon tile (every section gets an icon and a line of description). */
export function ToneCard({
  icon,
  tone = 'neutral',
  title,
  description,
  actions,
  children,
  className = '',
  bodyClassName = 'p-5',
  id,
}: {
  icon: React.ReactNode
  tone?: Tone
  title: React.ReactNode
  description?: React.ReactNode
  actions?: React.ReactNode
  children?: React.ReactNode
  className?: string
  bodyClassName?: string
  id?: string
}) {
  return (
    <section id={id} className={`bg-white rounded-2xl nice-shadow min-w-0 ${className}`}>
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-5">
        <div className="flex items-start gap-3 min-w-0">
          <IconTile icon={icon} tone={tone} />
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-neutral-900 leading-tight">{title}</h2>
            {description && <p className="mt-0.5 text-sm text-neutral-500">{description}</p>}
          </div>
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2 shrink-0">{actions}</div>}
      </div>
      {children && <div className={bodyClassName}>{children}</div>}
    </section>
  )
}

// ─── severity ────────────────────────────────────────────────────────────────

export const SEVERITY_STATUS: Record<string, Status> = { info: 'info', success: 'success', warning: 'warning', critical: 'danger' }
export const SEVERITIES = ['info', 'success', 'warning', 'critical'] as const

export function SeverityPill({ severity }: { severity?: string | null }) {
  const { t } = useTranslation()
  const s = severity || 'info'
  return (
    <StatusPill status={SEVERITY_STATUS[s] ?? 'neutral'} dot>
      {t(`admin.ops.severity.${s}`, { defaultValue: s })}
    </StatusPill>
  )
}

// ─── URL tabs ────────────────────────────────────────────────────────────────

/**
 * A tab kept in `?tab=` so a link opens the same tab. Switching tabs drops
 * the other tab's filters/drawers (`clear`) and pushes a history entry.
 */
export function useUrlTab<K extends string>(keys: readonly K[], fallback: K, clear: string[] = []) {
  const [values, setValues] = useUrlQuery()
  const raw = values.tab as K | undefined
  const tab = raw && keys.includes(raw) ? raw : fallback
  const setTab = React.useCallback(
    (next: K) => {
      const updates: Record<string, string | undefined> = { tab: next === fallback ? undefined : next }
      for (const k of clear) updates[k] = undefined
      setValues(updates)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [setValues, fallback]
  )
  return [tab, setTab, values, setValues] as const
}

// ─── side drawer ─────────────────────────────────────────────────────────────

/**
 * The console's detail drawer (opened from `?id=`-style params so it survives
 * a reload and can be shared). Slides in from the end side; full width on phones.
 */
export function SideDrawer({
  open,
  onClose,
  icon,
  title,
  subtitle,
  copyHref,
  headerActions,
  footer,
  width = 'sm:w-[540px]',
  children,
}: {
  open: boolean
  onClose: () => void
  icon?: React.ReactNode
  title: React.ReactNode
  subtitle?: React.ReactNode
  /** Link the Copy link button copies (defaults to the current URL). Pass `false` to hide it. */
  copyHref?: string | false
  headerActions?: React.ReactNode
  footer?: React.ReactNode
  width?: string
  children: React.ReactNode
}) {
  const { t } = useTranslation()
  return (
    <DialogPrimitive.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className="fixed inset-0 bg-[var(--adm-overlay)] data-[state=open]:animate-in data-[state=open]:fade-in-0"
          style={{ zIndex: 'var(--z-modal-backdrop)' as any }}
        />
        <DialogPrimitive.Content
          className={`fixed inset-y-0 end-0 w-full ${width} bg-[var(--adm-canvas)] shadow-2xl flex flex-col data-[state=open]:animate-in data-[state=open]:slide-in-from-right rtl:data-[state=open]:slide-in-from-left focus:outline-none`}
          style={{ zIndex: 'var(--z-modal)' as any }}
          aria-describedby={undefined}
        >
          <div className="flex items-start gap-3 px-5 py-4 border-b border-neutral-100">
            {icon}
            <div className="min-w-0 flex-1">
              <DialogPrimitive.Title className="text-base font-semibold text-neutral-900 break-words">{title}</DialogPrimitive.Title>
              {subtitle && <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-neutral-500">{subtitle}</div>}
            </div>
            {headerActions}
            {copyHref !== false && <CopyLinkButton size="sm" label="" href={copyHref || undefined} />}
            <DialogPrimitive.Close
              className="h-7 w-7 shrink-0 inline-flex items-center justify-center rounded-lg text-neutral-400 hover:text-neutral-900 hover:bg-neutral-100"
              aria-label={t('common.close')}
            >
              <X size={16} />
            </DialogPrimitive.Close>
          </div>
          <div className="flex-1 overflow-y-auto px-5 py-5 space-y-6">{children}</div>
          {footer && <div className="flex flex-wrap items-center justify-end gap-2 px-5 py-3 border-t border-neutral-100">{footer}</div>}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

// ─── entity cells ────────────────────────────────────────────────────────────

/** Logo + name (link) + optional plan chip, for any row that mentions an org. */
export function OrgCell({
  org,
  id,
  name,
  plan,
  size = 28,
  section,
  sub,
}: {
  org?: { id?: number; name?: string | null; slug?: string; org_uuid?: string; logo_image?: string | null; plan?: string } | null
  id?: number | null
  name?: string | null
  plan?: string | null
  size?: number
  section?: string
  sub?: React.ReactNode
}) {
  const { t } = useTranslation()
  const orgId = org?.id ?? id
  if (!orgId) return <span className="text-xs text-neutral-400">–</span>
  const label = orgDisplayName({ id: orgId, name: org?.name ?? name }, t)
  const stop = (e: React.MouseEvent) => e.stopPropagation()
  return (
    <span className="flex items-center gap-2.5 min-w-0">
      {org && <OrgLogo org={org} size={size} />}
      <span className="min-w-0">
        <span className="flex items-center gap-1.5 min-w-0">
          <Link href={adminPath.org(orgId, section)} onClick={stop} className="truncate text-sm font-medium text-neutral-900 hover:underline underline-offset-2">
            {label}
          </Link>
          {(plan ?? org?.plan) && <PlanChip plan={plan ?? org?.plan} />}
        </span>
        {sub && <span className="block truncate text-xs text-neutral-400">{sub}</span>}
      </span>
    </span>
  )
}

// ─── shared queries ──────────────────────────────────────────────────────────

/** The platform team (for assignee / recipient pickers), cached for 5 min. */
export function useTeamList(enabled = true) {
  const token = useAccessToken()
  const q = useQuery({
    queryKey: platformKeys.team(),
    queryFn: () => getTeam(token),
    enabled: !!token && enabled,
    retry: shouldRetry,
    staleTime: 5 * 60_000,
  })
  return { ...q, members: asList(q.data?.members) }
}

/** The notification event catalog (key → label, severity, group). */
export function useEventCatalog() {
  const token = useAccessToken()
  const q = useQuery({
    queryKey: opsKeys.events(),
    queryFn: () => getEventCatalog(token),
    enabled: !!token,
    retry: shouldRetry,
    staleTime: 30 * 60_000,
  })
  const events: NotificationEvent[] = Array.isArray(q.data) ? q.data : []
  const label = React.useCallback(
    (key: string) => {
      const hit = events.find((e) => e.key === key)
      if (hit) return hit.label
      if (key === '*') return '*'
      return key
    },
    [events]
  )
  return { ...q, events, label }
}

/** Notification channels for pickers; only members with notifications.manage can list them. */
export function useChannelList(enabled = true) {
  const token = useAccessToken()
  const me = usePlatformMe()
  const q = useQuery({
    queryKey: opsKeys.channels(),
    queryFn: () => listChannels(token),
    enabled: !!token && enabled && me.can('notifications.manage'),
    retry: shouldRetry,
    staleTime: 60_000,
  })
  return { ...q, channels: Array.isArray(q.data) ? q.data : [] }
}

// ─── multi pick ──────────────────────────────────────────────────────────────

/** A compact multi-select (plans, roles, lifecycles…) with checkmarks in a popover. */
export function MultiPick({
  label,
  options,
  value,
  onChange,
  icon,
  emptyLabel,
  className = '',
}: {
  label: string
  options: { value: string; label: string }[]
  value: string[]
  onChange: (v: string[]) => void
  icon?: React.ReactNode
  /** Shown when nothing is picked (e.g. "Any plan"). */
  emptyLabel?: string
  className?: string
}) {
  const picked = options.filter((o) => value.includes(o.value))
  const text = picked.length === 0 ? emptyLabel ?? label : picked.length <= 2 ? picked.map((o) => o.label).join(', ') : `${picked[0].label} +${picked.length - 1}`
  return (
    <PopoverPrimitive.Root>
      <PopoverPrimitive.Trigger asChild>
        <button
          type="button"
          aria-label={label}
          className={`inline-flex items-center gap-1.5 h-9 px-3 rounded-xl bg-white ring-1 ring-inset ring-neutral-200 text-sm text-neutral-700 hover:text-neutral-900 min-w-0 max-w-full focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/15 ${className}`}
        >
          {icon && <span className="text-neutral-400 shrink-0">{icon}</span>}
          <span className={`truncate ${picked.length ? '' : 'text-neutral-400'}`}>{text}</span>
          <CaretDown size={12} className="shrink-0 ms-auto text-neutral-400" />
        </button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="start"
          sideOffset={6}
          collisionPadding={12}
          className="w-[min(16rem,calc(100vw-2rem))] max-h-72 overflow-y-auto rounded-xl bg-white p-1.5 shadow-[0_12px_40px_-12px_rgba(0,0,0,0.25)] ring-1 ring-neutral-200/80 focus:outline-none"
          style={{ zIndex: 'var(--z-popover)' as any }}
        >
          {options.map((o) => {
            const on = value.includes(o.value)
            return (
              <button
                key={o.value}
                type="button"
                role="menuitemcheckbox"
                aria-checked={on}
                onClick={() => onChange(on ? value.filter((v) => v !== o.value) : [...value, o.value])}
                className="w-full flex items-center gap-2 rounded-lg px-2.5 h-8 text-start text-[13px] text-neutral-700 hover:bg-neutral-100 focus:outline-none focus-visible:bg-neutral-100"
              >
                <span className={`h-4 w-4 shrink-0 rounded inline-flex items-center justify-center ring-1 ring-inset ${on ? 'bg-neutral-900 ring-neutral-900 text-white' : 'ring-neutral-300'}`}>
                  {on && <Check size={11} weight="bold" />}
                </span>
                <span className="truncate">{o.label}</span>
              </button>
            )
          })}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  )
}

// ─── misc ────────────────────────────────────────────────────────────────────

/** "in 3 days" / "2 days overdue" text for a due date, with a tone. */
export function dueInfo(value: string | null | undefined): { days: number | null; tone: 'rose' | 'amber' | 'neutral' } {
  if (!value) return { days: null, tone: 'neutral' }
  const ms = new Date(value).getTime() - Date.now()
  if (isNaN(ms)) return { days: null, tone: 'neutral' }
  const days = Math.ceil(ms / 86_400_000)
  return { days, tone: ms < 0 ? 'rose' : days <= 2 ? 'amber' : 'neutral' }
}

/** A local `datetime-local` value from an ISO string (and back). */
export function toLocalInput(iso?: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
export function fromLocalInput(v: string): string | null {
  if (!v) return null
  const d = new Date(v)
  return isNaN(d.getTime()) ? null : d.toISOString()
}

/** Small label: value row used in drawers (no box, hairline rows). */
export function DetailRows({ rows }: { rows: { label: string; value: React.ReactNode; hidden?: boolean }[] }) {
  return (
    <dl className="divide-y divide-neutral-100">
      {rows
        .filter((r) => !r.hidden)
        .map((r) => (
          <div key={r.label} className="flex items-start justify-between gap-4 py-2.5 first:pt-0 last:pb-0">
            <dt className="text-xs text-neutral-500 shrink-0">{r.label}</dt>
            <dd className="text-sm text-neutral-900 text-end min-w-0 break-words">{r.value}</dd>
          </div>
        ))}
    </dl>
  )
}
