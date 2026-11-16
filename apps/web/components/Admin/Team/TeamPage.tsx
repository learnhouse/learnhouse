'use client'
import React from 'react'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Check, Info, Minus, Trash, UserPlus, UserSwitch, UsersThree } from '@phosphor-icons/react'
import {
  Button,
  Chip,
  ConfirmDialog,
  DashPage,
  EmptyState,
  FieldLabel,
  INPUT,
  Modal,
  Panel,
  SectionCard,
  TEXTAREA,
  recipes,
  formatRelative,
} from '@/design'
import { addTeamMember, errorMessage, getTeam, removeTeamMember, setTeamImpersonation, updateTeamMember } from '@services/ee/platform/api'
import { platformKeys } from '@services/ee/platform/keys'
import {
  ALL_PERMISSIONS,
  DEFAULT_ROLE_PERMISSIONS,
  PLATFORM_ROLES,
  type PlatformPermission,
  type PlatformRole,
  type TeamMember,
} from '@services/ee/platform/types'
import { useAccessToken, usePlatformMe, useUrlQuery, shouldRetry } from '@components/Admin/hooks'
import FilterBar, { type FilterDef } from '@components/Admin/Shared/FilterBar'
import { AdminHeader, Avatar, ListSkeleton, NoAccess, QueryError, RoleBadge, adminPath, formatDate } from '@components/Admin/Shared/AdminKit'

const ROLE_RANK: Record<string, number> = { owner: 0, admin: 1, support: 2, sales: 3, viewer: 4 }

function grantedByLabel(g: TeamMember['granted_by']): string | null {
  if (!g) return null
  if (typeof g === 'string') return g
  if (typeof g === 'number') return `#${g}`
  return g.username ?? null
}

