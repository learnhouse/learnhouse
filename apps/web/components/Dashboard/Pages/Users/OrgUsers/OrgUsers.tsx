'use client'
import React, { useCallback, useMemo, useState } from 'react'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import { useParams } from 'next/navigation'
import toast from 'react-hot-toast'
import { useTranslation } from 'react-i18next'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowDown,
  ArrowSquareOut,
  ArrowUp,
  Buildings,
  ChartBar,
  SlidersHorizontal,
  ClockCountdown,
  Copy,
  DotsThree,
  DownloadSimple,
  EnvelopeSimple,
  FileCsv,
  Funnel,
  GitDiff,
  GoogleLogo,
  Lightning,
  SealCheck,
  SealWarning,
  SidebarSimple,
  SignOut,
  Tray,
  UserPlus,
  Users,
  UsersThree,
  X,
} from '@phosphor-icons/react'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrg } from '@components/Contexts/OrgContext'
import useAdminStatus from '@components/Hooks/useAdminStatus'
import ToolTip from '@components/Objects/StyledElements/Tooltip/Tooltip'
import Modal from '@components/Objects/StyledElements/Modal/Modal'
import {
  BulkActionBar,
  BulkActionButton,
  Button,
  Chip,
  ConfirmDialog,
  EmptyState,
  SearchInput,
  SegmentedControl,
  StatCard,
  formatRelative,
} from '@components/Dashboard/Shared/DashKit/DashKit'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@components/ui/dropdown-menu'
import UsersComparisonTable from '@ee/components/Analytics/Users/UsersComparisonTable'
import UserAuditExport from '@ee/components/Analytics/Users/UserAuditExport'
import { isOrgAnalyticsAvailable } from '@ee/components/Analytics/availability'
import { BulkPeopleActions, PeopleImportDialog, usePeopleData } from '@ee/components/HR/People/UsersPeopleTools'
import BulkGroupActions from '@components/Dashboard/Pages/Users/OrgUserGroups/BulkGroupActions'
import { Popover, PopoverContent, PopoverTrigger } from '@components/ui/popover'
import { getAPIUrl, getUriWithOrg, getUpgradeUrl } from '@services/config/config'
import { removeUserFromOrg, removeUsersFromOrg, updateUserRole } from '@services/organizations/orgs'
import { apiFetch, asArray } from '@services/utils/ts/requests'
import { readSignupFields } from '@services/settings/org'
import { queryKeys } from '@/lib/query/keys'
import { InvitationsList, InviteMembersModal, useInvitedUsers } from '../OrgUsersAdd/invites'
import { CheckBox, ListPager, PersonCell, RolePicker, RowSkeleton, displayName, useDebounced } from '../usersUi'
import { openUserPanel, prefetchMemberSummary, type PanelTab } from '../UserPanel/panelState'

// The member panel loads after the table, in its own chunk.
const UserPanel = dynamic(() => import('../UserPanel/UserPanel'), { ssr: false })

const ITEMS_PER_PAGE = 10

type View = 'members' | 'invited'

/** Render a custom signup field answer for the members table. */
function formatCustomFieldValue(value: any): string {
  if (value === undefined || value === null) return ''
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  return String(value)
}

type MemberProfile = {
  department?: string | null
  title?: string | null
  employee_id?: string | null
  location?: string | null
  cost_center?: string | null
  attributes?: Record<string, string> | null
  manager?: any | null
}

type Member = {
  user: any
  role: any
  usergroups?: any[]
  joined_at?: string
  visit_days?: number
  is_active?: boolean
  // People data (EE): manager, department, title.
  profile?: MemberProfile | null
}

// Optional people-data columns, toggled from the toolbar and remembered per
// browser. Signup fields saved to people data add their own: a profile column
// (employee_id, location, cost_center) or `attr:<key>` for a custom attribute.
const PEOPLE_COLUMNS = ['title', 'department', 'manager'] as const
const MAPPABLE_COLUMNS = ['employee_id', 'location', 'cost_center'] as const
type PeopleColumn = string
const COLUMNS_KEY = 'lh:users:people-columns'
// The caret ToolbarSelect draws, for the filter popover's full-width selects.
const SELECT_CARET =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 256 256'%3E%3Cpath fill='%23a3a3a3' d='M213.66 101.66l-80 80a8 8 0 0 1-11.32 0l-80-80a8 8 0 0 1 11.32-11.32L128 164.69l74.34-74.35a8 8 0 0 1 11.32 11.32Z'/%3E%3C/svg%3E\")"
// Room for the extra columns: the table scrolls sideways instead of squeezing.
const tableMinWidth = (extraColumns: number) => `${1100 + 150 * Math.max(0, extraColumns - 1)}px`

function useStoredColumns(): [PeopleColumn[] | null, (_cols: PeopleColumn[]) => void] {
  const [cols, setCols] = useState<PeopleColumn[] | null>(() => {
    try {
      const raw = typeof window !== 'undefined' ? window.localStorage.getItem(COLUMNS_KEY) : null
      return raw === null ? null : raw.split(',').filter(Boolean)
    } catch {
      return null
    }
  })
  const update = useCallback((next: PeopleColumn[]) => {
    setCols(next)
    try {
      window.localStorage.setItem(COLUMNS_KEY, next.join(','))
    } catch {
      // ignore
    }
  }, [])
  return [cols, update]
}

