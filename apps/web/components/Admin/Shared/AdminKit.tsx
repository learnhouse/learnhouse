'use client'
import React from 'react'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import {
  ArrowClockwise,
  Buildings,
  CaretLeft,
  CaretRight,
  Check,
  Heartbeat,
  LinkSimple,
  LockSimple,
  Plugs,
  User,
  WarningCircle,
} from '@phosphor-icons/react'
import { Chip, DashPageHeader, EmptyState, Panel, Skeleton, StatusPill, Button, type ChipTone, type Status } from '@/design'
import { getOrgLogoMediaDirectory, getUserAvatarMediaDirectory } from '@services/media/media'
import { errorMessage, errorStatus, isNotAvailable } from '@services/ee/platform/api'
import EELicenseError, { isEELicenseInactiveError, isEERequiredError } from '@components/Admin/EELicenseError'

// Small pieces every console page shares. Page-specific UI lives next to the
// page; anything used by two or more console pages lives here.

// ─── page header ─────────────────────────────────────────────────────────────

export function AdminHeader({
  title,
  subtitle,
  actions,
  crumbs = [],
}: {
  title: string
  subtitle?: React.ReactNode
  actions?: React.ReactNode
  crumbs?: { label: string; href: string }[]
}) {
  const { t } = useTranslation()
  return (
    <DashPageHeader
      atlas={false}
      breadcrumbs={[{ label: t('admin.shell.platform'), href: '/admin' }, ...crumbs, { label: title, href: '' }]}
      title={title}
      subtitle={subtitle}
      actions={actions}
    />
  )
}

// ─── query states ────────────────────────────────────────────────────────────

/** Error/unavailable/forbidden panel for a failed query. */
export function QueryError({ error, onRetry, compact }: { error: unknown; onRetry?: () => void; compact?: boolean }) {
  const { t } = useTranslation()
  if (isEELicenseInactiveError(error) || isEERequiredError(error)) return <EELicenseError error={error} />
  if (isNotAvailable(error)) {
    return (
      <EmptyStateBox compact={compact}>
        <EmptyState
          icon={<Plugs size={22} />}
          title={t('admin.common.unavailable_title')}
          description={t('admin.common.unavailable_desc')}
        />
      </EmptyStateBox>
    )
  }
  if (errorStatus(error) === 403) {
    return (
      <EmptyStateBox compact={compact}>
        <EmptyState
          icon={<LockSimple size={22} />}
          title={t('admin.common.forbidden_title')}
          description={errorMessage(error, t('admin.common.forbidden_desc'))}
        />
      </EmptyStateBox>
    )
  }
  return (
    <EmptyStateBox compact={compact}>
      <EmptyState
        icon={<WarningCircle size={22} />}
        title={t('admin.common.error_title')}
        description={errorMessage(error, t('admin.common.error_desc'))}
        action={
          onRetry ? (
            <Button size="sm" icon={<ArrowClockwise size={13} />} onClick={onRetry}>
              {t('admin.common.retry')}
            </Button>
          ) : undefined
        }
      />
    </EmptyStateBox>
  )
}

function EmptyStateBox({ compact, children }: { compact?: boolean; children: React.ReactNode }) {
  if (compact) return <div>{children}</div>
  return <Panel>{children}</Panel>
}

/** Shown in place of a page the member's role cannot open. */
export function NoAccess() {
  const { t } = useTranslation()
  return (
    <Panel>
      <EmptyState icon={<LockSimple size={22} />} title={t('admin.common.forbidden_title')} description={t('admin.common.forbidden_desc')} />
    </Panel>
  )
}

/** Rows of grey bars shaped like a list while it loads. */
export function ListSkeleton({ rows = 6, avatar = true }: { rows?: number; avatar?: boolean }) {
  return (
    <Panel divided>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-5 py-3.5">
          {avatar && <Skeleton className="h-8 w-8 rounded-lg" />}
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3.5 w-40" />
            <Skeleton className="h-3 w-24" />
          </div>
          <Skeleton className="h-5 w-16 rounded-full" />
        </div>
      ))}
    </Panel>
  )
}

// ─── chips ───────────────────────────────────────────────────────────────────

// Same hues as the console always used: free grey, standard blue, pro purple, enterprise amber.
const PLAN_TONE: Record<string, ChipTone> = { free: 'neutral', standard: 'sky', pro: 'violet', enterprise: 'amber' }

export function PlanChip({ plan }: { plan?: string | null }) {
  const { t } = useTranslation()
  if (!plan) return null
  return <Chip tone={PLAN_TONE[plan] ?? 'neutral'}>{t(`admin.plans.${plan}`, { defaultValue: plan })}</Chip>
}