export default function TeamPage() {
  const { t, i18n } = useTranslation()
  const token = useAccessToken()
  const me = usePlatformMe()
  const qc = useQueryClient()
  const canManage = me.can('team.manage')
  const isOwner = me.role === 'owner'

  const [filters, setFilters] = useUrlQuery()
  const search = (filters.q ?? '').trim().toLowerCase()
  const roleFilter = filters.role

  // The team is small, so it loads once, unfiltered, and is filtered here:
  // the role counts and the last-owner guard need every member.
  const q = useQuery({
    queryKey: platformKeys.team(),
    queryFn: () => getTeam(token),
    enabled: !!token && me.can('platform.read'),
    retry: shouldRetry,
  })

  const allMembers = Array.isArray(q.data?.members) ? q.data!.members : []
  const ownerCount = allMembers.filter((m) => m.role === 'owner').length
  const members = allMembers.filter(
    (m) =>
      (!roleFilter || m.role === roleFilter) &&
      (!search || `${m.username} ${m.email} ${m.note ?? ''}`.toLowerCase().includes(search))
  )
  const roleCounts = allMembers.reduce<Record<string, number>>((acc, m) => {
    acc[m.role] = (acc[m.role] ?? 0) + 1
    return acc
  }, {})
  const filterDefs: FilterDef[] = [
    {
      key: 'role',
      kind: 'select',
      label: t('admin.team.col_role'),
      icon: <UsersThree size={14} />,
      options: PLATFORM_ROLES.map((r) => ({ value: r, label: t(`admin.roles.${r}`), count: roleCounts[r] ?? 0 })),
    },
  ]
  const filtered = !!search || !!roleFilter

  const [addOpen, setAddOpen] = React.useState(false)
  const [pendingRole, setPendingRole] = React.useState<{ member: TeamMember; role: string } | null>(null)
  const [removing, setRemoving] = React.useState<TeamMember | null>(null)

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: platformKeys.team() })
    qc.invalidateQueries({ queryKey: platformKeys.me() })
  }

  const roleMutation = useMutation({
    mutationFn: ({ userId, role }: { userId: number; role: string }) => updateTeamMember(token, userId, { role }),
    onSuccess: () => {
      toast.success(t('admin.team.role_updated'))
      invalidate()
    },
    onError: (e) => toast.error(errorMessage(e, t('admin.team.update_failed'))),
  })

  const impersonationMutation = useMutation({
    mutationFn: ({ userId, level }: { userId: number; level: 'default' | 'none' | 'readonly' | 'full' }) =>
      setTeamImpersonation(token, userId, level),
    onSuccess: () => {
      toast.success(t('admin.team.impersonation_updated'))
      invalidate()
    },
    onError: (e) => toast.error(errorMessage(e, t('admin.team.update_failed'))),
  })

  const removeMutation = useMutation({
    mutationFn: (userId: number) => removeTeamMember(token, userId),
    onSuccess: () => {
      toast.success(t('admin.team.removed'))
      invalidate()
    },
    onError: (e) => toast.error(errorMessage(e, t('admin.team.remove_failed'))),
  })

  if (!me.isLoading && !me.can('platform.read')) {
    return (
      <DashPage>
        <AdminHeader title={t('admin.team.title')} />
        <NoAccess />
      </DashPage>
    )
  }

  // Why a member's role/removal controls are locked, or null when editable.
  const lockReason = (m: TeamMember): string | null => {
    if (!canManage) return t('admin.team.lock_owner_only')
    if (m.is_you || m.user_id === me.userId) return t('admin.team.lock_self')
    if (m.role === 'owner' && ownerCount <= 1) return t('admin.team.lock_last_owner')
    if (m.role === 'owner' && !isOwner) return t('admin.team.lock_owner_only')
    return null
  }

  const assignableRoles = PLATFORM_ROLES.filter((r) => r !== 'owner' || isOwner)

  return (
    <DashPage bottom="lg">
      <AdminHeader
        title={t('admin.team.title')}
        subtitle={t('admin.team.subtitle')}
        actions={
          canManage ? (
            <Button variant="primary" icon={<UserPlus size={14} weight="bold" />} onClick={() => setAddOpen(true)}>
              {t('admin.team.add_member')}
            </Button>
          ) : undefined
        }
      />

      {!canManage && !me.isLoading && (
        <div className="flex items-start gap-2 rounded-xl bg-sky-50 px-4 py-3 text-sm text-sky-800 ring-1 ring-inset ring-sky-600/10">
          <Info size={16} className="mt-0.5 shrink-0" />
          {t('admin.team.read_only_hint')}
        </div>
      )}

      <FilterBar
        values={filters}
        onChange={setFilters}
        defs={filterDefs}
        search={{ key: 'q', placeholder: t('admin.team.search_placeholder') }}
      />

      {q.isLoading ? (
        <ListSkeleton rows={4} />
      ) : q.error ? (
        <QueryError error={q.error} onRetry={() => q.refetch()} />
      ) : members.length === 0 ? (
        <Panel>
          {filtered ? (
            <EmptyState
              icon={<UsersThree size={22} />}
              title={t('admin.team.no_match_title')}
              description={t('admin.team.no_match_desc')}
              action={
                <Button size="sm" onClick={() => setFilters({ q: undefined, role: undefined })}>
                  {t('admin.users.clear_filters')}
                </Button>
              }
            />
          ) : (
            <EmptyState icon={<UsersThree size={22} />} title={t('admin.team.empty_title')} description={t('admin.team.empty_desc')} />
          )}
        </Panel>
      ) : (
        <Panel divided>
          <div className={`${recipes.tableHead} hidden md:grid grid-cols-[minmax(0,2fr)_10rem_minmax(0,1fr)_8rem_3rem] gap-4`}>
            <span>{t('admin.team.col_member')}</span>
            <span>{t('admin.team.col_role')}</span>
            <span>{t('admin.team.col_granted_by')}</span>
            <span>{t('admin.team.col_since')}</span>
            <span />
          </div>
          {members.map((m) => {
            const lock = lockReason(m)
            const you = m.is_you || m.user_id === me.userId
            return (
              <div
                key={m.user_id}
                className="grid grid-cols-[minmax(0,1fr)_auto] md:grid-cols-[minmax(0,2fr)_10rem_minmax(0,1fr)_8rem_3rem] items-center gap-x-4 gap-y-2 px-5 py-3.5 hover:bg-neutral-50/70"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <Avatar user={m} size={32} />
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <Link href={adminPath.user(m.user_id)} className="text-sm font-semibold text-neutral-900 truncate hover:underline underline-offset-2">
                        {m.username}
                      </Link>
                      {you && <Chip className="!py-0 !px-1.5 !text-[10px]">{t('admin.team.you')}</Chip>}
                    </div>
                    <p className="text-xs text-neutral-500 truncate">{m.email}</p>
                    {m.note && <p className="text-xs text-neutral-400 truncate">{m.note}</p>}
                    {m.impersonation && (
                      <div className="mt-1 flex items-center gap-1.5 text-[11px] text-neutral-500">
                        <UserSwitch size={12} className="shrink-0 text-amber-600" />
                        <span className="shrink-0">{t('admin.team.impersonation_label')}</span>
                        {canManage ? (
                          <select
                            value={m.impersonation.override ?? 'default'}
                            aria-label={t('admin.team.impersonation_for', { name: m.username })}
                            onChange={(e) => impersonationMutation.mutate({ userId: m.user_id, level: e.target.value as any })}
                            className="h-6 rounded-md bg-white ring-1 ring-inset ring-neutral-200 px-1.5 text-[11px] font-semibold text-neutral-700 focus:outline-none focus:ring-2 focus:ring-neutral-900/15"
                            data-testid={`team-impersonation-${m.user_id}`}
                          >
                            <option value="default">
                              {t('admin.team.impersonation_default', { level: t(`admin.team.impersonation_${m.impersonation.default}`) })}
                            </option>
                            <option value="none">{t('admin.team.impersonation_none')}</option>
                            <option value="readonly">{t('admin.team.impersonation_readonly')}</option>
                            <option value="full">{t('admin.team.impersonation_full')}</option>
                          </select>
                        ) : (
                          <span className="font-semibold text-neutral-700">{t(`admin.team.impersonation_${m.impersonation.level}`)}</span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex items-center justify-end md:justify-start gap-2" title={lock ?? undefined}>
                  {lock ? (
                    <RoleBadge role={m.role} />
                  ) : (
                    <select
                      value={m.role}
                      aria-label={t('admin.team.change_role_for', { name: m.username })}
                      onChange={(e) => setPendingRole({ member: m, role: e.target.value })}
                      className="h-8 rounded-lg bg-white ring-1 ring-inset ring-neutral-200 px-2 text-xs font-semibold text-neutral-700 focus:outline-none focus:ring-2 focus:ring-neutral-900/15"
                    >
                      {assignableRoles.map((r) => (
                        <option key={r} value={r}>
                          {t(`admin.roles.${r}`)}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
                <span className="hidden md:block text-sm text-neutral-500 truncate">
                  {m.granted_by && typeof m.granted_by === 'object' && (m.granted_by as { user_id?: number }).user_id ? (
                    <Link href={adminPath.user((m.granted_by as { user_id: number }).user_id)} className="hover:text-neutral-900 hover:underline underline-offset-2">
                      {grantedByLabel(m.granted_by)}
                    </Link>
                  ) : (
                    grantedByLabel(m.granted_by) ?? '–'
                  )}
                </span>
                <span className="hidden md:block text-xs text-neutral-500" title={formatDate(m.created_at, i18n.language, true)}>
                  {formatRelative(m.created_at, i18n.language) ?? '–'}
                </span>
                <div className={lock ? 'hidden md:flex justify-end' : 'col-span-2 md:col-span-1 flex justify-end'}>
                  {canManage && (
                    <Button
                      variant="danger-ghost"
                      size="icon"
                      disabled={!!lock}
                      title={lock ?? t('admin.team.remove')}
                      aria-label={t('admin.team.remove_member', { name: m.username })}
                      onClick={() => setRemoving(m)}
                      icon={<Trash size={14} />}
                    />
                  )}
                </div>
              </div>
            )
          })}
        </Panel>
      )}

      <RoleMatrix roles={q.data?.roles} />

      <AddMemberModal
        open={addOpen}
        onOpenChange={setAddOpen}
        roles={assignableRoles}
        onAdded={() => {
          setAddOpen(false)
          invalidate()
        }}
      />

      <ConfirmDialog
        open={!!pendingRole}
        onOpenChange={(o) => !o && setPendingRole(null)}
        tone="info"
        title={t('admin.team.confirm_role_title')}
        message={
          pendingRole
            ? t('admin.team.confirm_role_body', {
                name: pendingRole.member.username,
                from: t(`admin.roles.${pendingRole.member.role}`, { defaultValue: pendingRole.member.role }),
                to: t(`admin.roles.${pendingRole.role}`),
              })
            : ''
        }
        confirmLabel={t('admin.team.change_role')}
        onConfirm={async () => {
          if (pendingRole) await roleMutation.mutateAsync({ userId: pendingRole.member.user_id, role: pendingRole.role }).catch(() => {})
        }}
      />

      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={t('admin.team.confirm_remove_title')}
        message={removing ? t('admin.team.confirm_remove_body', { name: removing.username }) : ''}
        confirmLabel={t('admin.team.remove')}
        onConfirm={async () => {
          if (removing) await removeMutation.mutateAsync(removing.user_id).catch(() => {})
        }}
      />
    </DashPage>
  )
}

function RoleMatrix({ roles }: { roles?: { key: string; permissions: PlatformPermission[] }[] }) {
  const { t } = useTranslation()
  const matrix: { key: string; permissions: Set<string> }[] =
    Array.isArray(roles) && roles.length
      ? roles.map((r) => ({ key: r.key, permissions: new Set(Array.isArray(r.permissions) ? r.permissions : []) }))
      : PLATFORM_ROLES.map((r) => ({ key: r, permissions: new Set(DEFAULT_ROLE_PERMISSIONS[r as PlatformRole]) }))
  matrix.sort((a, b) => (ROLE_RANK[a.key] ?? 9) - (ROLE_RANK[b.key] ?? 9))

  return (
    <SectionCard
      icon={<UsersThree size={18} />}
      title={t('admin.team.matrix_title')}
      description={t('admin.team.matrix_desc')}
      bodyClassName="p-0 pt-4"
    >
      <div className="overflow-x-auto scrollbar-hide">
        <table className="w-full min-w-[560px] text-sm">
          <thead>
            <tr className="border-y border-neutral-100 text-xs text-neutral-500">
              <th className="px-5 py-2.5 text-start font-medium">{t('admin.team.permission')}</th>
              {matrix.map((r) => (
                <th key={r.key} className="px-3 py-2.5 text-center font-medium">
                  {t(`admin.roles.${r.key}`, { defaultValue: r.key })}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {ALL_PERMISSIONS.map((p) => (
              <tr key={p} className="hover:bg-neutral-50/70">
                <td className="px-5 py-2">
                  <span className="block text-[13px] text-neutral-800">{t(`admin.permissions.${p.replace(/\./g, '_')}`)}</span>
                  <code className="text-[11px] text-neutral-400" dir="ltr">
                    {p}
                  </code>
                </td>
                {matrix.map((r) => (
                  <td key={r.key} className="px-3 py-2 text-center">
                    {r.permissions.has(p) ? (
                      <Check size={15} weight="bold" className="inline text-emerald-600" aria-label={t('admin.team.allowed')} />
                    ) : (
                      <Minus size={15} className="inline text-neutral-300" aria-label={t('admin.team.not_allowed')} />
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </SectionCard>
  )
}

function AddMemberModal({
  open,
  onOpenChange,
  roles,
  onAdded,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  roles: PlatformRole[]
  onAdded: () => void
}) {
  const { t } = useTranslation()
  const token = useAccessToken()
  const [identity, setIdentity] = React.useState('')
  const [role, setRole] = React.useState<PlatformRole>('viewer')
  const [note, setNote] = React.useState('')
  const [error, setError] = React.useState('')

  React.useEffect(() => {
    if (open) {
      setIdentity('')
      setRole('viewer')
      setNote('')
      setError('')
    }
  }, [open])

  const m = useMutation({
    mutationFn: () => {
      const v = identity.trim()
      return addTeamMember(token, { ...(v.includes('@') ? { email: v } : { username: v }), role, note: note.trim() || undefined })
    },
    onSuccess: () => {
      toast.success(t('admin.team.added'))
      onAdded()
    },
    onError: (e) => setError(errorMessage(e, t('admin.team.add_failed'))),
  })

  return (
    <Modal
      isDialogOpen={open}
      onOpenChange={onOpenChange}
      size="sm"
      icon={<UserPlus size={18} />}
      dialogTitle={t('admin.team.add_member')}
      dialogDescription={t('admin.team.add_desc')}
      preventClose={m.isPending}
      footer={
        <div className="flex justify-end gap-2">
          <Button onClick={() => onOpenChange(false)} disabled={m.isPending}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" loading={m.isPending} disabled={!identity.trim()} onClick={() => m.mutate()}>
            {t('admin.team.add_member')}
          </Button>
        </div>
      }
      dialogContent={
        <div className="flex flex-col gap-4">
          <div>
            <FieldLabel hint={t('admin.team.identity_hint')}>{t('admin.team.identity')}</FieldLabel>
            <input autoFocus className={INPUT} value={identity} onChange={(e) => setIdentity(e.target.value)} placeholder="jane@company.com" />
          </div>
          <div>
            <FieldLabel>{t('admin.team.col_role')}</FieldLabel>
            <select className={INPUT} value={role} onChange={(e) => setRole(e.target.value as PlatformRole)}>
              {roles.map((r) => (
                <option key={r} value={r}>
                  {t(`admin.roles.${r}`)}
                </option>
              ))}
            </select>
            <p className="mt-1.5 text-xs text-neutral-500">{t(`admin.team.role_desc.${role}`)}</p>
          </div>
          <div>
            <FieldLabel hint={t('common.optional')}>{t('admin.team.note')}</FieldLabel>
            <textarea className={TEXTAREA} rows={2} maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('admin.team.note_placeholder')} />
          </div>
          {error && <p className="text-sm text-rose-600">{error}</p>}
        </div>
      }
    />
  )
}