function OrgUsers() {
  const { t, i18n } = useTranslation()
  const org = useOrg() as any
  const orgId: number | undefined = org?.id
  // The org's custom signup fields become extra members-table columns; those
  // saved to people data show as (optional) people columns instead, once.
  const signupFields = useMemo(() => readSignupFields(org), [org])
  const customFields = useMemo(() => signupFields.filter((f) => !f.people_field), [signupFields])
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token
  const currentUserId = session?.data?.user?.id
  const queryClient = useQueryClient()
  // Member mutations (remove, role change) require admin/maintainer server-side
  // (rbac "delete"/"update"). Editors can reach this page (dashboard access) but
  // would 403 on those actions, so only expose the controls to org managers.
  const { canManageOrg } = useAdminStatus()
  const params = useParams() as any
  // Null in OSS/EE, where there is no billing surface to send anyone to.
  const billingUrl = getUpgradeUrl(params.orgslug)

  // ---- filters ----
  const [view, setView] = useState<View>('members')
  const [page, setPage] = useState(1)
  const [searchValue, setSearchValue] = useState('')
  const search = useDebounced(searchValue.trim())
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc')
  const [filterRole, setFilterRole] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [filterGroupId, setFilterGroupId] = useState('')
  // People data filters (EE): department, manager ('none' = no manager, 'me' = my reports).
  const people = usePeopleData()
  const [filterDepartment, setFilterDepartment] = useState('')
  const [filterManager, setFilterManager] = useState('')
  // Dropdown signup answers saved as custom attributes: {field key: option}.
  const [attrFilters, setAttrFilters] = useState<Record<string, string>>({})
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [storedColumns, setStoredColumns] = useStoredColumns()
  const [selectedUserIds, setSelectedUserIds] = useState<Set<number>>(new Set())

  // Any filter change starts over on page one with nothing selected, so a
  // bulk action never touches rows the user can no longer see.
  const resetPaging = () => {
    setPage(1)
    setSelectedUserIds(new Set())
  }
  const [lastSearch, setLastSearch] = useState(search)
  if (lastSearch !== search) {
    setLastSearch(search)
    resetPaging()
  }

  // ---- dialogs ----
  const [inviteOpen, setInviteOpen] = useState(false)
  const [comparing, setComparing] = useState(false)
  // Per-student analytics ship with Enterprise Edition.
  const showAnalytics = isOrgAnalyticsAvailable()
  const [removing, setRemoving] = useState<Member | null>(null)
  const [bulkRemove, setBulkRemove] = useState(false)
  const [roleChange, setRoleChange] = useState<{ member: Member; role: any } | null>(null)

  const filterParams = (extra?: Record<string, string>) => {
    const p = new URLSearchParams()
    p.append('sort_order', sortOrder)
    if (search) p.append('search', search)
    if (filterRole) p.append('role_id', filterRole)
    if (filterStatus) p.append('status', filterStatus)
    if (filterGroupId) {
      p.append('usergroup_id', filterGroupId)
      p.append('usergroup_filter', 'in_group')
    }
    if (filterDepartment) p.append('department', filterDepartment)
    if (filterManager === 'none') p.append('no_manager', 'true')
    else if (filterManager === 'me') p.append('my_reports', 'true')
    else if (filterManager) p.append('manager_id', filterManager)
    Object.entries(attrFilters).forEach(([k, v]) => v && p.append('attribute', `${k}=${v}`))
    Object.entries(extra || {}).forEach(([k, v]) => p.append(k, v))
    return p
  }

  const usersQueryKey = useMemo(
    () => [
      ...queryKeys.org.users(orgId ?? 0), page, sortOrder, search, filterRole, filterStatus, filterGroupId,
      filterDepartment, filterManager, attrFilters,
    ],
    [orgId, page, sortOrder, search, filterRole, filterStatus, filterGroupId, filterDepartment, filterManager, attrFilters]
  )

  const { data, isFetching } = useQuery({
    queryKey: usersQueryKey,
    queryFn: () =>
      apiFetch(
        `${getAPIUrl()}orgs/${orgId}/users?${filterParams({ page: String(page), limit: String(ITEMS_PER_PAGE) })}`,
        access_token
      ),
    enabled: !!orgId && !!access_token,
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  })

  // Unfiltered counts for the stat cards: one-row pages, so they only cost
  // the count query. Kept under the users key so every mutation refreshes them.
  const countQuery = (status?: string) => ({
    queryKey: [...queryKeys.org.users(orgId ?? 0), 'count', status ?? 'all'],
    queryFn: () =>
      apiFetch(`${getAPIUrl()}orgs/${orgId}/users?page=1&limit=1${status ? `&status=${status}` : ''}`, access_token),
    enabled: !!orgId && !!access_token,
    staleTime: 60_000,
  })
  const { data: allCount } = useQuery(countQuery())
  const { data: unverifiedCount } = useQuery(countQuery('unverified'))

  const { data: roles } = useQuery({
    queryKey: queryKeys.org.roles(orgId!),
    queryFn: () => apiFetch(`${getAPIUrl()}roles/org/${orgId}`, access_token),
    select: (res: any) => asArray<any>(res),
    enabled: !!orgId && !!access_token,
    staleTime: 60_000,
  })

  const { data: usergroups } = useQuery({
    queryKey: queryKeys.usergroups.list(orgId!),
    queryFn: () => apiFetch(`${getAPIUrl()}usergroups/org/${orgId}?org_id=${orgId}`, access_token),
    // Shares its cache key with getUserGroups(), which stores the
    // {success, data} envelope rather than the bare list.
    select: (res: any) => asArray<any>(res),
    enabled: !!orgId && !!access_token,
    staleTime: 60_000,
  })

  const { data: invited } = useInvitedUsers()
  const pendingInvites = (invited ?? []).filter((u) => u.pending).length

  const members: Member[] = asArray<Member>(data?.items)
  const total: number = data?.total || 0
  const isInitialLoading = !data && (isFetching || !access_token)
  const isPageTransitioning = !!data && isFetching
  const summary = data?.active_users_summary

  const hasActiveFilters = !!(
    filterRole || filterStatus || filterGroupId || search || filterDepartment || filterManager ||
    Object.values(attrFilters).some(Boolean)
  )
  const resetFilters = () => {
    setFilterRole('')
    setFilterStatus('')
    setFilterGroupId('')
    setFilterDepartment('')
    setFilterManager('')
    setAttrFilters({})
    setSearchValue('')
    resetPaging()
  }

  // ---- filters popover + chips ----
  type FilterField = {
    key: string
    label: string
    value: string
    onChange: (_v: string) => void
    options: { value: string; label: string }[]
  }
  const filterFields: FilterField[] = [
    {
      key: 'role',
      label: t('dashboard.users.active_users.table.role'),
      value: filterRole,
      onChange: setFilterRole,
      options: [
        { value: '', label: t('dashboard.users.active_users.filters.all_roles') },
        ...(roles ?? []).map((role: any) => ({ value: String(role.id), label: role.name })),
      ],
    },
    {
      key: 'status',
      label: t('dashboard.users.active_users.table.status'),
      value: filterStatus,
      onChange: setFilterStatus,
      options: [
        { value: '', label: t('dashboard.users.active_users.filters.all_statuses') },
        { value: 'verified', label: t('dashboard.users.analytics.identity.verified') },
        { value: 'unverified', label: t('dashboard.users.analytics.identity.unverified') },
      ],
    },
    ...((usergroups?.length ?? 0) > 0
      ? [{
          key: 'group',
          label: t('dashboard.users.active_users.table.groups'),
          value: filterGroupId,
          onChange: setFilterGroupId,
          options: [
            { value: '', label: t('dashboard.users.active_users.filters.all_groups') },
            ...(usergroups ?? []).map((g: any) => ({ value: String(g.id), label: g.name })),
          ],
        }]
      : []),
    ...(people.enabled && people.departments.length > 0
      ? [{
          key: 'department',
          label: t('hr.people.fields.department'),
          value: filterDepartment,
          onChange: setFilterDepartment,
          options: [
            { value: '', label: t('hr.people.all_departments') },
            ...people.departments.map((d) => ({ value: d, label: d })),
          ],
        }]
      : []),
    ...(people.enabled
      ? [{
          key: 'manager',
          label: t('hr.people.fields.manager'),
          value: filterManager,
          onChange: setFilterManager,
          options: [
            { value: '', label: t('hr.compliance.all_managers') },
            { value: 'none', label: t('hr.people.filter.no_manager') },
            ...(people.isManager ? [{ value: 'me', label: t('hr.people.my_reports') }] : []),
            ...people.managers.map((m) => ({ value: String(m.id), label: m.name })),
          ],
        }]
      : []),
    ...(people.enabled
      ? signupFields
          .filter((f) => f.people_field === 'attribute' && f.type === 'select' && (f.options ?? []).length > 0)
          .map((f) => ({
            key: `attr:${f.key}`,
            label: f.label || f.key,
            value: attrFilters[f.key] ?? '',
            onChange: (v: string) => setAttrFilters((prev) => ({ ...prev, [f.key]: v })),
            options: [
              { value: '', label: t('dashboard.users.toolbar.any') },
              ...(f.options ?? []).map((o) => ({ value: o, label: o })),
            ],
          }))
      : []),
  ]
  const activeFilters = filterFields
    .filter((f) => f.value)
    .map((f) => ({
      key: f.key,
      label: f.label,
      valueLabel: f.options.find((o) => o.value === f.value)?.label ?? f.value,
      clear: () => f.onChange(''),
    }))
  const resetFilterSelects = () => {
    filterFields.forEach((f) => f.onChange(''))
    resetPaging()
  }

  // ---- selection ----
  const visibleUserIds = members.map((m) => m.user.id as number)
  const selectedOnPage = visibleUserIds.filter((id) => selectedUserIds.has(id))
  const allVisibleSelected = visibleUserIds.length > 0 && selectedOnPage.length === visibleUserIds.length
  const toggleSelectAll = () =>
    setSelectedUserIds(() => (allVisibleSelected ? new Set() : new Set(visibleUserIds)))
  const toggleSelectUser = useCallback((userId: number) => {
    setSelectedUserIds((prev) => {
      const next = new Set(prev)
      if (next.has(userId)) next.delete(userId)
      else next.add(userId)
      return next
    })
  }, [])
  const selectedCount = selectedUserIds.size

  // ---- mutations ----
  const invalidateUsers = () => queryClient.invalidateQueries({ queryKey: queryKeys.org.users(orgId!) })

  // Role change: shown on the row at once, put back if the API refuses.
  const applyRoleChange = async (member: Member, role: any) => {
    const previous = queryClient.getQueryData(usersQueryKey)
    queryClient.setQueryData(usersQueryKey, (old: any) =>
      old
        ? {
            ...old,
            items: asArray<Member>(old.items).map((m) => (m.user.id === member.user.id ? { ...m, role } : m)),
          }
        : old
    )
    const res = await updateUserRole(orgId, member.user.id, role.role_uuid, access_token)
    if (res.status === 200) {
      toast.success(t('dashboard.users.active_users.actions.role_update_success'))
    } else {
      queryClient.setQueryData(usersQueryKey, previous)
      toast.error(t('dashboard.users.active_users.actions.role_update_error'))
    }
    invalidateUsers()
  }

  const handleRemoveUser = async (member: Member) => {
    const previous = queryClient.getQueryData(usersQueryKey)
    queryClient.setQueryData(usersQueryKey, (old: any) =>
      old
        ? {
            ...old,
            total: Math.max(0, (old.total || 0) - 1),
            items: asArray<Member>(old.items).filter((m) => m.user.id !== member.user.id),
          }
        : old
    )
    const res = await removeUserFromOrg(orgId, member.user.id, access_token)
    if (res.status === 200) {
      toast.success(t('dashboard.users.active_users.actions.remove_success'))
      setSelectedUserIds((prev) => {
        const next = new Set(prev)
        next.delete(member.user.id)
        return next
      })
    } else {
      queryClient.setQueryData(usersQueryKey, previous)
      toast.error(t('dashboard.users.active_users.actions.remove_error'))
    }
    invalidateUsers()
  }

  const handleBatchRemove = async () => {
    const ids = Array.from(selectedUserIds)
    const toastId = toast.loading(t('dashboard.users.active_users.actions.batch_removing', { count: ids.length }))
    const res = await removeUsersFromOrg(orgId, ids, access_token)
    if (res.status === 200) {
      setSelectedUserIds(new Set())
      toast.success(t('dashboard.users.active_users.actions.batch_remove_success', { count: ids.length }), { id: toastId })
    } else {
      toast.error(t('dashboard.users.active_users.actions.batch_remove_error'), { id: toastId })
    }
    invalidateUsers()
  }

  const [isExporting, setIsExporting] = useState(false)
  const handleExportCSV = async () => {
    if (!org || !access_token) return
    setIsExporting(true)
    const toastId = toast.loading(t('dashboard.users.active_users.actions.exporting'))
    try {
      const res = await fetch(`${getAPIUrl()}orgs/${org.id}/users/export?${filterParams()}`, {
        headers: { Authorization: `Bearer ${access_token}` },
      })
      if (!res.ok) throw new Error('Export failed')
      const blob = await res.blob()
      const downloadUrl = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = downloadUrl
      link.download = `users-${org.slug}-${new Date().toISOString().split('T')[0]}.csv`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(downloadUrl)
      toast.success(t('dashboard.users.active_users.actions.export_success'), { id: toastId })
    } catch {
      toast.error(t('dashboard.users.active_users.actions.export_error'), { id: toastId })
    } finally {
      setIsExporting(false)
    }
  }

  const copyEmail = async (email: string) => {
    try {
      await navigator.clipboard.writeText(email)
      toast.success(t('dashboard.users.dash.members.email_copied'))
    } catch {
      toast.error(t('dashboard.users.dash.members.copy_failed'))
    }
  }

  // ---- member panel ----
  // Rows open the panel (URL state, no re-render here); hovering one warms its
  // summary so the panel opens filled.
  const openMember = useCallback((userId: number, tab?: PanelTab) => openUserPanel(userId, tab), [])
  const hoverTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const warmMember = (userId: number) => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current)
    hoverTimer.current = setTimeout(() => prefetchMemberSummary(queryClient, orgId, access_token, userId), 120)
  }
  const coolMember = () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current)
  }
  // A click anywhere on a row opens it, except on its own controls.
  const onRowClick = (e: React.MouseEvent, userId: number) => {
    if ((e.target as HTMLElement).closest('button, a, input, select, label, [role="checkbox"], [role="menu"], [data-no-row-open]')) return
    if (window.getSelection()?.toString()) return
    openMember(userId)
  }

  // People-data columns: the viewer's choice, else Department when any member
  // on the page has one. Never shown without the feature.
  const peopleColumns: { id: PeopleColumn; label: string; field?: (typeof signupFields)[number] }[] = !people.enabled
    ? []
    : [
        ...PEOPLE_COLUMNS.map((c) => ({ id: c, label: t(`hr.people.fields.${c}`) })),
        ...MAPPABLE_COLUMNS.filter((c) => signupFields.some((f) => f.people_field === c)).map((c) => ({
          id: c,
          label: t(`hr.people.fields.${c}`),
        })),
        ...signupFields
          .filter((f) => f.people_field === 'attribute')
          .map((f) => ({ id: `attr:${f.key}`, label: f.label || f.key, field: f })),
      ]
  const shownPeopleColumns: PeopleColumn[] = !people.enabled
    ? []
    : (storedColumns ?? (members.some((m) => m.profile?.department) ? ['department'] : [])).filter((c) =>
        peopleColumns.some((pc) => pc.id === c)
      )
  const showCol = (c: PeopleColumn) => shownPeopleColumns.includes(c)
  const toggleColumn = (c: PeopleColumn) =>
    setStoredColumns(peopleColumns.map((pc) => pc.id).filter((x) => (x === c ? !showCol(x) : showCol(x))))
  // The value of an extra (signup-mapped) people column for a member.
  const extraColumnText = (member: Member, col: (typeof peopleColumns)[number]) => {
    const profile = member.profile
    if (!profile) return ''
    if (col.field) {
      const raw = profile.attributes?.[col.field.key]
      if (col.field.type === 'checkbox' && raw !== undefined) return formatCustomFieldValue(raw === 'true')
      return raw ?? ''
    }
    return (profile as any)[col.id] ?? ''
  }
  const extraColumns = peopleColumns.filter((c) => !(PEOPLE_COLUMNS as readonly string[]).includes(c.id) && showCol(c.id))
  // Cells open the member panel at its "Profile & manager" block.
  const openProfile = (userId: number) => {
    openMember(userId)
    const url = new URL(window.location.href)
    url.searchParams.set('ufocus', 'profile')
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
  }
  const peopleColCount = shownPeopleColumns.length
  const wideTable = customFields.length > 0 || peopleColCount > 1

  // Columns: select, member, role, title?, department?, manager?, groups, status,
  // joined, custom fields…, actions. The template is a CSS var since the count varies.
  const gridCols = [
    'auto',
    'minmax(0,2.4fr)',
    'minmax(0,1fr)',
    ...(showCol('title') ? ['minmax(0,1fr)'] : []),
    ...(showCol('department') ? ['minmax(0,1fr)'] : []),
    ...(showCol('manager') ? ['minmax(0,1.2fr)'] : []),
    ...extraColumns.map(() => 'minmax(0,1fr)'),
    'minmax(0,1.1fr)',
    'minmax(0,1.1fr)',
    'minmax(0,0.8fr)',
    ...customFields.map(() => 'minmax(120px,1fr)'),
    'auto',
  ].join(' ')
  const tableStyle = {
    '--users-cols': gridCols,
    '--users-min-w': tableMinWidth(peopleColCount),
  } as React.CSSProperties
  const TABLE = 'lg:grid lg:[grid-template-columns:var(--users-cols)] lg:gap-x-4'
  const ROW = 'lg:col-span-full lg:grid lg:grid-cols-subgrid lg:items-center lg:gap-x-4'

  const memberCount = allCount?.total ?? null
  const activeValue = typeof summary?.active_users === 'number' ? summary.active_users : null

  return (
    <div className="flex flex-col gap-5">
      {/* Stats double as quick filters */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          icon={<Users size={16} />}
          iconClass="bg-neutral-100 text-neutral-600"
          label={t('dashboard.users.dash.members.stats.members')}
          value={memberCount}
          active={view === 'members' && !hasActiveFilters}
          onClick={() => {
            setView('members')
            resetFilters()
          }}
        />
        <StatCard
          icon={<ClockCountdown size={16} />}
          iconClass="bg-amber-50 text-amber-600"
          label={t('dashboard.users.dash.members.stats.pending_invites')}
          value={invited ? pendingInvites : null}
          active={view === 'invited'}
          onClick={() => setView(view === 'invited' ? 'members' : 'invited')}
        />
        <StatCard
          icon={<SealWarning size={16} />}
          iconClass="bg-rose-50 text-rose-600"
          label={t('dashboard.users.dash.members.stats.unverified')}
          value={unverifiedCount ? unverifiedCount.total ?? 0 : null}
          active={view === 'members' && filterStatus === 'unverified'}
          onClick={() => {
            setView('members')
            setFilterStatus(filterStatus === 'unverified' ? '' : 'unverified')
            resetPaging()
          }}
        />
        {activeValue !== null ? (
          <StatCard
            icon={<Lightning size={16} />}
            iconClass="bg-emerald-50 text-emerald-600"
            label={t('dashboard.users.dash.members.stats.active_month')}
            value={activeValue}
          />
        ) : (
          <StatCard
            icon={<UsersThree size={16} />}
            iconClass="bg-violet-50 text-violet-600"
            label={t('dashboard.users.dash.members.stats.groups')}
            value={usergroups ? usergroups.length : null}
          />
        )}
      </div>

      {/* Toolbar: search, filters, members/invited, then columns, more and invite. */}
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput
          value={searchValue}
          onChange={setSearchValue}
          placeholder={
            view === 'members'
              ? t('dashboard.users.active_users.search_placeholder')
              : t('dashboard.users.invite_members.invited_users.search_placeholder')
          }
          className="basis-full sm:basis-auto sm:flex-1 min-w-0 sm:min-w-[220px] sm:max-w-md"
        />
        <div className="flex items-center gap-2 min-w-0 w-full sm:w-auto sm:flex-1">
          {view === 'members' && (
            <Popover open={filtersOpen} onOpenChange={setFiltersOpen}>
              <PopoverTrigger asChild>
                <Button icon={<Funnel size={14} />} aria-label={t('dashboard.users.toolbar.filters')}>
                  <span className="hidden sm:inline">{t('dashboard.users.toolbar.filters')}</span>
                  {activeFilters.length > 0 && (
                    <span className="ms-0.5 inline-flex min-w-[18px] h-[18px] items-center justify-center rounded-full bg-neutral-900 px-1 text-[10px] font-bold text-white tabular-nums">
                      {activeFilters.length}
                    </span>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-72 rounded-2xl border-0 bg-white p-4 nice-shadow">
                <div className="flex flex-col gap-3">
                  {filterFields.map((f) => (
                    <label key={f.key} className="flex flex-col gap-1.5">
                      <span className="text-xs font-semibold text-neutral-600">{f.label}</span>
                      <select
                        value={f.value}
                        onChange={(e) => {
                          f.onChange(e.target.value)
                          resetPaging()
                        }}
                        aria-label={f.label}
                        className="appearance-none h-9 w-full ps-3 pe-8 truncate rounded-xl bg-white ring-1 ring-inset ring-neutral-200 text-xs font-semibold text-neutral-700 focus:outline-none focus:ring-2 focus:ring-neutral-900/10 cursor-pointer bg-[length:14px] bg-no-repeat bg-[position:right_0.75rem_center] rtl:bg-[position:left_0.75rem_center]"
                        style={{ backgroundImage: SELECT_CARET }}
                      >
                        {f.options.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}
                  {activeFilters.length > 0 && (
                    <button
                      type="button"
                      onClick={resetFilterSelects}
                      className="self-start text-xs font-semibold text-neutral-500 hover:text-neutral-900"
                    >
                      {t('dashboard.users.toolbar.clear_all')}
                    </button>
                  )}
                </div>
              </PopoverContent>
            </Popover>
          )}
          <SegmentedControl<View>
            value={view}
            onChange={(v) => {
              setView(v)
              resetPaging()
            }}
            ariaLabel={t('dashboard.users.dash.members.status_filter')}
            options={[
              { key: 'members', label: t('dashboard.users.dash.members.view_members'), count: memberCount ?? undefined },
              { key: 'invited', label: t('dashboard.users.dash.members.view_invited'), count: invited ? pendingInvites : undefined },
            ]}
          />
          <div className="ms-auto flex items-center gap-2 shrink-0">
            {view === 'members' && people.enabled && (
              <span className="hidden lg:inline-flex">
                <DropdownMenu modal={false}>
                  <ToolTip content={t('hr.people.columns.toggle')} side="top">
                    <DropdownMenuTrigger asChild>
                      <Button size="icon" className="h-9 w-9 rounded-xl" icon={<SlidersHorizontal size={15} />} aria-label={t('hr.people.columns.toggle')} />
                    </DropdownMenuTrigger>
                  </ToolTip>
                  <DropdownMenuContent align="end" className="w-52 rounded-xl p-1.5">
                    <DropdownMenuLabel className="text-xs text-neutral-500">{t('hr.people.columns.people_data')}</DropdownMenuLabel>
                    {peopleColumns.map((c) => (
                      <DropdownMenuCheckboxItem
                        key={c.id}
                        checked={showCol(c.id)}
                        onSelect={(e) => e.preventDefault()}
                        onCheckedChange={() => toggleColumn(c.id)}
                      >
                        <span className="truncate">{c.label}</span>
                      </DropdownMenuCheckboxItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </span>
            )}
            {view === 'members' && (
              <DropdownMenu modal={false}>
                <DropdownMenuTrigger asChild>
                  <Button size="icon" className="h-9 w-9 rounded-xl" icon={<DotsThree size={16} weight="bold" />} aria-label={t('dashboard.users.toolbar.more')} />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56 rounded-xl p-1.5">
                  <DropdownMenuItem
                    disabled={total === 0 || isExporting}
                    onSelect={handleExportCSV}
                    className="flex items-center gap-2 cursor-pointer"
                  >
                    <DownloadSimple size={15} /> {t('dashboard.users.active_users.actions.export_csv', { defaultValue: 'Export users (CSV)' })}
                  </DropdownMenuItem>
                  {people.enabled && canManageOrg && (
                    <DropdownMenuItem onSelect={() => setImportOpen(true)} className="flex items-center gap-2 cursor-pointer">
                      <FileCsv size={15} /> {t('hr.people.import.people_button')}
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            <Button
              variant="primary"
              icon={<UserPlus size={14} />}
              onClick={() => setInviteOpen(true)}
              aria-label={t('dashboard.users.dash.members.invite')}
            >
              <span className="hidden sm:inline">{t('dashboard.users.dash.members.invite')}</span>
            </Button>
          </div>
        </div>
      </div>

      {/* Active filters, only while there are some */}
      {view === 'members' && activeFilters.length > 0 && (
        <div className="-mt-2 flex flex-wrap items-center gap-1.5">
          {activeFilters.map((f) => (
            <span
              key={f.key}
              className="inline-flex items-center gap-1 rounded-full bg-white ps-2.5 pe-1 py-0.5 text-xs font-semibold text-neutral-700 ring-1 ring-inset ring-neutral-200"
            >
              <span className="text-neutral-400 font-medium">{f.label}:</span>
              <span className="truncate max-w-[180px]">{f.valueLabel}</span>
              <button
                type="button"
                onClick={() => {
                  f.clear()
                  resetPaging()
                }}
                aria-label={t('dashboard.users.toolbar.remove_filter', { name: f.label })}
                className="inline-flex h-5 w-5 items-center justify-center rounded-full text-neutral-400 hover:bg-neutral-100 hover:text-neutral-800"
              >
                <X size={11} weight="bold" />
              </button>
            </span>
          ))}
          <button type="button" onClick={resetFilterSelects} className="ms-1 text-xs font-semibold text-neutral-500 hover:text-neutral-900">
            {t('dashboard.users.toolbar.clear_all')}
          </button>
        </div>
      )}

      {/* Results line */}
      {view === 'members' && data && (
        <div className="flex flex-wrap items-center justify-between gap-3 -mt-1 text-xs text-neutral-500">
          <span className="flex flex-wrap items-center gap-2">
            <span className="tabular-nums">
              {hasActiveFilters
                ? t('dashboard.users.dash.members.matching', { count: total })
                : t('dashboard.users.dash.members.total', { count: total })}
            </span>
            {/* Only surfaces once the org holds more members than its plan
                includes; within the included seats there is nothing to
                report. No amounts here: billing owns the numbers. */}
            {summary && summary.members_beyond_included > 0 && (
              <ToolTip content={t('dashboard.users.active_users.beyond_included_tooltip')} side="top">
                {billingUrl ? (
                  <Link href={billingUrl}>
                    <Chip tone="amber">
                      {t('dashboard.users.active_users.beyond_included', { count: summary.members_beyond_included })}
                    </Chip>
                  </Link>
                ) : (
                  <Chip tone="amber">
                    {t('dashboard.users.active_users.beyond_included', { count: summary.members_beyond_included })}
                  </Chip>
                )}
              </ToolTip>
            )}
          </span>
          {hasActiveFilters && activeFilters.length === 0 && (
            <button type="button" onClick={resetFilters} className="font-semibold text-neutral-700 hover:text-neutral-900">
              {t('dashboard.users.active_users.filters.clear_filters')}
            </button>
          )}
        </div>
      )}

      {view === 'invited' ? (
        <div className="bg-white rounded-2xl nice-shadow overflow-hidden">
          <InvitationsList search={searchValue} onInvite={() => setInviteOpen(true)} />
        </div>
      ) : (
        <div className="bg-white rounded-2xl nice-shadow overflow-hidden">
          {isInitialLoading ? (
            <RowSkeleton rows={8} />
          ) : members.length === 0 ? (
            hasActiveFilters ? (
              <EmptyState
                icon={<Tray size={22} />}
                title={t('dashboard.users.active_users.no_results')}
                description={t('dashboard.users.dash.members.no_results_description')}
                action={
                  <Button size="sm" onClick={resetFilters}>
                    {t('dashboard.users.active_users.filters.clear_all_filters')}
                  </Button>
                }
              />
            ) : (
              <EmptyState
                icon={<Users size={22} />}
                title={t('dashboard.users.active_users.no_users')}
                description={t('dashboard.users.dash.members.empty_description')}
                action={
                  <Button variant="primary" icon={<UserPlus size={14} />} onClick={() => setInviteOpen(true)}>
                    {t('dashboard.users.dash.members.invite')}
                  </Button>
                }
              />
            )
          ) : (
            <div className={wideTable ? 'overflow-x-auto' : ''}>
              <div
                style={tableStyle}
                className={`${TABLE} ${wideTable ? 'lg:min-w-[var(--users-min-w)]' : ''} relative transition-opacity ${
                  isPageTransitioning ? 'opacity-60' : ''
                }`}
              >
                <div className={`hidden ${ROW} px-5 py-3 border-b border-neutral-100 text-xs font-medium text-neutral-500`}>
                  <span className="flex items-center">
                    <CheckBox
                      checked={allVisibleSelected}
                      indeterminate={!allVisibleSelected && selectedOnPage.length > 0}
                      onChange={toggleSelectAll}
                      label={t('dashboard.users.dash.members.select_page')}
                    />
                  </span>
                  <span>{t('dashboard.users.active_users.table.user')}</span>
                  <span>{t('dashboard.users.active_users.table.role')}</span>
                  {showCol('title') && <span>{t('hr.people.fields.title')}</span>}
                  {showCol('department') && <span>{t('hr.people.fields.department')}</span>}
                  {showCol('manager') && <span>{t('hr.people.fields.manager')}</span>}
                  {extraColumns.map((c) => (
                    <span key={c.id} className="truncate">
                      {c.label}
                    </span>
                  ))}
                  <span>{t('dashboard.users.active_users.table.groups')}</span>
                  <span>{t('dashboard.users.active_users.table.status')}</span>
                  <button
                    type="button"
                    onClick={() => {
                      setSortOrder((s) => (s === 'desc' ? 'asc' : 'desc'))
                      resetPaging()
                    }}
                    className="inline-flex items-center gap-1 text-start hover:text-neutral-800"
                    aria-label={t('dashboard.users.dash.members.sort_joined')}
                  >
                    {t('dashboard.users.active_users.table.joined')}
                    {sortOrder === 'desc' ? <ArrowDown size={12} /> : <ArrowUp size={12} />}
                  </button>
                  {customFields.map((field) => (
                    <span key={field.key} className="truncate">
                      {field.label || field.key}
                    </span>
                  ))}
                  <span className="sr-only">{t('dashboard.users.active_users.table.actions')}</span>
                </div>
                <ul className={`divide-y divide-neutral-100 ${ROW}`}>
                  {members.map((member) => {
                    const user = member.user
                    const selected = selectedUserIds.has(user.id)
                    const isSelf = user.id === currentUserId
                    return (
                      <li
                        key={user.id}
                        data-member-row={user.id}
                        onClick={(e) => onRowClick(e, user.id)}
                        onMouseEnter={() => warmMember(user.id)}
                        onMouseLeave={coolMember}
                        className={`group flex items-center gap-3 px-4 sm:px-5 py-3 transition-colors cursor-pointer data-[panel-active=true]:bg-sky-50/70 data-[panel-active=true]:shadow-[inset_2px_0_0_var(--color-sky-500)] rtl:data-[panel-active=true]:shadow-[inset_-2px_0_0_var(--color-sky-500)] ${
                          selected ? 'bg-neutral-50' : 'hover:bg-neutral-50/70'
                        } ${ROW}`}
                      >
                        <div className="flex items-center">
                          <CheckBox
                            checked={selected}
                            onChange={() => toggleSelectUser(user.id)}
                            label={t('dashboard.users.dash.members.select_user', { name: displayName(user) })}
                          />
                        </div>

                        <div className="min-w-0 flex-1">
                          <PersonCell user={user} popup={false} onOpen={() => openMember(user.id)}>
                            <div className="lg:hidden mt-1.5 flex flex-wrap items-center gap-1.5">
                              <RolePicker role={member.role} roles={roles} disabled={!canManageOrg || isSelf} onPick={(role) => setRoleChange({ member, role })} />
                              <VerifiedChip verified={!!user.email_verified} />
                            </div>
                          </PersonCell>
                        </div>

                        <div className="hidden lg:block min-w-0">
                          <RolePicker
                            role={member.role}
                            roles={roles}
                            disabled={!roles || !canManageOrg || isSelf}
                            onPick={(role) => setRoleChange({ member, role })}
                          />
                        </div>

                        {showCol('title') && (
                          <ProfileCell onOpen={() => openProfile(user.id)} empty={!member.profile?.title}>
                            <span className="text-sm text-neutral-700 truncate">{member.profile?.title}</span>
                          </ProfileCell>
                        )}
                        {showCol('department') && (
                          <ProfileCell onOpen={() => openProfile(user.id)} empty={!member.profile?.department}>
                            <Chip tone="sky" icon={<Buildings size={12} weight="fill" />} className="max-w-full">
                              <span className="truncate">{member.profile?.department}</span>
                            </Chip>
                          </ProfileCell>
                        )}
                        {showCol('manager') && (
                          <ProfileCell onOpen={() => openProfile(user.id)} empty={!member.profile?.manager}>
                            <span className="text-sm text-neutral-700 truncate">{displayName(member.profile?.manager)}</span>
                          </ProfileCell>
                        )}
                        {extraColumns.map((c) => {
                          const text = extraColumnText(member, c)
                          return (
                            <ProfileCell key={c.id} onOpen={() => openProfile(user.id)} empty={!text}>
                              <span className="text-sm text-neutral-700 truncate">{text}</span>
                            </ProfileCell>
                          )
                        })}

                        <div className="hidden lg:flex items-center gap-1 min-w-0 flex-wrap">
                          <GroupChips groups={member.usergroups} />
                        </div>

                        <div className="hidden lg:flex flex-col items-start gap-1 min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <VerifiedChip verified={!!user.email_verified} />
                            <SignupMethod method={user.signup_method} />
                          </div>
                          {typeof member.visit_days === 'number' ? (
                            <span
                              className={`text-xs ${member.is_active ? 'text-emerald-700' : 'text-neutral-400'}`}
                              title={t(
                                member.is_active
                                  ? 'dashboard.users.active_users.table.visit_days_tooltip_active'
                                  : 'dashboard.users.active_users.table.visit_days_tooltip',
                                { count: member.visit_days }
                              )}
                            >
                              {t(
                                member.is_active
                                  ? 'dashboard.users.active_users.table.active_days'
                                  : 'dashboard.users.active_users.table.inactive_days',
                                { count: member.visit_days }
                              )}
                            </span>
                          ) : (
                            user.last_login_at && (
                              <span className="text-xs text-neutral-400">
                                {t('dashboard.users.active_users.table.last_login', {
                                  date: formatRelative(user.last_login_at, i18n.language),
                                })}
                              </span>
                            )
                          )}
                        </div>

                        <div className="hidden lg:block text-sm text-neutral-600 truncate" title={member.joined_at}>
                          {formatRelative(member.joined_at, i18n.language) ?? '—'}
                        </div>

                        {customFields.map((field) => {
                          const value = formatCustomFieldValue(user.extra_metadata?.[field.key])
                          return (
                            <div key={field.key} className="hidden lg:block text-sm text-neutral-600 truncate" title={value}>
                              {value || <span className="text-neutral-300">—</span>}
                            </div>
                          )
                        })}

                        <div className="flex items-center justify-end gap-1 shrink-0">
                          {showAnalytics && (
                            <span className="hidden sm:inline-flex">
                              <Button
                                size="sm"
                                variant="ghost"
                                icon={<ChartBar size={13} />}
                                onClick={() => openMember(user.id, 'analytics')}
                                title={t('dashboard.users.analytics.view_analytics')}
                              >
                                {t('dashboard.users.analytics.button')}
                              </Button>
                            </span>
                          )}
                          <MemberMenu
                            member={member}
                            orgslug={params.orgslug}
                            canManage={!!canManageOrg && !isSelf}
                            onOpen={() => openMember(user.id)}
                            onAnalytics={showAnalytics ? () => openMember(user.id, 'analytics') : undefined}
                            onCopyEmail={() => user.email && copyEmail(user.email)}
                            onRemove={() => setRemoving(member)}
                          />
                        </div>
                      </li>
                    )
                  })}
                </ul>
              </div>
            </div>
          )}
          <ListPager
            page={page}
            pageSize={ITEMS_PER_PAGE}
            total={total}
            onPage={(p) => {
              setPage(p)
              setSelectedUserIds(new Set())
            }}
          />
        </div>
      )}

      <BulkActionBar
        count={view === 'members' ? selectedCount : 0}
        label={t('dashboard.users.active_users.selection.selected', { count: selectedCount })}
        onClear={() => setSelectedUserIds(new Set())}
      >
        {showAnalytics && (
          <>
            <BulkActionButton icon={<GitDiff size={14} />} label={t('dashboard.users.analytics.compare')} onClick={() => setComparing(true)} />
            <UserAuditExport
              userIds={Array.from(selectedUserIds)}
              label={t('dashboard.users.analytics.export_selected', { count: selectedCount })}
            />
          </>
        )}
        {canManageOrg && (
          <BulkGroupActions userIds={Array.from(selectedUserIds)} onDone={() => setSelectedUserIds(new Set())} />
        )}
        {canManageOrg && (
          <BulkPeopleActions userIds={Array.from(selectedUserIds)} onDone={() => setSelectedUserIds(new Set())} />
        )}
        {canManageOrg && (
          <BulkActionButton
            icon={<SignOut size={14} />}
            label={t('dashboard.users.active_users.selection.remove_selected')}
            onClick={() => setBulkRemove(true)}
            danger
          />
        )}
      </BulkActionBar>

      <InviteMembersModal open={inviteOpen} onOpenChange={setInviteOpen} />
      <PeopleImportDialog open={importOpen} onClose={() => setImportOpen(false)} />

      <ConfirmDialog
        open={!!roleChange}
        onOpenChange={(o) => !o && setRoleChange(null)}
        tone="info"
        title={t('dashboard.users.dash.members.role_confirm_title')}
        message={
          roleChange
            ? t('dashboard.users.dash.members.role_confirm_message', {
                name: displayName(roleChange.member.user),
                from: roleChange.member.role?.name,
                to: roleChange.role?.name,
              })
            : ''
        }
        confirmLabel={t('dashboard.users.dash.members.role_confirm_button')}
        onConfirm={() => {
          if (!roleChange) return
          const { member, role } = roleChange
          setRoleChange(null)
          // Not awaited: the row already shows the new role.
          applyRoleChange(member, role)
        }}
      />

      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={t('dashboard.users.active_users.modals.remove_user.title', { username: removing?.user?.username })}
        message={t('dashboard.users.active_users.modals.remove_user.message')}
        confirmLabel={t('dashboard.users.active_users.modals.remove_user.button')}
        onConfirm={() => {
          if (!removing) return
          const member = removing
          setRemoving(null)
          handleRemoveUser(member)
        }}
      />

      <ConfirmDialog
        open={bulkRemove}
        onOpenChange={setBulkRemove}
        title={t('dashboard.users.active_users.selection.remove_title')}
        message={t('dashboard.users.active_users.selection.remove_message', { count: selectedCount })}
        confirmLabel={t('dashboard.users.active_users.selection.remove_button', { count: selectedCount })}
        onConfirm={handleBatchRemove}
      />

      {/* The member panel (`?user=`), analytics merged in as a tab */}
      {/* listQuery: the same filters/sort, so j/k also works for a member off this page */}
      <UserPanel members={view === 'members' ? members : []} listQuery={view === 'members' ? filterParams().toString() : null} />
      <Modal
        isDialogOpen={showAnalytics && comparing}
        onOpenChange={setComparing}
        size="xl"
        icon={<GitDiff size={16} />}
        dialogTitle={t('dashboard.users.analytics.compare_students')}
        dialogDescription={t('dashboard.users.dash.members.compare_description', { count: selectedCount })}
        dialogContent={
          comparing ? (
            <UsersComparisonTable
              userIds={Array.from(selectedUserIds)}
              onOpenUser={(id) => {
                setComparing(false)
                openMember(id, 'analytics')
              }}
            />
          ) : null
        }
      />
    </div>
  )
}

/** A people-data cell: opens the member panel at "Profile & manager". */
function ProfileCell({ onOpen, empty, children }: { onOpen: () => void; empty: boolean; children: React.ReactNode }) {
  const { t } = useTranslation()
  return (
    <div className="hidden lg:flex min-w-0">
      <button
        type="button"
        onClick={onOpen}
        title={t('hr.people.edit_in_panel')}
        className="min-w-0 max-w-full flex items-center rounded-md text-start hover:underline underline-offset-2 decoration-neutral-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/20"
      >
        {empty ? <span className="text-sm text-neutral-300">—</span> : children}
      </button>
    </div>
  )
}

function VerifiedChip({ verified }: { verified: boolean }) {
  const { t } = useTranslation()
  return verified ? (
    <Chip tone="emerald" icon={<SealCheck size={12} weight="fill" />} title={t('dashboard.users.active_users.table.email_verified')}>
      {t('dashboard.users.analytics.identity.verified')}
    </Chip>
  ) : (
    <Chip tone="amber" icon={<SealWarning size={12} weight="fill" />} title={t('dashboard.users.active_users.table.email_not_verified')}>
      {t('dashboard.users.analytics.identity.unverified')}
    </Chip>
  )
}

function SignupMethod({ method }: { method?: string }) {
  const { t } = useTranslation()
  if (!method) return null
  const label =
    method === 'email'
      ? t('dashboard.users.active_users.table.signup_email')
      : method === 'google'
        ? t('dashboard.users.active_users.table.signup_google')
        : method.charAt(0).toUpperCase() + method.slice(1)
  return (
    <span className="inline-flex items-center gap-1 text-xs text-neutral-500" title={label}>
      {method === 'google' ? <GoogleLogo size={12} /> : <EnvelopeSimple size={12} />}
      <span className="hidden xl:inline">{label}</span>
    </span>
  )
}

function GroupChips({ groups }: { groups?: any[] }) {
  const list = Array.isArray(groups) ? groups : []
  if (!list.length) return <span className="text-sm text-neutral-300">—</span>
  const shown = list.slice(0, 2)
  const rest = list.length - shown.length
  return (
    <>
      {shown.map((g) => (
        <span
          key={g.id}
          title={g.description || g.name}
          className="inline-flex items-center gap-1 max-w-[140px] rounded-md bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-600"
        >
          <UsersThree size={11} className="shrink-0" />
          <span className="truncate">{g.name}</span>
        </span>
      ))}
      {rest > 0 && (
        <span
          title={list.slice(2).map((g) => g.name).join(', ')}
          className="rounded-md bg-neutral-100 px-1.5 py-0.5 text-xs font-semibold text-neutral-500 tabular-nums"
        >
          +{rest}
        </span>
      )}
    </>
  )
}

function MemberMenu({
  member,
  orgslug,
  canManage,
  onOpen,
  onAnalytics,
  onCopyEmail,
  onRemove,
}: {
  member: Member
  orgslug: string
  canManage: boolean
  onOpen: () => void
  onAnalytics?: () => void
  onCopyEmail: () => void
  onRemove: () => void
}) {
  const { t } = useTranslation()
  const ITEM = 'flex items-center gap-2 cursor-pointer'
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={t('dashboard.users.active_users.table.actions')}
          className="h-8 w-8 inline-flex items-center justify-center rounded-lg text-neutral-500 hover:text-neutral-900 hover:bg-neutral-100 data-[state=open]:bg-neutral-100 data-[state=open]:text-neutral-900 transition-colors"
        >
          <DotsThree size={16} weight="bold" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56 rounded-xl p-1.5">
        <DropdownMenuItem onSelect={onOpen} className={ITEM}>
          <SidebarSimple size={15} className="-scale-x-100 rtl:scale-x-100" /> {t('dashboard.users.panel.open')}
        </DropdownMenuItem>
        {onAnalytics && (
          <>
            <DropdownMenuItem onSelect={onAnalytics} className={ITEM}>
              <ChartBar size={15} /> {t('dashboard.users.analytics.view_analytics')}
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href={getUriWithOrg(orgslug, '') + `/dash/users/analytics/${member.user.id}`} className={ITEM}>
                <ArrowSquareOut size={15} /> {t('dashboard.users.analytics.open_full_page')}
              </Link>
            </DropdownMenuItem>
          </>
        )}
        {member.user.email && (
          <DropdownMenuItem onSelect={onCopyEmail} className={ITEM}>
            <Copy size={15} /> {t('dashboard.users.dash.members.copy_email')}
          </DropdownMenuItem>
        )}
        {canManage && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onRemove} className={`${ITEM} text-rose-600 focus:text-rose-700 focus:bg-rose-50`}>
              <SignOut size={15} /> {t('dashboard.users.active_users.actions.remove_from_org')}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export default OrgUsers