const LIFECYCLE_STATUS: Record<string, Status> = {
  active: 'success',
  trial: 'info',
  poc: 'ai',
  suspended: 'warning',
  closed: 'danger',
  pending_deletion: 'danger',
}

export function LifecycleChip({ lifecycle }: { lifecycle?: string | null }) {
  const { t } = useTranslation()
  if (!lifecycle) return null
  return (
    <StatusPill status={LIFECYCLE_STATUS[lifecycle] ?? 'neutral'} dot>
      {t(`admin.lifecycle.${lifecycle}`, { defaultValue: lifecycle })}
    </StatusPill>
  )
}

export function healthStatus(score?: number | null): Status {
  if (score === null || score === undefined) return 'neutral'
  if (score >= 70) return 'success'
  if (score >= 40) return 'warning'
  return 'danger'
}

export function HealthBadge({ score }: { score?: number | null }) {
  const { t } = useTranslation()
  if (score === null || score === undefined) return <span className="text-xs text-neutral-300">–</span>
  return (
    <StatusPill status={healthStatus(score)} icon={<Heartbeat size={12} weight="fill" />} title={t('admin.common.health')}>
      <span className="tabular-nums">{score}</span>
    </StatusPill>
  )
}

const ROLE_TONE: Record<string, ChipTone> = { owner: 'amber', admin: 'violet', support: 'sky', sales: 'emerald', viewer: 'neutral' }

export function RoleBadge({ role, className = '' }: { role?: string | null; className?: string }) {
  const { t } = useTranslation()
  if (!role) return null
  return (
    <Chip tone={ROLE_TONE[role] ?? 'neutral'} className={className}>
      {t(`admin.roles.${role}`, { defaultValue: role })}
    </Chip>
  )
}

export function TagList({ tags, max = 3 }: { tags?: string[] | null; max?: number }) {
  const list = Array.isArray(tags) ? tags : []
  if (!list.length) return null
  const shown = list.slice(0, max)
  return (
    <span className="inline-flex flex-wrap items-center gap-1 min-w-0">
      {shown.map((tag) => (
        <span key={tag} className="inline-flex items-center rounded-md bg-neutral-100 px-1.5 py-0.5 text-[11px] font-medium text-neutral-600">
          {tag}
        </span>
      ))}
      {list.length > max && <span className="text-[11px] text-neutral-400 tabular-nums">+{list.length - max}</span>}
    </span>
  )
}

// ─── avatars ─────────────────────────────────────────────────────────────────

export function orgLogoUrl(orgUuid?: string, logo?: string | null): string | null {
  if (!logo || !orgUuid) return null
  return logo.startsWith('http') ? logo : getOrgLogoMediaDirectory(orgUuid, logo)
}

export function userAvatarUrl(userUuid?: string, avatar?: string | null): string | null {
  if (!avatar || !userUuid) return null
  return avatar.startsWith('http') ? avatar : getUserAvatarMediaDirectory(userUuid, avatar)
}

export function OrgLogo({ org, size = 32 }: { org: { org_uuid?: string; logo_image?: string | null; name?: string | null }; size?: number }) {
  const [failed, setFailed] = React.useState(false)
  const src = orgLogoUrl(org.org_uuid, org.logo_image)
  const style = { width: size, height: size }
  if (src && !failed) {
    return (
      // Inline white (not bg-white, which the dark console remaps): logos are
      // drawn for light backgrounds and would vanish on the dark card.
      <img src={src} alt="" style={{ ...style, backgroundColor: '#ffffff' }} onError={() => setFailed(true)} className="rounded-lg object-contain ring-1 ring-neutral-200/70 shrink-0" />
    )
  }
  return (
    <span style={style} className="rounded-lg bg-neutral-100 text-neutral-400 flex items-center justify-center shrink-0">
      <Buildings size={Math.round(size * 0.5)} weight="fill" />
    </span>
  )
}

export function Avatar({
  user,
  size = 28,
}: {
  user: { user_uuid?: string; avatar_image?: string | null; username?: string }
  size?: number
}) {
  const [failed, setFailed] = React.useState(false)
  const src = userAvatarUrl(user.user_uuid, user.avatar_image)
  const style = { width: size, height: size }
  if (src && !failed) {
    return <img src={src} alt="" style={style} onError={() => setFailed(true)} className="rounded-full object-cover bg-neutral-100 shrink-0" />
  }
  const initial = user.username?.slice(0, 1)
  return (
    <span style={style} className="rounded-full bg-neutral-200 text-neutral-600 flex items-center justify-center shrink-0 text-[11px] font-bold uppercase">
      {initial || <User size={Math.round(size * 0.5)} weight="fill" />}
    </span>
  )
}

// ─── pagination ──────────────────────────────────────────────────────────────

