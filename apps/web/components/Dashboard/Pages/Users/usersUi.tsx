'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { CaretDown, CaretLeft, CaretRight, Check, CheckCircle, Crown, ShieldStar, User } from '@phosphor-icons/react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@components/ui/dropdown-menu'
import { Chip, type ChipTone } from '@components/Dashboard/Shared/DashKit/DashKit'
import UserAvatar from '@components/Objects/UserAvatar'
import { getUserAvatarMediaDirectory } from '@services/media/media'

// Small building blocks shared by the members, invitations and user-group
// screens, so a person or a role looks the same on every one of them.

export function displayName(user: any): string {
  const full = [user?.first_name, user?.last_name].filter(Boolean).join(' ').trim()
  return full || user?.username || user?.email || ''
}

export function roleKind(name?: string): 'admin' | 'staff' | 'member' {
  const n = (name || '').toLowerCase()
  if (n.includes('admin')) return 'admin'
  if (n.includes('maintainer') || n.includes('teacher') || n.includes('instructor')) return 'staff'
  return 'member'
}

const ROLE_TONE: Record<ReturnType<typeof roleKind>, ChipTone> = { admin: 'violet', staff: 'sky', member: 'neutral' }

export function RoleIcon({ name, size = 12 }: { name?: string; size?: number }) {
  const kind = roleKind(name)
  if (kind === 'admin') return <Crown size={size} weight="fill" />
  if (kind === 'staff') return <ShieldStar size={size} weight="fill" />
  return <User size={size} />
}

export function RoleChip({ name }: { name?: string }) {
  return (
    <Chip tone={ROLE_TONE[roleKind(name)]} icon={<RoleIcon name={name} />}>
      {name || '—'}
    </Chip>
  )
}

export function roleTone(name?: string): ChipTone {
  return ROLE_TONE[roleKind(name)]
}

const PICKER_TONES: Record<string, string> = {
  violet: 'text-violet-800 bg-violet-50 ring-violet-600/10',
  sky: 'text-sky-800 bg-sky-50 ring-sky-600/10',
  neutral: 'text-neutral-700 bg-neutral-100/80 ring-neutral-900/5',
}

