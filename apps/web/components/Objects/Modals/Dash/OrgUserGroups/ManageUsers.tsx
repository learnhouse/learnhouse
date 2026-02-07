import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrg } from '@components/Contexts/OrgContext'
import { getAPIUrl } from '@services/config/config'
import { linkUsersToUserGroup, unlinkUsersFromUserGroup } from '@services/usergroups/usergroups'
import { swrFetcher } from '@services/utils/ts/requests'
import LearnHouseSpinner from '@components/Objects/Loaders/LearnHouseSpinner'
import { Search, Check, Plus, Minus, ChevronLeft, ChevronRight, Users } from 'lucide-react'
import React, { useState, useMemo, useEffect, useCallback } from 'react'
import toast from 'react-hot-toast'
import useSWR, { mutate } from 'swr'
import { useTranslation } from 'react-i18next'
import { Checkbox } from '@components/ui/checkbox'
import { Badge } from '@components/ui/badge'
import { Tabs, TabsList, TabsTrigger } from '@components/ui/tabs'
import UserAvatar from '@components/Objects/UserAvatar'

const ITEMS_PER_PAGE = 20

type ManageUsersProps = {
  usergroup_id: any
}

type FilterTab = 'all' | 'in_group' | 'not_in_group'

function ManageUsers(props: ManageUsersProps) {
  const { t } = useTranslation()
  const org = useOrg() as any
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token

  const [searchValue, setSearchValue] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [activeTab, setActiveTab] = useState<FilterTab>('all')
  const [selectedUserIds, setSelectedUserIds] = useState<Set<number>>(new Set())
  const [page, setPage] = useState(1)

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchValue)
      setPage(1) // Reset to first page on search
    }, 300)
    return () => clearTimeout(timer)
  }, [searchValue])

  // Build query for paginated org users with server-side usergroup filtering
  const buildQuery = useCallback(() => {
    const params = new URLSearchParams()
    params.append('page', page.toString())
    params.append('limit', ITEMS_PER_PAGE.toString())
    if (debouncedSearch) {
      params.append('search', debouncedSearch)
    }
    // Always pass usergroup_id so we get in_group_total in the response
    if (props.usergroup_id) {
      params.append('usergroup_id', props.usergroup_id.toString())
    }
    // Pass filter for in_group / not_in_group tabs
    if (activeTab !== 'all' && props.usergroup_id) {
      params.append('usergroup_filter', activeTab)
    }
    return params.toString()
  }, [page, debouncedSearch, activeTab, props.usergroup_id])

  const usersUrl = org && access_token ? `${getAPIUrl()}orgs/${org?.id}/users?${buildQuery()}` : null
  const { data: usersData, isValidating } = useSWR(
    usersUrl,
    (url) => swrFetcher(url, access_token),
    { keepPreviousData: true }
  )

  const orgUsers = usersData?.items || []
  const total = usersData?.total || 0
  const inGroupTotal: number | undefined = usersData?.in_group_total
  const allTotal: number | undefined = usersData?.all_total
  const isInitialLoading = !usersData && isValidating
  const isPageTransitioning = !!usersData && isValidating

  // Compute tab counts from API response.
  // `all_total` = total org users matching search (always provided when usergroup_id is set)
  // `in_group_total` = in-group users matching search (always provided when usergroup_id is set)
  // `total` = count for the currently active filter tab
  const tabCounts = useMemo(() => {
    if (allTotal == null || inGroupTotal == null) {
      return { all: total, in_group: 0, not_in_group: 0 }
    }
    return {
      all: allTotal,
      in_group: inGroupTotal,
      not_in_group: allTotal - inGroupTotal,
    }
  }, [total, inGroupTotal, allTotal])

  // Determine if a user is in the group from the user's usergroups data
  const isUserPartOfGroup = useCallback((user: any) => {
    if (!user.usergroups) return false
    return user.usergroups.some((ug: any) => ug.id === props.usergroup_id)
  }, [props.usergroup_id])

  // Handle selection
  const toggleUserSelection = (userId: number) => {
    setSelectedUserIds((prev) => {
      const next = new Set(prev)
      if (next.has(userId)) {
        next.delete(userId)
      } else {
        next.add(userId)
      }
      return next
    })
  }

  const selectAllVisible = () => {
    const visibleIds = orgUsers.map((user: any) => user.user.id)
    setSelectedUserIds((prev) => {
      const next = new Set(prev)
      visibleIds.forEach((id: number) => next.add(id))
      return next
    })
  }

  const clearSelection = () => {
    setSelectedUserIds(new Set())
  }

  const isAllVisibleSelected = useMemo(() => {
    if (orgUsers.length === 0) return false
    return orgUsers.every((user: any) => selectedUserIds.has(user.user.id))
  }, [orgUsers, selectedUserIds])

  // Get selected users that are in/not in group (from currently visible users)
  const selectedInGroup = useMemo(() => {
    return Array.from(selectedUserIds).filter((id) => {
      const user = orgUsers.find((u: any) => u.user.id === id)
      return user && isUserPartOfGroup(user)
    })
  }, [selectedUserIds, orgUsers, isUserPartOfGroup])

  const selectedNotInGroup = useMemo(() => {
    return Array.from(selectedUserIds).filter((id) => {
      const user = orgUsers.find((u: any) => u.user.id === id)
      return user && !isUserPartOfGroup(user)
    })
  }, [selectedUserIds, orgUsers, isUserPartOfGroup])

  // Revalidate all tabs' SWR cache after mutations
  const invalidateCache = () => {
    const baseUrl = `${getAPIUrl()}orgs/${org?.id}/users`
    mutate((key: string) => typeof key === 'string' && key.startsWith(baseUrl))
  }

  // Bulk actions
  const handleBulkAdd = async () => {
    if (selectedNotInGroup.length === 0) return
    const toastId = toast.loading(t('dashboard.users.usergroups.modals.manage_users.toasts.bulk_adding'))
    try {
      const res = await linkUsersToUserGroup(props.usergroup_id, selectedNotInGroup, org.id, access_token)
      if (res.status === 200) {
        toast.success(
          t('dashboard.users.usergroups.modals.manage_users.toasts.bulk_add_success', { count: selectedNotInGroup.length }),
          { id: toastId }
        )
        invalidateCache()
        clearSelection()
      } else {
        toast.error(t('dashboard.users.usergroups.modals.manage_users.toasts.error', { status: res.status, detail: res.data.detail }), { id: toastId })
      }
    } catch {
      toast.error(t('dashboard.users.usergroups.modals.manage_users.toasts.bulk_error'), { id: toastId })
    }
  }

  const handleBulkRemove = async () => {
    if (selectedInGroup.length === 0) return
    const toastId = toast.loading(t('dashboard.users.usergroups.modals.manage_users.toasts.bulk_removing'))
    try {
      const res = await unlinkUsersFromUserGroup(props.usergroup_id, selectedInGroup, org.id, access_token)
      if (res.status === 200) {
        toast.success(
          t('dashboard.users.usergroups.modals.manage_users.toasts.bulk_remove_success', { count: selectedInGroup.length }),
          { id: toastId }
        )
        invalidateCache()
        clearSelection()
      } else {
        toast.error(t('dashboard.users.usergroups.modals.manage_users.toasts.error', { status: res.status, detail: res.data.detail }), { id: toastId })
      }
    } catch {
      toast.error(t('dashboard.users.usergroups.modals.manage_users.toasts.bulk_error'), { id: toastId })
    }
  }

  const handlePageChange = (newPage: number) => {
    setPage(newPage)
    setSelectedUserIds(new Set()) // Clear selection on page change
  }

  const handleTabChange = (tab: string) => {
    setActiveTab(tab as FilterTab)
    setPage(1) // Reset to first page on tab change
    setSelectedUserIds(new Set()) // Clear selection on tab change
  }

  const totalPages = Math.ceil(total / ITEMS_PER_PAGE)

  return (
    <div className="py-3 space-y-4">
      {/* Search Input */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          placeholder={t('dashboard.users.usergroups.modals.manage_users.search_placeholder')}
          className="pl-10 pr-4 py-2 w-full border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 transition-all"
          value={searchValue}
          onChange={(e) => setSearchValue(e.target.value)}
        />
      </div>

      {/* Filter Tabs */}
      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="all" className="text-xs">
            {t('dashboard.users.usergroups.modals.manage_users.tabs.all')} ({tabCounts.all})
          </TabsTrigger>
          <TabsTrigger value="in_group" className="text-xs">
            {t('dashboard.users.usergroups.modals.manage_users.tabs.in_group')} ({tabCounts.in_group})
          </TabsTrigger>
          <TabsTrigger value="not_in_group" className="text-xs">
            {t('dashboard.users.usergroups.modals.manage_users.tabs.not_in_group')} ({tabCounts.not_in_group})
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {/* Selection Bar */}
      {selectedUserIds.size > 0 && (
        <div className="flex items-center justify-between bg-indigo-50 px-4 py-2 rounded-lg">
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-indigo-700">
              {t('dashboard.users.usergroups.modals.manage_users.selection.count', { count: selectedUserIds.size })}
            </span>
            <button
              onClick={clearSelection}
              className="text-sm text-indigo-600 hover:text-indigo-800 font-medium"
            >
              {t('dashboard.users.usergroups.modals.manage_users.selection.clear')}
            </button>
          </div>
          <div className="flex items-center gap-2">
            {selectedNotInGroup.length > 0 && (
              <button
                onClick={handleBulkAdd}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-cyan-600 text-white text-sm font-medium rounded-md hover:bg-cyan-700 transition-colors"
              >
                <Plus className="w-4 h-4" />
                {t('dashboard.users.usergroups.modals.manage_users.selection.add_selected', { count: selectedNotInGroup.length })}
              </button>
            )}
            {selectedInGroup.length > 0 && (
              <button
                onClick={handleBulkRemove}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-600 text-white text-sm font-medium rounded-md hover:bg-gray-700 transition-colors"
              >
                <Minus className="w-4 h-4" />
                {t('dashboard.users.usergroups.modals.manage_users.selection.remove_selected', { count: selectedInGroup.length })}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Select All Checkbox */}
      {orgUsers.length > 0 && (
        <div className="flex items-center gap-2 px-2">
          <Checkbox
            id="select-all"
            checked={isAllVisibleSelected}
            onCheckedChange={(checked) => {
              if (checked) {
                selectAllVisible()
              } else {
                clearSelection()
              }
            }}
          />
          <label htmlFor="select-all" className="text-sm text-gray-600 cursor-pointer">
            {t('dashboard.users.usergroups.modals.manage_users.selection.select_all_visible')}
          </label>
        </div>
      )}

      {/* Users List */}
      <div className="space-y-1 max-h-[400px] overflow-y-auto relative">
        {isInitialLoading ? (
          <div className="py-16 flex justify-center">
            <LearnHouseSpinner size={32} />
          </div>
        ) : orgUsers.length === 0 ? (
          <div className="py-12 text-center">
            <div className="flex flex-col items-center gap-3">
              <div className="bg-gray-100 p-4 rounded-full">
                <Users className="w-8 h-8 text-gray-400" />
              </div>
              <p className="text-gray-400 text-sm font-medium">
                {debouncedSearch
                  ? t('dashboard.users.usergroups.modals.manage_users.no_results')
                  : t('dashboard.users.usergroups.modals.manage_users.no_users')
                }
              </p>
            </div>
          </div>
        ) : (
          <>
          {isPageTransitioning && (
            <div className="absolute inset-0 bg-white/60 z-10 flex items-center justify-center rounded-lg">
              <LearnHouseSpinner size={24} />
            </div>
          )}
          {orgUsers.map((user: any) => {
            const inGroup = isUserPartOfGroup(user)
            const isSelected = selectedUserIds.has(user.user.id)
            return (
              <div
                key={user.user.id}
                className={`group flex items-center justify-between p-3 hover:bg-gray-50 rounded-lg transition-all duration-200 ${isSelected ? 'bg-indigo-50/50' : ''}`}
              >
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <Checkbox
                    checked={isSelected}
                    onCheckedChange={() => toggleUserSelection(user.user.id)}
                  />
                  <UserAvatar
                    width={36}
                    userId={user.user.id?.toString()}
                    rounded="rounded-full"
                    showProfilePopup={false}
                  />
                  <div className="flex flex-col min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-gray-800 text-sm truncate">
                        {user.user.first_name + ' ' + user.user.last_name}
                      </span>
                      <span className="text-xs bg-gray-100 px-2 py-0.5 rounded-full text-gray-500 font-medium">
                        @{user.user.username}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="ml-4">
                  {inGroup ? (
                    <Badge variant="default" className="bg-cyan-100 text-cyan-800 hover:bg-cyan-100">
                      <Check className="w-3 h-3 mr-1" />
                      {t('dashboard.users.usergroups.modals.manage_users.status.in_group')}
                    </Badge>
                  ) : (
                    <Badge variant="secondary" className="bg-gray-100 text-gray-600">
                      {t('dashboard.users.usergroups.modals.manage_users.status.not_in_group')}
                    </Badge>
                  )}
                </div>
              </div>
            )
          })}
          </>
        )}
      </div>

      {/* Pagination */}
      {total > ITEMS_PER_PAGE && (
        <div className="flex items-center justify-between px-2 pt-3 border-t border-gray-100">
          <div className="text-xs text-gray-500 font-medium">
            {t('dashboard.users.usergroups.modals.manage_users.pagination.showing', {
              start: (page - 1) * ITEMS_PER_PAGE + 1,
              end: Math.min(page * ITEMS_PER_PAGE, total),
              total
            })}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => handlePageChange(page - 1)}
              disabled={page === 1}
              className="p-1.5 rounded-md border border-gray-200 bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
            >
              <ChevronLeft className="w-4 h-4 text-gray-600" />
            </button>
            <span className="text-xs text-gray-600 font-medium min-w-[60px] text-center">
              {t('dashboard.users.usergroups.modals.manage_users.pagination.page', { current: page, total: totalPages })}
            </span>
            <button
              onClick={() => handlePageChange(page + 1)}
              disabled={page >= totalPages}
              className="p-1.5 rounded-md border border-gray-200 bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
            >
              <ChevronRight className="w-4 h-4 text-gray-600" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default ManageUsers
