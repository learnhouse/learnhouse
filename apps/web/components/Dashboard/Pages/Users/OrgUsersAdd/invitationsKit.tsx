'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { useRoleText } from './roleText'
import { useQuery } from '@tanstack/react-query'
import {
  BookOpen,
  CaretDown,
  ChalkboardTeacher,
  Check,
  CheckCircle,
  ClockCountdown,
  Crown,
  Desktop,
  MagnifyingGlass,
  Prohibit,
  ShieldStar,
  User,
  UsersThree,
  X,
  XCircle,
} from '@phosphor-icons/react'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrg } from '@components/Contexts/OrgContext'
import { Chip, type ChipTone } from '@components/Dashboard/Shared/DashKit/DashKit'
import { getUserGroups } from '@services/usergroups/usergroups'
import { getAllOrgCourses } from '@services/courses/courses'
import {
  BUILT_IN_ROLES,
  getInvitationOptions,
  type InvitationOptions,
  type InvitationStatus,
  type RoleOption,
} from '@services/organizations/invitations'
import { asArray } from '@services/utils/ts/requests'

// Building blocks shared by the invite dialog, the invitations list and the
// invite-code dialog: the org's roles with plain-language descriptions, the
// group and course pickers, status chips and expiry labels.

export const invitationKeys = {
  all: (orgId: number) => ['org', orgId, 'invitations'] as const,
  list: (orgId: number, params: object) => ['org', orgId, 'invitations', 'list', params] as const,
  options: (orgId: number) => ['org', orgId, 'invitations', 'options'] as const,
}

export function useInvitationAuth() {
  const org = useOrg() as any
  const session = useLHSession() as any
  return { org, orgId: org?.id as number, token: session?.data?.tokens?.access_token as string }
}

export function useInvitationOptions(enabled = true) {
  const { orgId, token } = useInvitationAuth()
  return useQuery({
    queryKey: invitationKeys.options(orgId),
    queryFn: async () => {
      const res = await getInvitationOptions(orgId, token)
      if (!res.success) throw Object.assign(new Error('options'), { detail: res.data?.detail })
      return res.data as InvitationOptions
    },
    enabled: enabled && !!orgId && !!token,
    staleTime: 30_000,
  })
}

export type PickItem = { id: string; label: string; hint?: string }

export function useGroupItems(enabled = true): PickItem[] {
  const { orgId, token } = useInvitationAuth()
  const { data } = useQuery({
    queryKey: ['org', orgId, 'usergroups', 'invite-picker'],
    queryFn: () => getUserGroups(orgId, token),
    select: (res: any) => asArray<any>(res),
    enabled: enabled && !!orgId && !!token,
    staleTime: 60_000,
  })
  return React.useMemo(() => (data ?? []).map((g: any) => ({ id: String(g.id), label: g.name })), [data])
}

export function useCourseItems(enabled = true): PickItem[] {
  const { org, token } = useInvitationAuth()
  const { data } = useQuery({
    queryKey: ['courses', org?.slug, 'invite-picker'],
    queryFn: () => getAllOrgCourses(org.slug, token, true),
    select: (res: any) => asArray<any>(res),
    enabled: enabled && !!org?.slug && !!token,
    staleTime: 60_000,
  })
  return React.useMemo(
    () => (data ?? []).map((c: any) => ({ id: String(c.course_uuid), label: c.name, hint: c.published === false ? 'draft' : undefined })),
    [data]
  )
}

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

const ROLE_LOOK: Record<string, { icon: React.ReactNode; tile: string }> = {
  admin: { icon: <Crown size={17} weight="fill" />, tile: 'bg-violet-50 text-violet-600' },
  maintainer: { icon: <ShieldStar size={17} weight="fill" />, tile: 'bg-sky-50 text-sky-600' },
  instructor: { icon: <ChalkboardTeacher size={17} weight="fill" />, tile: 'bg-amber-50 text-amber-600' },
  user: { icon: <User size={17} weight="fill" />, tile: 'bg-emerald-50 text-emerald-600' },
  custom: { icon: <UsersThree size={17} weight="fill" />, tile: 'bg-neutral-100 text-neutral-600' },
}

export function roleLook(role?: { role_uuid?: string } | null) {
  return ROLE_LOOK[BUILT_IN_ROLES[role?.role_uuid ?? ''] ?? 'custom']
}

export { useRoleText }

function refusalText(t: (k: string) => string, refusal: RoleOption['refusal']) {
  if (refusal === 'ADMIN_ONLY') return t('dashboard.users.invitations.roles.refusal_admin_only')
  if (refusal) return t('dashboard.users.invitations.roles.refusal_above')
  return ''
}