export function Pagination({ page, total, limit, onPage }: { page: number; total: number; limit: number; onPage: (p: number) => void }) {
  const { t } = useTranslation()
  const pages = Math.max(1, Math.ceil(total / limit))
  if (pages <= 1) return null
  const nums = Array.from({ length: pages }, (_, i) => i + 1).filter((p) => p === 1 || p === pages || Math.abs(p - page) <= 1)
  return (
    <div className="flex items-center justify-between gap-3 px-1">
      <span className="text-xs text-neutral-400">{t('admin.common.page_of', { page, pages })}</span>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onPage(Math.max(1, page - 1))}
          disabled={page === 1}
          aria-label={t('admin.common.previous')}
          className="h-7 w-7 inline-flex items-center justify-center rounded-lg text-neutral-500 hover:bg-white hover:text-neutral-900 disabled:opacity-30 disabled:hover:bg-transparent"
        >
          <CaretLeft size={14} className="rtl:rotate-180" />
        </button>
        {nums.map((p, i) => (
          <React.Fragment key={p}>
            {i > 0 && nums[i - 1] !== p - 1 && <span className="px-1 text-xs text-neutral-300">…</span>}
            <button
              type="button"
              onClick={() => onPage(p)}
              aria-current={p === page ? 'page' : undefined}
              className={`h-7 min-w-7 px-2 rounded-lg text-xs font-semibold tabular-nums transition-colors ${
                p === page ? 'bg-white text-neutral-900 nice-shadow' : 'text-neutral-500 hover:bg-white hover:text-neutral-900'
              }`}
            >
              {p}
            </button>
          </React.Fragment>
        ))}
        <button
          type="button"
          onClick={() => onPage(Math.min(pages, page + 1))}
          disabled={page === pages}
          aria-label={t('admin.common.next')}
          className="h-7 w-7 inline-flex items-center justify-center rounded-lg text-neutral-500 hover:bg-white hover:text-neutral-900 disabled:opacity-30 disabled:hover:bg-transparent"
        >
          <CaretRight size={14} className="rtl:rotate-180" />
        </button>
      </div>
    </div>
  )
}

// ─── switch ──────────────────────────────────────────────────────────────────

