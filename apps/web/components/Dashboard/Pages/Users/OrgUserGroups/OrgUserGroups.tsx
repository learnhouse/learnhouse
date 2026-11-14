'use client'
import React, { useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { useTranslation } from 'react-i18next'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import {
  ArrowElbowDownRight,
  DotsThree,
  FileArrowUp,
  Lightning,
  Plus,
  ShieldCheck,
  Trash,
  Tray,
  UserList,
  UsersThree,
} from '@phosphor-icons/react'
import FeatureGate from '@components/Dashboard/Shared/FeatureGate/FeatureGate'
import {
  AvatarStack,
  Button,
  ConfirmDialog,
  EmptyState,
  SearchInput,
  SegmentedControl,
  StatCard,
} from '@components/Dashboard/Shared/DashKit/DashKit'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@components/ui/dropdown-menu'
import { searchMatchesAny } from '@/lib/search/normalize'
import { deleteUserGroup } from '@services/usergroups/usergroups'
import { RowSkeleton } from '../usersUi'
import CreateGroupDialog from './CreateGroupDialog'
import GroupDetailView from './GroupDetail'
import ImportMembersDialog from './ImportMembersDialog'
import { personName, useGroupsOverview, useInvalidateGroups, useUG, type GroupListItem } from './groupsApi'
import { avatarSrc, GroupTile, TypeChips } from './ugUi'

type TypeFilter = 'all' | 'manual' | 'smart' | 'nested'

// Desktop table: group, members, unlocks, managers, actions (subgrid rows).
const TABLE = 'lg:grid lg:grid-cols-[minmax(0,2.6fr)_minmax(0,0.9fr)_minmax(0,0.9fr)_minmax(0,1fr)_auto] lg:gap-x-4'
const ROW = 'lg:col-span-full lg:grid lg:grid-cols-subgrid lg:items-center lg:gap-x-4'

/** Parents first, each followed by its sub-groups (depth for indentation). */
function asTree(groups: GroupListItem[]): { group: GroupListItem; depth: number }[] {
  const ids = new Set(groups.map((g) => g.id))
  const kids = new Map<number, GroupListItem[]>()
  groups.forEach((g) => {
    if (g.parent_id && ids.has(g.parent_id)) kids.set(g.parent_id, [...(kids.get(g.parent_id) ?? []), g])
  })
  const out: { group: GroupListItem; depth: number }[] = []
  const seen = new Set<number>()
  const walk = (g: GroupListItem, depth: number) => {
    if (seen.has(g.id)) return
    seen.add(g.id)
    out.push({ group: g, depth })
    ;(kids.get(g.id) ?? []).forEach((c) => walk(c, depth + 1))
  }
  groups.filter((g) => !g.parent_id || !ids.has(g.parent_id)).forEach((g) => walk(g, 0))
  groups.forEach((g) => walk(g, 0))
  return out
}

export function useOpenGroup() {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const id = Number(params?.get('group')) || null
  const open = (gid: number | null, section?: string, extra?: Record<string, string>) => {
    const next = new URLSearchParams(params?.toString() ?? '')
    next.delete('section')
    next.delete('announce')
    if (gid) next.set('group', String(gid))
    else next.delete('group')
    if (section) next.set('section', section)
    Object.entries(extra ?? {}).forEach(([k, v]) => next.set(k, v))
    const qs = next.toString()
    router.push(`${pathname}${qs ? `?${qs}` : ''}`, { scroll: false })
  }
  return [id, open] as const
}

function OrgUserGroups() {
  const [openId, open] = useOpenGroup()
  if (openId) {
    return (
      <FeatureGate feature="usergroups">
        <GroupDetailView id={openId} onBack={() => open(null)} />
      </FeatureGate>
    )
  }
  return (
    <FeatureGate feature="usergroups">
      <GroupList onOpen={(id) => open(id)} />
    </FeatureGate>
  )
}

function GroupList({ onOpen }: { onOpen: (_id: number) => void }) {
  const { t } = useTranslation()
  const { orgId, token } = useUG()
  const invalidate = useInvalidateGroups()
  const { data, isLoading } = useGroupsOverview()
  const [search, setSearch] = useState('')
  const [type, setType] = useState<TypeFilter>('all')
  const [createOpen, setCreateOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [deleting, setDeleting] = useState<GroupListItem | null>(null)

  const groups = useMemo(() => data?.items ?? [], [data])
  const stats = useMemo(
    () => ({
      total: groups.length,
      smart: groups.filter((g) => g.types.includes('smart')).length,
      nested: groups.filter((g) => g.types.includes('nested')).length,
      managers: new Set(groups.flatMap((g) => g.managers.map((m) => m.id))).size,
    }),
    [groups]
  )
  const filtered = useMemo(() => {
    let list = groups
    if (type !== 'all') list = list.filter((g) => g.types.includes(type))
    if (search.trim()) list = list.filter((g) => searchMatchesAny([g.name, g.description], search))
    return list
  }, [groups, search, type])
  const rows = useMemo(() => (type === 'all' && !search.trim() ? asTree(filtered) : filtered.map((g) => ({ group: g, depth: 0 }))), [filtered, type, search])

  const remove = async (g: GroupListItem) => {
    const res = await deleteUserGroup(g.id, orgId, token as string)
    if (res.status == 200) toast.success(t('dashboard.users.usergroups.toasts.delete_success'))
    else toast.error(t('dashboard.users.usergroups.toasts.delete_error'))
    invalidate()
  }

  const loading = isLoading && !data
  const canAdmin = data?.can_admin !== false

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          icon={<UsersThree size={16} />}
          iconClass="bg-sky-50 text-sky-600"
          label={t('groups.list.stats.groups')}
          value={loading ? null : stats.total}
          active={type === 'all'}
          onClick={() => setType('all')}
        />
        <StatCard
          icon={<Lightning size={16} weight="fill" />}
          iconClass="bg-violet-50 text-violet-600"
          label={t('groups.list.stats.smart')}
          value={loading ? null : stats.smart}
          active={type === 'smart'}
          onClick={() => setType(type === 'smart' ? 'all' : 'smart')}
        />
        <StatCard
          icon={<ArrowElbowDownRight size={16} className="rtl:-scale-x-100" />}
          iconClass="bg-amber-50 text-amber-600"
          label={t('groups.list.stats.nested')}
          value={loading ? null : stats.nested}
          active={type === 'nested'}
          onClick={() => setType(type === 'nested' ? 'all' : 'nested')}
        />
        <StatCard
          icon={<ShieldCheck size={16} />}
          iconClass="bg-emerald-50 text-emerald-600"
          label={t('groups.list.stats.managers')}
          value={loading ? null : stats.managers}
        />
      </div>

      <div className="flex flex-col lg:flex-row gap-3 lg:items-center">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder={t('dashboard.users.usergroups.search_placeholder')}
          className="lg:max-w-xs"
        />
        <div className="overflow-x-auto -mx-1 px-1">
          <SegmentedControl<TypeFilter>
            value={type}
            onChange={setType}
            ariaLabel={t('groups.list.type_filter')}
            options={[
              { key: 'all', label: t('groups.list.all') },
              { key: 'manual', label: t('groups.types.manual') },
              { key: 'smart', label: t('groups.types.smart') },
              { key: 'nested', label: t('groups.types.nested') },
            ]}
          />
        </div>
        {canAdmin && (
          <div className="flex items-center gap-2 lg:ms-auto">
            <Button icon={<FileArrowUp size={14} className="text-sky-600" />} onClick={() => setImportOpen(true)}>
              {t('groups.import.button')}
            </Button>
            <Button variant="primary" icon={<Plus size={14} />} onClick={() => setCreateOpen(true)} data-testid="new-group">
              {t('groups.list.new')}
            </Button>
          </div>
        )}
      </div>

      <div className="bg-white rounded-2xl nice-shadow overflow-hidden">
        {loading ? (
          <RowSkeleton rows={4} />
        ) : rows.length === 0 ? (
          search || type !== 'all' ? (
            <EmptyState
              icon={<Tray size={22} />}
              title={t('dashboard.users.usergroups.no_results')}
              action={
                <Button
                  size="sm"
                  onClick={() => {
                    setSearch('')
                    setType('all')
                  }}
                >
                  {t('dashboard.users.active_users.filters.clear_filters')}
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={<UsersThree size={22} />}
              title={t('dashboard.users.usergroups.no_groups')}
              description={t('groups.list.empty')}
              action={
                canAdmin ? (
                  <Button variant="primary" icon={<Plus size={14} />} onClick={() => setCreateOpen(true)}>
                    {t('groups.list.new')}
                  </Button>
                ) : undefined
              }
            />
          )
        ) : (
          <div className={TABLE}>
            <div className={`hidden ${ROW} px-5 py-3 border-b border-neutral-100 text-xs font-medium text-neutral-500`}>
              <span>{t('dashboard.users.dash.groups.col_group')}</span>
              <span>{t('dashboard.users.dash.groups.col_members')}</span>
              <span>{t('groups.list.col_unlocks')}</span>
              <span>{t('groups.list.col_managers')}</span>
              <span className="sr-only">{t('dashboard.users.active_users.table.actions')}</span>
            </div>
            <ul className={`divide-y divide-neutral-100 ${ROW}`}>
              {rows.map(({ group, depth }) => (
                <GroupRow
                  key={group.id}
                  group={group}
                  depth={depth}
                  canAdmin={canAdmin}
                  onOpen={() => onOpen(group.id)}
                  onDelete={() => setDeleting(group)}
                />
              ))}
            </ul>
          </div>
        )}
      </div>

      <CreateGroupDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        features={data?.features}
        groups={groups}
        onCreated={(id) => onOpen(id)}
      />
      <ImportMembersDialog open={importOpen} onOpenChange={setImportOpen} />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={t('dashboard.users.usergroups.modals.delete.title')}
        message={t('groups.list.delete_message', { name: deleting?.name ?? '' })}
        confirmLabel={t('dashboard.users.usergroups.modals.delete.button')}
        onConfirm={() => {
          const g = deleting
          setDeleting(null)
          if (g) remove(g)
        }}
      />
    </div>
  )
}

function GroupRow({
  group,
  depth,
  canAdmin,
  onOpen,
  onDelete,
}: {
  group: GroupListItem
  depth: number
  canAdmin: boolean
  onOpen: () => void
  onDelete: () => void
}) {
  const { t } = useTranslation()
  const unlocks = Object.values(group.resource_counts || {}).reduce((a, b) => a + b, 0)
  const courses = group.resource_counts?.course ?? 0
  return (
    <li className={`group flex items-center gap-3 px-4 sm:px-5 py-3 hover:bg-neutral-50/70 transition-colors ${ROW}`}>
      <button
        type="button"
        onClick={onOpen}
        className="flex items-center gap-3 min-w-0 flex-1 text-start"
        style={{ paddingInlineStart: depth ? Math.min(depth, 3) * 22 : 0 }}
        data-testid={`group-row-${group.id}`}
      >
        {depth > 0 && <ArrowElbowDownRight size={14} className="text-neutral-300 shrink-0 -me-1 rtl:-scale-x-100" />}
        <GroupTile color={group.color} kind={group.kind} />
        <span className="min-w-0">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0">
            <span className="text-sm font-semibold text-neutral-900 line-clamp-2 break-words lg:truncate group-hover:underline underline-offset-2" dir="auto">
              {group.name}
            </span>
            <TypeChips types={group.types} />
          </span>
          <span className="block text-xs text-neutral-500 truncate mt-0.5" dir="auto">
            {group.description || (group.parent_name ? t('groups.list.inside', { name: group.parent_name }) : t('dashboard.users.dash.groups.no_description'))}
          </span>
        </span>
      </button>

      <div className="hidden lg:block text-sm">
        <span className="font-semibold text-neutral-900 tabular-nums">{group.member_count}</span>
        {group.inherited_count > 0 && (
          <span className="block text-xs text-neutral-500">{t('groups.list.via_subgroups', { count: group.inherited_count })}</span>
        )}
      </div>
      <div className="hidden lg:block text-sm text-neutral-700">
        {unlocks ? (
          <>
            <span className="font-semibold tabular-nums">{unlocks}</span>
            {courses > 0 && <span className="block text-xs text-neutral-500">{t('groups.list.courses_count', { count: courses })}</span>}
          </>
        ) : (
          <span className="text-neutral-400">—</span>
        )}
      </div>
      <div className="hidden lg:block min-w-0">
        {group.managers.length ? (
          <AvatarStack people={group.managers.map((m) => ({ key: String(m.id), src: avatarSrc(m), label: personName(m) }))} />
        ) : (
          <span className="text-sm text-neutral-400">—</span>
        )}
      </div>

      <div className="flex items-center justify-end gap-1 shrink-0">
        <span className="lg:hidden text-xs text-neutral-500 tabular-nums me-1">
          {t('dashboard.users.dash.groups.members_count', { count: group.member_count })}
        </span>
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={t('dashboard.users.active_users.table.actions')}
              className="h-8 w-8 inline-flex items-center justify-center rounded-lg text-neutral-500 hover:text-neutral-900 hover:bg-neutral-100 data-[state=open]:bg-neutral-100 transition-colors"
            >
              <DotsThree size={16} weight="bold" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48 rounded-xl p-1.5">
            <DropdownMenuItem onSelect={onOpen} className="flex items-center gap-2 cursor-pointer">
              <UserList size={15} /> {t('groups.list.open')}
            </DropdownMenuItem>
            {canAdmin && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={onDelete} className="flex items-center gap-2 cursor-pointer text-rose-600 focus:text-rose-700 focus:bg-rose-50">
                  <Trash size={15} /> {t('dashboard.users.usergroups.actions.delete')}
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </li>
  )
}

export default OrgUserGroups