/** The org's roles as cards: built-in ones in a grid, custom ones below. */
export function RolePickerGrid({
  roles,
  value,
  onChange,
  codesOnly = false,
}: {
  roles: RoleOption[]
  value: number
  onChange: (_id: number) => void
  codesOnly?: boolean
}) {
  const { t } = useTranslation()
  const text = useRoleText()
  const order = ['role_global_user', 'role_global_instructor', 'role_global_maintainer', 'role_global_admin']
  const builtIn = order.map((uuid) => roles.find((r) => r.role_uuid === uuid)).filter(Boolean) as RoleOption[]
  const custom = roles.filter((r) => !order.includes(r.role_uuid))
  const visible = (r: RoleOption) => !codesOnly || r.code_allowed

  const card = (role: RoleOption, compact = false) => {
    const disabled = codesOnly ? !role.code_allowed : !role.grantable
    const selected = value === role.id
    const look = roleLook(role)
    const copy = text(role)
    const why = codesOnly && !role.code_allowed ? t('dashboard.users.invitations.roles.refusal_code') : refusalText(t, role.refusal)
    return (
      <button
        key={role.id}
        type="button"
        role="radio"
        aria-checked={selected}
        aria-disabled={disabled}
        disabled={disabled}
        title={disabled ? why : undefined}
        onClick={() => !disabled && onChange(role.id)}
        className={`flex items-start gap-3 rounded-xl px-3.5 py-3 text-start transition-all min-w-0 ${
          selected
            ? 'bg-white ring-2 ring-neutral-900 shadow-sm'
            : disabled
              ? 'bg-neutral-50 ring-1 ring-inset ring-neutral-100 cursor-not-allowed'
              : 'bg-white ring-1 ring-inset ring-neutral-200 hover:ring-neutral-300'
        }`}
      >
        <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${disabled ? 'bg-neutral-100 text-neutral-400' : look.tile}`}>
          {look.icon}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5 flex-wrap">
            <span className={`text-sm font-semibold ${disabled ? 'text-neutral-400' : 'text-neutral-900'}`}>{copy.name}</span>
            {role.occupies_seat && !codesOnly && (
              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-neutral-500">
                <Desktop size={11} /> {t('dashboard.users.invitations.roles.admin_seat')}
              </span>
            )}
          </span>
          {!compact && (
            <span className={`block text-xs mt-0.5 leading-relaxed ${disabled ? 'text-neutral-400' : 'text-neutral-500'}`}>
              {disabled && why ? why : copy.description}
            </span>
          )}
          {compact && disabled && why && <span className="block text-xs mt-0.5 text-neutral-400">{why}</span>}
        </span>
      </button>
    )
  }

  return (
    <div className="flex flex-col gap-2" role="radiogroup" aria-label={t('dashboard.users.invitations.fields.role')}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">{builtIn.filter(visible).map((r) => card(r))}</div>
      {custom.filter(visible).length > 0 && (
        <>
          <p className="mt-1 text-xs font-medium text-neutral-500">{t('dashboard.users.invitations.roles.custom_roles')}</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">{custom.filter(visible).map((r) => card(r))}</div>
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Multi pickers (groups, courses)
// ---------------------------------------------------------------------------

export function MultiPicker({
  items,
  value,
  onChange,
  placeholder,
  emptyText,
  icon,
  label,
}: {
  items: PickItem[]
  value: string[]
  onChange: (_ids: string[]) => void
  placeholder: string
  emptyText: string
  icon: React.ReactNode
  label: string
}) {
  const { t } = useTranslation()
  const [query, setQuery] = React.useState('')
  const [open, setOpen] = React.useState(false)
  const root = React.useRef<HTMLDivElement>(null)
  const selected = value.map((id) => items.find((i) => i.id === id)).filter(Boolean) as PickItem[]
  const shown = items.filter((i) => i.label.toLowerCase().includes(query.trim().toLowerCase()))
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id])

  // An inline panel, not a portal: inside a modal dialog a portaled menu
  // lands outside the dialog and can't be clicked.
  React.useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  return (
    <div className="flex flex-col gap-2 min-w-0">
      <div ref={root} className="relative min-w-0">
        <button
          type="button"
          aria-label={label}
          aria-expanded={open}
          aria-haspopup="listbox"
          onClick={() => setOpen((o) => !o)}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && open) {
              e.stopPropagation()
              setOpen(false)
            }
          }}
          className="w-full min-h-9 px-3 py-1.5 flex items-center gap-2 text-start text-sm bg-white rounded-xl ring-1 ring-inset ring-neutral-200 hover:ring-neutral-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/15 transition-shadow"
        >
          <span className="text-neutral-400 shrink-0">{icon}</span>
          <span className={`flex-1 truncate ${selected.length ? 'text-neutral-800' : 'text-neutral-400'}`}>
            {selected.length ? t('dashboard.users.invitations.fields.selected_count', { count: selected.length }) : placeholder}
          </span>
          <CaretDown size={12} className={`text-neutral-400 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
        {open && (
          <div
            role="listbox"
            aria-multiselectable="true"
            aria-label={label}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.stopPropagation()
                setOpen(false)
              }
            }}
            className="absolute z-50 start-0 end-0 mt-1.5 min-w-64 rounded-xl bg-white p-1.5 shadow-lg ring-1 ring-black/5"
          >
            <div className="flex items-center gap-2 px-2 pb-1.5 mb-1 border-b border-neutral-100">
              <MagnifyingGlass size={14} className="text-neutral-400 shrink-0" />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('dashboard.users.invitations.fields.search')}
                aria-label={t('dashboard.users.invitations.fields.search')}
                className="w-full h-7 text-sm bg-transparent focus:outline-none placeholder:text-neutral-400"
              />
            </div>
            <div className="max-h-56 overflow-y-auto">
              {shown.length === 0 ? (
                <p className="px-2 py-3 text-xs text-neutral-500">{items.length ? t('dashboard.users.invitations.fields.no_match') : emptyText}</p>
              ) : (
                shown.map((item) => {
                  const on = value.includes(item.id)
                  return (
                    <button
                      key={item.id}
                      type="button"
                      role="option"
                      aria-selected={on}
                      onClick={() => toggle(item.id)}
                      className="w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-sm text-start hover:bg-neutral-100 transition-colors"
                    >
                      <span
                        className={`w-4 h-4 rounded-[5px] flex items-center justify-center shrink-0 ${on ? 'bg-neutral-900 text-white' : 'ring-1 ring-inset ring-neutral-300'}`}
                      >
                        {on && <Check size={11} weight="bold" />}
                      </span>
                      <span className="flex-1 truncate text-neutral-800">{item.label}</span>
                      {item.hint && <span className="text-[11px] text-neutral-400">{t('dashboard.users.invitations.fields.draft')}</span>}
                    </button>
                  )
                })
              )}
            </div>
          </div>
        )}
      </div>
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selected.map((item) => (
            <span
              key={item.id}
              className="inline-flex items-center gap-1 max-w-full rounded-full ps-2.5 pe-1 py-0.5 text-xs font-medium text-neutral-700 bg-neutral-100 ring-1 ring-inset ring-neutral-900/5"
            >
              <span className="truncate">{item.label}</span>
              <button
                type="button"
                onClick={() => toggle(item.id)}
                aria-label={t('dashboard.users.invitations.fields.remove_item', { name: item.label })}
                className="h-4 w-4 inline-flex items-center justify-center rounded-full text-neutral-400 hover:text-neutral-800 hover:bg-neutral-200"
              >
                <X size={10} weight="bold" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

export const GroupIcon = () => <UsersThree size={15} />
export const CourseIcon = () => <BookOpen size={15} />

// ---------------------------------------------------------------------------
// Status, dates
// ---------------------------------------------------------------------------

const STATUS_LOOK: Record<InvitationStatus, { tone: ChipTone; icon: React.ReactNode }> = {
  pending: { tone: 'amber', icon: <ClockCountdown size={12} /> },
  accepted: { tone: 'emerald', icon: <CheckCircle size={12} weight="fill" /> },
  declined: { tone: 'neutral', icon: <XCircle size={12} weight="fill" /> },
  revoked: { tone: 'rose', icon: <Prohibit size={12} /> },
  expired: { tone: 'neutral', icon: <ClockCountdown size={12} /> },
}

export function InvitationStatusChip({ status }: { status: InvitationStatus }) {
  const { t } = useTranslation()
  const look = STATUS_LOOK[status] ?? STATUS_LOOK.pending
  return (
    <Chip tone={look.tone} icon={look.icon}>
      {t(`dashboard.users.invitations.status.${status}`)}
    </Chip>
  )
}

export const EXPIRY_CHOICES = [1, 3, 7, 14, 30, 60, 90]

export function daysUntil(iso?: string | null): number | null {
  if (!iso) return null
  const ms = new Date(iso).getTime() - Date.now()
  return Number.isNaN(ms) ? null : Math.ceil(ms / 86_400_000)
}

export function formatDate(iso: string | null | undefined, locale: string) {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(d)
}

/** "Members 5 of 10" style usage line for a capacity bucket. */
export function CapacityMeter({
  label,
  used,
  pending,
  limit,
  extra = 0,
}: {
  label: string
  used: number
  pending: number
  limit: number | null
  extra?: number
}) {
  const { t } = useTranslation()
  if (limit === null) return null
  const total = used + pending + extra
  const over = total > limit
  const pct = limit > 0 ? Math.min(100, Math.round((total / limit) * 100)) : 100
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="font-medium text-neutral-700 truncate">{label}</span>
        <span className={`tabular-nums ${over ? 'text-rose-600 font-semibold' : 'text-neutral-500'}`}>
          {t('dashboard.users.invitations.capacity.of', { count: total, limit })}
        </span>
      </div>
      <div className="mt-1.5 h-1.5 rounded-full bg-neutral-100 overflow-hidden">
        <div className={`h-full rounded-full ${over ? 'bg-rose-500' : pct > 80 ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${pct}%` }} />
      </div>
      {pending > 0 && (
        <p className="mt-1 text-[11px] text-neutral-400">{t('dashboard.users.invitations.capacity.pending_note', { count: pending })}</p>
      )}
    </div>
  )
}