export function Switch({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
  label?: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        checked ? 'bg-emerald-500' : 'bg-neutral-300'
      }`}
    >
      <span
        className={`inline-block h-4 w-4 rounded-full bg-[#fff] shadow-sm transition-transform ${
          checked ? 'translate-x-[18px] rtl:-translate-x-[18px]' : 'translate-x-0.5 rtl:-translate-x-0.5'
        }`}
      />
    </button>
  )
}

// ─── key/value rows ──────────────────────────────────────────────────────────

export function KeyValue({ label, children, mono }: { label: string; children: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5 first:pt-0 last:pb-0">
      <span className="text-xs text-neutral-500 shrink-0">{label}</span>
      <span className={`text-sm text-neutral-900 text-end min-w-0 break-words ${mono ? 'font-mono text-xs' : ''}`}>{children}</span>
    </div>
  )
}

// ─── charts (tiny, dependency free) ──────────────────────────────────────────

/** The console's chart ink: neutral and quiet; color is kept for meaning. */
export const CHART_INK = 'var(--adm-chart-1)'
export const CHART_INK_STRONG = 'var(--adm-chart-1)'
/** chart-1..8 as theme tokens (adminDark.css tunes them for Light and Dark). */
export const CHART_COLORS = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => `var(--adm-chart-${n})`)
/** Plan colors, matching the plan chips. */
export const PLAN_COLORS: Record<string, string> = {
  free: 'var(--adm-plan-free)',
  standard: 'var(--adm-plan-standard)',
  pro: 'var(--adm-plan-pro)',
  enterprise: 'var(--adm-plan-enterprise)',
}

/** Vertical bars for a short daily series. Colors come from the chart tokens. */
export function MiniBars({
  data,
  height = 96,
  color = CHART_INK,
  label,
}: {
  /** `href` makes a bar a link to the list behind it (e.g. users created that day). */
  data: { key: string; value: number; title?: string; href?: string }[]
  height?: number
  color?: string
  label?: string
}) {
  const max = Math.max(1, ...data.map((d) => d.value))
  return (
    <div role="img" aria-label={label} className="flex items-end gap-[3px] w-full border-b border-[var(--adm-line)]" style={{ height }}>
      {data.map((d) => {
        const style = { height: `${Math.max(2, (d.value / max) * 100)}%`, background: color, opacity: d.value ? 0.85 : 0.2 }
        const cls = 'flex-1 min-w-[2px] rounded-t-[2px] transition-opacity hover:!opacity-100'
        const title = d.title ?? `${d.key}: ${d.value}`
        return d.href && d.value ? (
          <Link key={d.key} href={d.href} title={title} aria-label={title} className={cls} style={style} />
        ) : (
          <div key={d.key} title={title} className={cls} style={style} />
        )
      })}
    </div>
  )
}

export function Sparkline({ data, width = 64, height = 20, color = CHART_INK_STRONG }: { data: number[]; width?: number; height?: number; color?: string }) {
  if (!data.length) return <span className="text-xs text-neutral-300">–</span>
  const max = Math.max(1, ...data)
  const step = width / Math.max(data.length - 1, 1)
  const points = data.map((v, i) => `${i * step},${height - (v / max) * (height - 2) - 1}`).join(' ')
  return (
    <svg width={width} height={height} className="shrink-0 overflow-visible" aria-hidden="true">
      <polyline points={points} fill="none" style={{ stroke: color }} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

/** Horizontal share bar (plan mix and similar). */
export function ShareBar({ parts }: { parts: { key: string; value: number; color: string; label: string; href?: string }[] }) {
  const total = parts.reduce((a, p) => a + p.value, 0) || 1
  return (
    <div className="space-y-3">
      <div className="flex h-2 w-full gap-0.5 overflow-hidden rounded-full bg-neutral-100">
        {parts.map((p) => (
          <div key={p.key} style={{ width: `${(p.value / total) * 100}%`, background: p.color }} title={`${p.label}: ${p.value}`} />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1">
        {parts.map((p) => {
          const inner = (
            <>
              <span className="flex items-center gap-1.5 text-neutral-600 min-w-0">
                <span className="h-2 w-2 rounded-full shrink-0" style={{ background: p.color }} />
                <span className="truncate">{p.label}</span>
              </span>
              <span className="tabular-nums font-semibold text-neutral-900">{p.value}</span>
            </>
          )
          const cls = 'flex items-center justify-between gap-2 text-xs rounded-md px-1.5 py-1 -mx-1.5'
          return p.href ? (
            <Link key={p.key} href={p.href} className={`${cls} hover:bg-neutral-50`}>
              {inner}
            </Link>
          ) : (
            <div key={p.key} className={cls}>
              {inner}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── dates ───────────────────────────────────────────────────────────────────

export function formatDate(value: string | null | undefined, locale: string, withTime = false): string {
  if (!value) return '–'
  const d = new Date(value)
  if (isNaN(d.getTime())) return value
  return new Intl.DateTimeFormat(locale, withTime ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' }).format(d)
}

/** Whole days from now until `value` (negative when past). */
export function daysUntil(value: string | null | undefined): number | null {
  if (!value) return null
  const t = new Date(value).getTime()
  if (isNaN(t)) return null
  return Math.ceil((t - Date.now()) / 86_400_000)
}

/** Read a list out of `T[]` or `{items: T[]}` responses. */
export function asList<T>(data: T[] | { items?: T[] } | null | undefined): T[] {
  if (Array.isArray(data)) return data
  if (data && Array.isArray((data as { items?: T[] }).items)) return (data as { items: T[] }).items
  return []
}

// ─── deep links ──────────────────────────────────────────────────────────────

/** Console paths for entities, so every mention links the same way. */
export const adminPath = {
  org: (id: number | string, section?: string) => `/admin/organizations/${id}${section ? `?section=${section}` : ''}`,
  user: (id: number | string) => `/admin/users/${id}`,
  automation: (uuid: string, run?: number | string) => `/admin/automations/${uuid}${run !== undefined ? `?section=runs&run=${run}` : ''}`,
  event: (id: string) => `/admin/activity?event=${encodeURIComponent(id)}`,
}

/**
 * Copies a link to the current view (every filter, tab and open drawer lives
 * in the URL, so the link reproduces it) or to `href` when given.
 */
export function CopyLinkButton({ href, label, size = 'md' }: { href?: string; label?: string; size?: 'sm' | 'md' }) {
  const { t } = useTranslation()
  const [copied, setCopied] = React.useState(false)
  const copy = async () => {
    const url = href ? new URL(href, window.location.origin).toString() : window.location.href
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      // Clipboard blocked (insecure context): show the link so it can be copied by hand.
      window.prompt(t('admin.links.copy_manually'), url)
    }
  }
  return (
    <Button size={size} onClick={copy} icon={copied ? <Check size={13} weight="bold" /> : <LinkSimple size={13} />} aria-live="polite">
      <span className={label === '' ? 'sr-only' : ''}>{copied ? t('admin.links.copied') : label ?? t('admin.links.copy')}</span>
    </Button>
  )
}

/** An org's display name; orgs created with an empty name still get a label. */
export function orgDisplayName(org: { id?: number | string; name?: string | null }, t: (k: string, o?: Record<string, unknown>) => string): string {
  return org.name?.trim() || t('admin.orgs.untitled', { id: org.id ?? '' })
}
