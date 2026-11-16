'use client'
import React, { useCallback, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { useTranslation } from 'react-i18next'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle, Minus, Plus, Users } from '@phosphor-icons/react'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrg } from '@components/Contexts/OrgContext'
import { Button, Chip, EmptyState, SearchInput, SegmentedControl } from '@components/Dashboard/Shared/DashKit/DashKit'
import { getAPIUrl } from '@services/config/config'
import { linkUsersToUserGroup, unlinkUsersFromUserGroup } from '@services/usergroups/usergroups'
import { apiFetch, asArray } from '@services/utils/ts/requests'
import { CheckBox, ListPager, PersonCell, RowSkeleton, useDebounced } from '@components/Dashboard/Pages/Users/usersUi'

const ITEMS_PER_PAGE = 20

type ManageUsersProps = {
  usergroup_id: any
}

type FilterTab = 'in_group' | 'not_in_group' | 'all'

// Member management for one user group. Opens on the people already in the
// group; "Add people" lists everyone else. Each row adds or removes in one
// click, and a selection does the same in bulk.
function ManageUsers({ usergroup_id }: ManageUsersProps) {
  const { t } = useTranslation()
  const org = useOrg() as any
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token
  const queryClient = useQueryClient()

  const [searchValue, setSearchValue] = useState('')
  const search = useDebounced(searchValue.trim(), 300)
  const [tab, setTab] = useState<FilterTab>('in_group')
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [page, setPage] = useState(1)
  const [busy, setBusy] = useState<Set<number>>(new Set())

  // A new search or tab starts on page one with nothing selected
  // (adjusted during render rather than in an effect).
  const filterKey = `${search}|${tab}`
  const [lastFilterKey, setLastFilterKey] = useState(filterKey)
  if (lastFilterKey !== filterKey) {
    setLastFilterKey(filterKey)
    setPage(1)
    setSelected(new Set())
  }

  const query = useMemo(() => {
    const p = new URLSearchParams({ page: String(page), limit: String(ITEMS_PER_PAGE) })
    if (search) p.append('search', search)
    // Always pass usergroup_id so the response carries the tab counts.
    p.append('usergroup_id', String(usergroup_id))
    if (tab !== 'all') p.append('usergroup_filter', tab)
    return p.toString()
  }, [page, search, tab, usergroup_id])

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['org', org?.id, 'users', page, search, tab, usergroup_id],
    queryFn: () => apiFetch(`${getAPIUrl()}orgs/${org?.id}/users?${query}`, access_token),
    enabled: !!org?.id && !!access_token,
    placeholderData: (prev) => prev,
    staleTime: 60_000,
  })

  const rows: any[] = asArray(data?.items)
  const total: number = data?.total || 0
  const inGroupTotal: number | undefined = data?.in_group_total
  const allTotal: number | undefined = data?.all_total

  const isInGroup = useCallback(
    (row: any) => asArray(row.usergroups).some((ug: any) => ug.id === usergroup_id),
    [usergroup_id]
  )

  // Members changed: refresh every list of users plus this group's count.
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['org', org?.id, 'users'] })
    queryClient.invalidateQueries({ queryKey: ['usergroup', usergroup_id] })
  }

  const mutate = async (ids: number[], add: boolean) => {
    if (!ids.length) return
    setBusy((prev) => new Set([...prev, ...ids]))
    try {
      const res = add
        ? await linkUsersToUserGroup(usergroup_id, ids, org.id, access_token)
        : await unlinkUsersFromUserGroup(usergroup_id, ids, org.id, access_token)
      if (res.status === 200) {
        toast.success(
          add
            ? t('dashboard.users.usergroups.modals.manage_users.toasts.bulk_add_success', { count: ids.length })
            : t('dashboard.users.usergroups.modals.manage_users.toasts.bulk_remove_success', { count: ids.length })
        )
        setSelected(new Set())
      } else {
        toast.error(
          t('dashboard.users.usergroups.modals.manage_users.toasts.error', { status: res.status, detail: res.data?.detail })
        )
      }
    } catch {
      toast.error(t('dashboard.users.usergroups.modals.manage_users.toasts.bulk_error'))
    } finally {
      setBusy((prev) => {
        const next = new Set(prev)
        ids.forEach((id) => next.delete(id))
        return next
      })
      refresh()
    }
  }

  const visibleIds = rows.map((r) => r.user.id as number)
  const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id))
  const selectedRows = rows.filter((r) => selected.has(r.user.id))
  const toAdd = selectedRows.filter((r) => !isInGroup(r)).map((r) => r.user.id)
  const toRemove = selectedRows.filter((r) => isInGroup(r)).map((r) => r.user.id)

  const toggle = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
        <SegmentedControl<FilterTab>
          value={tab}
          onChange={setTab}
          ariaLabel={t('dashboard.users.dash.groups.members_filter')}
          options={[
            { key: 'in_group', label: t('dashboard.users.dash.groups.in_group'), count: inGroupTotal },
            {
              key: 'not_in_group',
              label: t('dashboard.users.dash.groups.add_people'),
              count: allTotal != null && inGroupTotal != null ? allTotal - inGroupTotal : undefined,
            },
            { key: 'all', label: t('dashboard.users.usergroups.modals.manage_users.tabs.all'), count: allTotal },
          ]}
        />
        <SearchInput
          value={searchValue}
          onChange={setSearchValue}
          placeholder={t('dashboard.users.usergroups.modals.manage_users.search_placeholder')}
        />
      </div>

      <div className="rounded-xl ring-1 ring-inset ring-neutral-200 overflow-hidden">
        {rows.length > 0 && (
          <div className="flex items-center gap-3 px-4 py-2 border-b border-neutral-100 bg-neutral-50/70 min-h-11">
            <CheckBox
              checked={allSelected}
              indeterminate={!allSelected && selectedRows.length > 0}
              onChange={() => setSelected(allSelected ? new Set() : new Set(visibleIds))}
              label={t('dashboard.users.usergroups.modals.manage_users.selection.select_all_visible')}
            />
            <span className="text-xs text-neutral-500 flex-1">
              {selectedRows.length > 0
                ? t('dashboard.users.usergroups.modals.manage_users.selection.count', { count: selectedRows.length })
                : t('dashboard.users.usergroups.modals.manage_users.selection.select_all_visible')}
            </span>
            {toAdd.length > 0 && (
              <Button size="sm" variant="primary" icon={<Plus size={12} />} onClick={() => mutate(toAdd, true)}>
                {t('dashboard.users.usergroups.modals.manage_users.selection.add_selected', { count: toAdd.length })}
              </Button>
            )}
            {toRemove.length > 0 && (
              <Button size="sm" icon={<Minus size={12} />} onClick={() => mutate(toRemove, false)}>
                {t('dashboard.users.usergroups.modals.manage_users.selection.remove_selected', { count: toRemove.length })}
              </Button>
            )}
          </div>
        )}

        {isLoading && !data ? (
          <RowSkeleton rows={5} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<Users size={22} />}
            title={
              search
                ? t('dashboard.users.usergroups.modals.manage_users.no_results')
                : tab === 'in_group'
                  ? t('dashboard.users.dash.groups.no_members')
                  : t('dashboard.users.usergroups.modals.manage_users.no_users')
            }
            description={!search && tab === 'in_group' ? t('dashboard.users.dash.groups.no_members_description') : undefined}
            action={
              !search && tab === 'in_group' ? (
                <Button variant="primary" size="sm" icon={<Plus size={12} />} onClick={() => setTab('not_in_group')}>
                  {t('dashboard.users.dash.groups.add_people')}
                </Button>
              ) : undefined
            }
          />
        ) : (
          <ul className={`divide-y divide-neutral-100 max-h-[420px] overflow-y-auto transition-opacity ${isFetching ? 'opacity-70' : ''}`}>
            {rows.map((row) => {
              const id = row.user.id as number
              const member = isInGroup(row)
              return (
                <li
                  key={id}
                  className={`flex items-center gap-3 px-4 py-2.5 transition-colors ${selected.has(id) ? 'bg-neutral-50' : 'hover:bg-neutral-50/70'}`}
                >
                  <CheckBox checked={selected.has(id)} onChange={() => toggle(id)} label={row.user.username} />
                  <div className="min-w-0 flex-1">
                    <PersonCell user={row.user} size={32} popup={false} />
                  </div>
                  {member && tab === 'all' && (
                    <span className="hidden sm:inline-flex">
                      <Chip tone="emerald" icon={<CheckCircle size={12} weight="fill" />}>
                        {t('dashboard.users.usergroups.modals.manage_users.status.in_group')}
                      </Chip>
                    </span>
                  )}
                  {member ? (
                    <Button size="sm" variant="ghost" loading={busy.has(id)} icon={<Minus size={12} />} onClick={() => mutate([id], false)}>
                      {t('dashboard.users.dash.groups.remove')}
                    </Button>
                  ) : (
                    <Button size="sm" loading={busy.has(id)} icon={<Plus size={12} />} onClick={() => mutate([id], true)}>
                      {t('dashboard.users.dash.groups.add')}
                    </Button>
                  )}
                </li>
              )
            })}
          </ul>
        )}
        <ListPager page={page} pageSize={ITEMS_PER_PAGE} total={total} onPage={setPage} />
      </div>
    </div>
  )
}

export default ManageUsers
