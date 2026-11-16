'use client'
import React from 'react'
import toast from 'react-hot-toast'
import { useTranslation } from 'react-i18next'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowClockwise,
  BookOpen,
  DotsThree,
  EnvelopeSimple,
  LinkSimple,
  PaperPlaneTilt,
  PencilSimple,
  Prohibit,
  UserPlus,
  UsersThree,
  WarningCircle,
} from '@phosphor-icons/react'
import {
  BulkActionBar,
  BulkActionButton,
  Button,
  Chip,
  ConfirmDialog,
  EmptyState,
  SegmentedControl,
  formatRelative,
} from '@components/Dashboard/Shared/DashKit/DashKit'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@components/ui/dropdown-menu'
import { removeInvitedUser } from '@services/organizations/invites'
import {
  bulkInvitations,
  invitationLink,
  listInvitations,
  resendInvitation,
  revokeInvitation,
  type Invitation,
  type InvitationList,
  type InvitationStatus,
  type LegacyInvitation,
} from '@services/organizations/invitations'
import { getErrorMessage } from '@services/utils/ts/errorMessage'
import { CheckBox, ListPager, RoleChip, RowSkeleton } from '../usersUi'
import EditInvitationDialog from './EditInvitationDialog'
import { InvitationStatusChip, daysUntil, invitationKeys, useInvitationAuth, useRoleText } from './invitationsKit'

const PAGE = 25
type Filter = '' | InvitationStatus
const ITEM = 'flex items-center gap-2 cursor-pointer'

export function useInvitationList(params: { status: Filter; q: string; page: number }, enabled = true) {
  const { orgId, token } = useInvitationAuth()
  return useQuery({
    queryKey: invitationKeys.list(orgId, params),
    queryFn: async () => {
      const res = await listInvitations(orgId, token, { ...params, limit: PAGE })
      if (!res.success) throw Object.assign(new Error('list'), { detail: res.data?.detail })
      return res.data as InvitationList
    },
    enabled: enabled && !!orgId && !!token,
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  })
}

async function copy(text: string) {
  await navigator.clipboard.writeText(text)
}