// The role as a chip that opens a menu of roles when it may be changed.
// Picking one only reports it: callers confirm before saving anything.
export function RolePicker({
  role,
  roles,
  disabled,
  onPick,
}: {
  role?: { name?: string; role_uuid?: string } | null
  roles?: any[]
  disabled?: boolean
  onPick: (_role: any) => void
}) {
  const { t } = useTranslation()
  const name = role?.name
  const chipClass = `inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold whitespace-nowrap ring-1 ring-inset shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] ${PICKER_TONES[roleTone(name)] ?? PICKER_TONES.neutral}`

  if (disabled || !roles?.length) {
    return (
      <span className={chipClass}>
        <RoleIcon name={name} />
        {name || '—'}
      </span>
    )
  }
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={`${chipClass} hover:brightness-[0.98] data-[state=open]:ring-2 transition`}
          aria-label={t('dashboard.users.dash.members.change_role')}
        >
          <RoleIcon name={name} />
          {name || '—'}
          <CaretDown size={10} className="opacity-60" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56 rounded-xl p-1.5">
        <DropdownMenuLabel className="text-xs font-medium text-neutral-500">
          {t('dashboard.users.dash.members.change_role')}
        </DropdownMenuLabel>
        {roles.map((r: any) => {
          const current = role?.role_uuid ? r.role_uuid === role.role_uuid : r.name === name
          return (
            <DropdownMenuItem
              key={r.id}
              disabled={current}
              onSelect={() => !current && onPick(r)}
              className="flex items-center gap-2 cursor-pointer"
            >
              <span className="text-neutral-500">
                <RoleIcon name={r.name} size={14} />
              </span>
              <span className="flex-1 truncate">{r.name}</span>
              {current && <CheckCircle size={14} weight="fill" className="text-neutral-900" />}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// Avatar + name + secondary line. `user` is the API's user object.
export function PersonCell({
  user,
  secondary,
  size = 36,
  popup = true,
  onOpen,
  children,
}: {
  user: any
  secondary?: React.ReactNode
  size?: number
  popup?: boolean
  /** Makes the name a button (e.g. opening the member panel). */
  onOpen?: () => void
  children?: React.ReactNode
}) {
  return (
    <div className="flex items-center gap-3 min-w-0">
      <div className="shrink-0">
        <UserAvatar
          width={size}
          avatar_url={user?.avatar_image ? getUserAvatarMediaDirectory(user.user_uuid, user.avatar_image) : undefined}
          predefined_avatar={user?.avatar_image ? undefined : 'empty'}
          userId={user?.id?.toString()}
          rounded="rounded-full"
          showProfilePopup={popup}
        />
      </div>
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 min-w-0">
          {onOpen ? (
            <button
              type="button"
              data-open-member=""
              onClick={onOpen}
              className="text-sm font-semibold text-neutral-900 truncate text-start hover:underline underline-offset-2 decoration-neutral-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/20 rounded"
              dir="auto"
            >
              {displayName(user)}
            </button>
          ) : (
            <span className="text-sm font-semibold text-neutral-900 truncate" dir="auto">
              {displayName(user)}
            </span>
          )}
          {user?.username && <span className="text-xs text-neutral-400 truncate">@{user.username}</span>}
        </div>
        {secondary !== undefined ? (
          <div className="text-xs text-neutral-500 truncate">{secondary}</div>
        ) : (
          user?.email && <div className="text-xs text-neutral-500 truncate">{user.email}</div>
        )}
        {children}
      </div>
    </div>
  )
}

// Hand-drawn checkbox, matching the course list's selection boxes.
export function CheckBox({
  checked,
  indeterminate,
  onChange,
  label,
  indicator = false,
}: {
  checked: boolean
  indeterminate?: boolean
  onChange?: () => void
  label: string
  // Inside a row that is itself the button: render a plain visual box (a
  // <button> can't contain another <button>); the row carries the checkbox role.
  indicator?: boolean
}) {
  const box = `w-[18px] h-[18px] rounded-[5px] flex items-center justify-center transition-colors shrink-0 ${
    checked || indeterminate
      ? 'bg-neutral-900 text-white'
      : 'bg-white ring-1 ring-inset ring-neutral-300 hover:ring-neutral-500'
  }`
  const mark = checked ? <Check size={12} weight="bold" /> : indeterminate ? <span className="w-2 h-0.5 rounded bg-white" /> : null
  if (indicator) {
    return (
      <span aria-hidden="true" className={box}>
        {mark}
      </span>
    )
  }
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={indeterminate ? 'mixed' : checked}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation()
        onChange?.()
      }}
      className={box}
    >
      {mark}
    </button>
  )
}

// "1–10 of 42" with previous/next, shared by every paginated users list.
export function ListPager({
  page,
  pageSize,
  total,
  onPage,
}: {
  page: number
  pageSize: number
  total: number
  onPage: (_page: number) => void
}) {
  const { t } = useTranslation()
  const pages = Math.max(1, Math.ceil(total / pageSize))
  if (total <= pageSize) return null
  const btn =
    'h-7 w-7 inline-flex items-center justify-center rounded-md text-neutral-500 hover:text-neutral-900 hover:bg-neutral-100 disabled:opacity-40 disabled:pointer-events-none transition-colors'
  return (
    <div className="flex items-center justify-between gap-3 px-4 sm:px-5 py-3 border-t border-neutral-100 text-xs text-neutral-500">
      <span className="tabular-nums">
        {t('dashboard.users.dash.members.range', {
          start: (page - 1) * pageSize + 1,
          end: Math.min(page * pageSize, total),
          total,
        })}
      </span>
      <div className="flex items-center gap-1">
        <button type="button" className={btn} disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label={t('pagination.previous')}>
          <CaretLeft size={14} className="rtl:rotate-180" />
        </button>
        <span className="tabular-nums px-1.5 font-medium text-neutral-700">
          {page} / {pages}
        </span>
        <button type="button" className={btn} disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label={t('pagination.next')}>
          <CaretRight size={14} className="rtl:rotate-180" />
        </button>
      </div>
    </div>
  )
}

export function RowSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="divide-y divide-neutral-100 animate-pulse">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 sm:px-5 py-3.5">
          <div className="w-[18px] h-[18px] rounded-[5px] bg-neutral-100" />
          <div className="w-9 h-9 rounded-full bg-neutral-100" />
          <div className="flex-1 space-y-1.5">
            <div className="h-3.5 w-40 max-w-full rounded bg-neutral-100" />
            <div className="h-3 w-56 max-w-full rounded bg-neutral-100/70" />
          </div>
          <div className="hidden sm:block h-6 w-20 rounded-full bg-neutral-100" />
          <div className="hidden lg:block h-6 w-16 rounded-full bg-neutral-100" />
        </div>
      ))}
    </div>
  )
}

// Debounced copy of a value, for server-side search boxes.
export function useDebounced<T>(value: T, delay = 250): T {
  const [debounced, setDebounced] = React.useState(value)
  React.useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(id)
  }, [value, delay])
  return debounced
}