/** Invitations of the org: filter by status, search, act on one or many. */
export default function InvitationsPanel({
  search = '',
  onInvite,
  status: controlledStatus,
  onStatusChange,
  showFilters = true,
}: {
  search?: string
  onInvite?: () => void
  status?: Filter
  onStatusChange?: (_s: Filter) => void
  showFilters?: boolean
}) {
  const { t, i18n } = useTranslation()
  const { orgId, token } = useInvitationAuth()
  const queryClient = useQueryClient()
  const roleText = useRoleText()
  const [ownStatus, setOwnStatus] = React.useState<Filter>('')
  const status = controlledStatus ?? ownStatus
  const setStatus = onStatusChange ?? setOwnStatus
  const [page, setPage] = React.useState(1)
  const [selected, setSelected] = React.useState<Set<string>>(new Set())
  const [editing, setEditing] = React.useState<Invitation | null>(null)
  const [revoking, setRevoking] = React.useState<Invitation | null>(null)
  const [revokingLegacy, setRevokingLegacy] = React.useState<LegacyInvitation | null>(null)
  const [bulkRevoke, setBulkRevoke] = React.useState(false)
  const [busy, setBusy] = React.useState<string | null>(null)

  // Back to page one when the filter or search changes (adjusted during render).
  const filterKey = `${status}|${search}`
  const [lastKey, setLastKey] = React.useState(filterKey)
  if (lastKey !== filterKey) {
    setLastKey(filterKey)
    setPage(1)
    setSelected(new Set())
  }

  const { data, isLoading, error, refetch } = useInvitationList({ status, q: search.trim(), page })
  const items = data?.items ?? []
  const legacy = page === 1 ? (data?.legacy ?? []) : []
  const counts = data?.counts
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: invitationKeys.all(orgId) })
    queryClient.invalidateQueries({ queryKey: ['org', orgId, 'invitedUsers'] })
  }

  const actionable = (inv: Invitation) => inv.status === 'pending' || inv.status === 'expired'
  const selectable = items.filter(actionable)
  const allSelected = selectable.length > 0 && selectable.every((i) => selected.has(i.invitation_uuid))
  const toggle = (uuid: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(uuid)) next.delete(uuid)
      else next.add(uuid)
      return next
    })

  const run = async (inv: Invitation, kind: 'resend' | 'link' | 'revoke') => {
    setBusy(inv.invitation_uuid)
    try {
      if (kind === 'resend') {
        const res = await resendInvitation(orgId, inv.invitation_uuid, token)
        if (!res.success) throw res
        if (res.data?.resent) toast.success(t('dashboard.users.invitations.toasts.resent', { email: inv.email }))
        else toast.error(t('dashboard.users.invitations.toasts.email_failed'))
      } else if (kind === 'link') {
        const res = await invitationLink(orgId, inv.invitation_uuid, token)
        if (!res.success) throw res
        try {
          await copy(res.data.url)
          toast.success(t('dashboard.users.invitations.toasts.link_copied'))
        } catch {
          toast.error(t('dashboard.users.dash.signups.copy_failed'))
        }
      } else {
        const res = await revokeInvitation(orgId, inv.invitation_uuid, token)
        if (!res.success) throw res
        toast.success(t('dashboard.users.invitations.toasts.revoked'))
      }
      refresh()
    } catch (e: any) {
      toast.error(getErrorMessage(e?.data?.detail, t('dashboard.users.invitations.toasts.error')))
    } finally {
      setBusy(null)
    }
  }

  const runBulk = async (action: 'resend' | 'revoke') => {
    const uuids = Array.from(selected)
    const res = await bulkInvitations(orgId, action, uuids, token)
    if (res.success) {
      const done = (res.data.results as any[]).filter((r) => r.status === (action === 'resend' ? 'resent' : 'revoked')).length
      toast.success(t(`dashboard.users.invitations.toasts.bulk_${action}`, { count: done }))
      setSelected(new Set())
      refresh()
    } else {
      toast.error(getErrorMessage(res.data?.detail, t('dashboard.users.invitations.toasts.error')))
    }
  }

  const removeLegacy = async (inv: LegacyInvitation) => {
    const res = await removeInvitedUser(orgId, inv.email, token)
    if (res.status === 200) toast.success(t('dashboard.users.invitations.toasts.revoked'))
    else toast.error(t('dashboard.users.invitations.toasts.error'))
    refresh()
  }

  const filters = showFilters ? (
    <div className="px-4 sm:px-5 pb-3 overflow-x-auto scrollbar-hide">
      <SegmentedControl<Filter>
        ariaLabel={t('dashboard.users.invitations.list.filter')}
        value={status}
        onChange={setStatus}
        options={[
          { key: '', label: t('dashboard.users.invitations.list.all') },
          { key: 'pending', label: t('dashboard.users.invitations.status.pending'), count: counts?.pending },
          { key: 'accepted', label: t('dashboard.users.invitations.status.accepted'), count: counts?.accepted },
          { key: 'expired', label: t('dashboard.users.invitations.status.expired'), count: counts?.expired },
          { key: 'revoked', label: t('dashboard.users.invitations.status.revoked'), count: counts?.revoked },
          { key: 'declined', label: t('dashboard.users.invitations.status.declined'), count: counts?.declined },
        ]}
      />
    </div>
  ) : null

  let content: React.ReactNode
  if (isLoading && !data) content = <RowSkeleton rows={4} />
  else if (error)
    content = (
      <EmptyState
        icon={<WarningCircle size={22} />}
        title={t('dashboard.users.invitations.list.error')}
        description={getErrorMessage((error as any)?.detail, '')}
        action={<Button onClick={() => refetch()}>{t('common.retry')}</Button>}
      />
    )
  else if (!items.length && !legacy.length)
    content = (
      <EmptyState
        icon={<EnvelopeSimple size={22} />}
        title={search || status ? t('dashboard.users.invitations.list.no_results') : t('dashboard.users.invitations.list.empty_title')}
        description={search || status ? undefined : t('dashboard.users.invitations.list.empty_description')}
        action={
          search || status ? (
            status ? <Button onClick={() => setStatus('')}>{t('dashboard.users.invitations.list.clear_filter')}</Button> : undefined
          ) : onInvite ? (
            <Button variant="primary" icon={<UserPlus size={14} />} onClick={onInvite}>
              {t('dashboard.users.invitations.invite_people')}
            </Button>
          ) : undefined
        }
      />
    )
  else
    content = (
      <>
        <div className="hidden md:grid grid-cols-[28px_minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)_140px_36px] items-center gap-3 px-5 py-2.5 text-xs font-medium text-neutral-500 border-b border-neutral-100">
          <CheckBox
            checked={allSelected}
            indeterminate={!allSelected && selectable.some((i) => selected.has(i.invitation_uuid))}
            onChange={() => setSelected(allSelected ? new Set() : new Set(selectable.map((i) => i.invitation_uuid)))}
            label={t('dashboard.users.invitations.list.select_all')}
          />
          <span>{t('dashboard.users.invitations.list.person')}</span>
          <span>{t('dashboard.users.invitations.list.role')}</span>
          <span>{t('dashboard.users.invitations.list.access')}</span>
          <span>{t('dashboard.users.invitations.list.status')}</span>
          <span />
        </div>
        <ul className="divide-y divide-neutral-100">
          {items.map((inv) => {
            const left = daysUntil(inv.expires_at)
            const canAct = actionable(inv)
            const roleName = inv.role ? roleText({ role_uuid: inv.role.role_uuid, name: inv.role.name }).name : '—'
            return (
              <li
                key={inv.invitation_uuid}
                className="group grid grid-cols-[28px_minmax(0,1fr)_36px] md:grid-cols-[28px_minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)_140px_36px] items-center gap-x-3 gap-y-2 px-4 sm:px-5 py-3 hover:bg-neutral-50/70 transition-colors"
              >
                <span className={canAct ? '' : 'invisible'}>
                  <CheckBox
                    checked={selected.has(inv.invitation_uuid)}
                    onChange={() => toggle(inv.invitation_uuid)}
                    label={t('dashboard.users.invitations.list.select', { email: inv.email })}
                  />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-neutral-900 truncate" dir="ltr">
                    {inv.email}
                  </p>
                  <p className="text-xs text-neutral-500 truncate">
                    {inv.status === 'accepted' && inv.accepted_at
                      ? t('dashboard.users.invitations.list.joined', { when: formatRelative(inv.accepted_at, i18n.language) })
                      : inv.invited_by
                        ? t('dashboard.users.invitations.list.invited_by', {
                            name: inv.invited_by.name,
                            when: formatRelative(inv.created_at, i18n.language),
                          })
                        : formatRelative(inv.created_at, i18n.language)}
                    {inv.status === 'pending' && !inv.email_sent && (
                      <span className="text-rose-600"> · {t('dashboard.users.invitations.list.email_not_sent')}</span>
                    )}
                  </p>
                  {/* Phones: role and access under the address. */}
                  <div className="md:hidden mt-1.5 flex flex-wrap items-center gap-1.5">
                    <RoleChip name={roleName} />
                    <InvitationStatusChip status={inv.status} />
                  </div>
                </div>
                <div className="hidden md:block min-w-0">
                  <RoleChip name={roleName} />
                </div>
                <div className="hidden md:flex flex-wrap items-center gap-1.5 min-w-0">
                  {inv.usergroups.length > 0 && (
                    <Chip tone="sky" icon={<UsersThree size={11} />} title={inv.usergroups.map((g) => g.name).join(', ')}>
                      {inv.usergroups.length === 1 ? inv.usergroups[0].name : t('dashboard.users.invitations.list.groups', { count: inv.usergroups.length })}
                    </Chip>
                  )}
                  {inv.courses.length > 0 && (
                    <Chip tone="teal" icon={<BookOpen size={11} />} title={inv.courses.map((c) => c.name).join(', ')}>
                      {t('dashboard.users.invitations.list.courses', { count: inv.courses.length })}
                    </Chip>
                  )}
                  {!inv.usergroups.length && !inv.courses.length && <span className="text-xs text-neutral-400">—</span>}
                </div>
                <div className="hidden md:block min-w-0">
                  <InvitationStatusChip status={inv.status} />
                  {inv.status === 'pending' && left !== null && (
                    <p className={`mt-1 text-[11px] ${left <= 2 ? 'text-amber-700' : 'text-neutral-400'}`}>
                      {t('dashboard.users.invitations.list.expires_in', { count: Math.max(left, 0) })}
                    </p>
                  )}
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      disabled={busy === inv.invitation_uuid}
                      aria-label={t('dashboard.users.invitations.list.actions', { email: inv.email })}
                      className="h-8 w-8 inline-flex items-center justify-center rounded-lg text-neutral-500 hover:text-neutral-900 hover:bg-neutral-100 data-[state=open]:bg-neutral-100 transition-colors disabled:opacity-40"
                    >
                      <DotsThree size={18} weight="bold" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-52 rounded-xl p-1.5">
                    {canAct && (
                      <DropdownMenuItem onSelect={() => run(inv, 'resend')} className={ITEM}>
                        <PaperPlaneTilt size={15} /> {t('dashboard.users.invitations.actions.resend')}
                      </DropdownMenuItem>
                    )}
                    {inv.status === 'pending' && (
                      <>
                        <DropdownMenuItem onSelect={() => run(inv, 'link')} className={ITEM}>
                          <LinkSimple size={15} /> {t('dashboard.users.invitations.actions.copy_link')}
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => setEditing(inv)} className={ITEM}>
                          <PencilSimple size={15} /> {t('dashboard.users.invitations.actions.edit')}
                        </DropdownMenuItem>
                      </>
                    )}
                    {canAct ? (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onSelect={() => setRevoking(inv)} className={`${ITEM} text-rose-600 focus:text-rose-700 focus:bg-rose-50`}>
                          <Prohibit size={15} /> {t('dashboard.users.invitations.actions.revoke')}
                        </DropdownMenuItem>
                      </>
                    ) : (
                      <DropdownMenuItem disabled className={ITEM}>
                        {t('dashboard.users.invitations.actions.none')}
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </li>
            )
          })}
          {legacy.map((inv) => (
            <li key={`legacy-${inv.email}`} className="grid grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-3 px-4 sm:px-5 py-3">
              <span />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-neutral-900 truncate" dir="ltr">
                  {inv.email}
                </p>
                <p className="text-xs text-neutral-500">{t('dashboard.users.invitations.list.legacy')}</p>
              </div>
              <Button variant="danger-ghost" size="sm" icon={<Prohibit size={13} />} onClick={() => setRevokingLegacy(inv)}>
                <span className="hidden sm:inline">{t('dashboard.users.invitations.actions.revoke')}</span>
              </Button>
            </li>
          ))}
        </ul>
        <ListPager page={page} pageSize={PAGE} total={data?.total ?? 0} onPage={setPage} />
      </>
    )

  return (
    <>
      {filters}
      <div className="border-t border-neutral-100">{content}</div>
      <BulkActionBar
        count={selected.size}
        label={t('dashboard.users.invitations.list.selected', { count: selected.size })}
        onClear={() => setSelected(new Set())}
      >
        <BulkActionButton icon={<ArrowClockwise size={14} />} label={t('dashboard.users.invitations.actions.resend')} onClick={() => runBulk('resend')} />
        <BulkActionButton icon={<Prohibit size={14} />} label={t('dashboard.users.invitations.actions.revoke')} danger onClick={() => setBulkRevoke(true)} />
      </BulkActionBar>
      <EditInvitationDialog invitation={editing} onOpenChange={(o) => !o && setEditing(null)} />
      <ConfirmDialog
        open={!!revoking}
        onOpenChange={(o) => !o && setRevoking(null)}
        title={t('dashboard.users.invitations.revoke.title')}
        message={t('dashboard.users.invitations.revoke.message', { email: revoking?.email })}
        confirmLabel={t('dashboard.users.invitations.actions.revoke')}
        onConfirm={() => revoking && run(revoking, 'revoke')}
      />
      <ConfirmDialog
        open={!!revokingLegacy}
        onOpenChange={(o) => !o && setRevokingLegacy(null)}
        title={t('dashboard.users.invitations.revoke.title')}
        message={t('dashboard.users.invitations.revoke.message', { email: revokingLegacy?.email })}
        confirmLabel={t('dashboard.users.invitations.actions.revoke')}
        onConfirm={() => revokingLegacy && removeLegacy(revokingLegacy)}
      />
      <ConfirmDialog
        open={bulkRevoke}
        onOpenChange={setBulkRevoke}
        title={t('dashboard.users.invitations.revoke.bulk_title', { count: selected.size })}
        message={t('dashboard.users.invitations.revoke.bulk_message')}
        confirmLabel={t('dashboard.users.invitations.actions.revoke')}
        onConfirm={() => runBulk('revoke')}
      />
    </>
  )
}
