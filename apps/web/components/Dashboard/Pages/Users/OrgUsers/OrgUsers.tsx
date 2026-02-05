'use client'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrg } from '@components/Contexts/OrgContext'
import LearnHouseSpinner from '@components/Objects/Loaders/LearnHouseSpinner'
import ConfirmationModal from '@components/Objects/StyledElements/ConfirmationModal/ConfirmationModal'
import Toast from '@components/Objects/StyledElements/Toast/Toast'
import UserAvatar from '@components/Objects/UserAvatar'
import { getAPIUrl } from '@services/config/config'
import { removeUserFromOrg, updateUserRole } from '@services/organizations/orgs'
import { swrFetcher } from '@services/utils/ts/requests'
import { LogOut, Search, ChevronLeft, ChevronRight, Shield, User, Crown, Users } from 'lucide-react'
import React, { useState } from 'react'
import toast from 'react-hot-toast'
import useSWR, { mutate } from 'swr'
import { useTranslation } from 'react-i18next'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@components/ui/select'

const ITEMS_PER_PAGE = 20

function OrgUsers() {
  const { t } = useTranslation()
  const org = useOrg() as any
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token;

  const [page, setPage] = useState(1)
  const [searchValue, setSearchValue] = useState('')

  const buildQuery = () => {
    const params = new URLSearchParams()
    params.append('page', page.toString())
    params.append('limit', ITEMS_PER_PAGE.toString())
    if (searchValue) {
      params.append('search', searchValue)
    }
    return params.toString()
  }

  const usersUrl = org && access_token ? `${getAPIUrl()}orgs/${org?.id}/users?${buildQuery()}` : null
  const { data, isValidating } = useSWR(
    usersUrl,
    (url) => swrFetcher(url, access_token)
  )

  // Fetch available roles
  const { data: roles } = useSWR(
    org && access_token ? `${getAPIUrl()}roles/org/${org.id}` : null,
    (url) => swrFetcher(url, access_token)
  )

  const orgUsers = data?.items || []
  const total = data?.total || 0
  const isInitialLoading = !data && isValidating
  const isPageTransitioning = !!data && isValidating

  const handleRoleChange = async (user_id: any, newRoleUuid: string) => {
    const toastId = toast.loading(t('dashboard.users.active_users.actions.updating_role') || 'Updating role...');
    const res = await updateUserRole(org.id, user_id, newRoleUuid, access_token)
    if (res.status === 200) {
      await mutate(usersUrl)
      toast.success(t('dashboard.users.active_users.actions.role_update_success') || 'Role updated successfully', {id:toastId});
    } else {
      toast.error(t('dashboard.users.active_users.actions.role_update_error') || 'Error updating role', {id:toastId});
    }
  }

  const handleRemoveUser = async (user_id: any) => {
    const toastId = toast.loading(t('dashboard.users.active_users.actions.removing'));
    const res = await removeUserFromOrg(org.id, user_id,access_token)
    if (res.status === 200) {
      await mutate(usersUrl)
      toast.success(t('dashboard.users.active_users.actions.remove_success'), {id:toastId});
    } else {
      toast.error(t('dashboard.users.active_users.actions.remove_error'), {id:toastId});
    }
  }

  const handlePageChange = (newPage: number) => {
    setPage(newPage)
  }

  const handleSearchChange = (value: string) => {
    setSearchValue(value)
    setPage(1) // Reset to first page when searching
  }

  return (
    <div>
      <Toast></Toast>
      <div className="h-6"></div>
      <div className="ml-10 mr-10 mx-auto bg-white rounded-xl shadow-xs">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100">
              <div className="flex-1">
                <h1 className="font-bold text-xl text-gray-800">{t('dashboard.users.active_users.title')}</h1>
                <p className="text-sm text-gray-500 mt-0.5">
                  {t('dashboard.users.active_users.subtitle')}
                </p>
              </div>
              <div className="flex items-center gap-3">
                {total > 0 && (
                  <div className="text-sm text-gray-500 bg-gray-50 px-3 py-1.5 rounded-lg font-medium">
                    {total} {total === 1 ? 'user' : 'users'}
                  </div>
                )}
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    placeholder={t('dashboard.users.active_users.search_placeholder') || 'Search users...'}
                    className="pl-10 pr-4 py-2 w-[260px] border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 transition-all"
                    value={searchValue}
                    onChange={(e) => handleSearchChange(e.target.value)}
                  />
                </div>
              </div>
            </div>

            {/* Content */}
            <div className="px-0 relative">
              {isInitialLoading ? (
                <div className="py-20 flex justify-center">
                  <LearnHouseSpinner size={36} />
                </div>
              ) : orgUsers.length === 0 ? (
                <div className="py-16 text-center">
                  <div className="flex flex-col items-center gap-3">
                    <div className="bg-gray-100 p-4 rounded-full">
                      <User className="w-8 h-8 text-gray-400" />
                    </div>
                    <p className="text-gray-400 text-sm font-medium">
                      {searchValue
                        ? t('dashboard.users.active_users.no_results') || 'No users found matching your search'
                        : t('dashboard.users.active_users.no_users') || 'No users in this organization yet'
                      }
                    </p>
                  </div>
                </div>
              ) : (
                <div className="relative">
                {isPageTransitioning && (
                  <div className="absolute inset-0 bg-white/60 z-10 flex items-center justify-center rounded-lg">
                    <LearnHouseSpinner size={28} />
                  </div>
                )}
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-100">
                      <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-6 py-3">
                        {t('dashboard.users.active_users.table.user') || 'User'}
                      </th>
                      <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-6 py-3">
                        {t('dashboard.users.active_users.table.groups') || 'Groups'}
                      </th>
                      <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-6 py-3">
                        {t('dashboard.users.active_users.table.role') || 'Role'}
                      </th>
                      <th className="text-right text-xs font-semibold text-gray-500 uppercase tracking-wider px-6 py-3">
                        {t('dashboard.users.active_users.table.actions') || 'Actions'}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {orgUsers?.map((user: any) => (
                      <tr
                        key={user.user.id}
                        className="hover:bg-gray-50 transition-colors"
                      >
                        {/* User Info */}
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <UserAvatar
                              width={40}
                              userId={user.user.id?.toString()}
                              rounded="rounded-full"
                              showProfilePopup={true}
                            />
                            <div className="flex flex-col min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="font-semibold text-gray-800 text-sm truncate">
                                  {user.user.first_name + ' ' + user.user.last_name}
                                </span>
                                <span className="text-xs bg-gray-100 px-2 py-0.5 rounded-full text-gray-500 font-medium">
                                  @{user.user.username}
                                </span>
                              </div>
                              {user.user.email && (
                                <span className="text-xs text-gray-400 truncate">
                                  {user.user.email}
                                </span>
                              )}
                            </div>
                          </div>
                        </td>

                        {/* User Groups */}
                        <td className="px-6 py-4">
                          {user.usergroups && user.usergroups.length > 0 ? (
                            <div className="flex items-center gap-1.5 flex-wrap">
                              {user.usergroups.map((group: any) => (
                                <span
                                  key={group.id}
                                  className="inline-flex items-center gap-1 text-xs bg-blue-50 text-blue-600 px-2 py-1 rounded-md font-medium"
                                  title={group.description}
                                >
                                  <Users className="w-3 h-3" />
                                  {group.name}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span className="text-xs text-gray-400">—</span>
                          )}
                        </td>

                        {/* Role */}
                        <td className="px-6 py-4">
                          <Select
                            value={user.role.role_uuid}
                            onValueChange={(newRoleUuid) => handleRoleChange(user.user.id, newRoleUuid)}
                            disabled={!roles}
                          >
                            <SelectTrigger className={`h-8 w-fit px-3 text-xs font-semibold rounded-md nice-shadow transition-all border-0 ${
                              user.role.name.toLowerCase().includes('admin')
                                ? 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100'
                                : user.role.name.toLowerCase().includes('teacher') || user.role.name.toLowerCase().includes('instructor')
                                ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                                : 'bg-gray-50 text-gray-700 hover:bg-gray-100'
                            }`}>
                              <SelectValue>
                                <div className="flex items-center gap-1.5">
                                  {user.role.name.toLowerCase().includes('admin') ? (
                                    <Crown className="w-3.5 h-3.5" />
                                  ) : user.role.name.toLowerCase().includes('teacher') || user.role.name.toLowerCase().includes('instructor') ? (
                                    <Shield className="w-3.5 h-3.5" />
                                  ) : (
                                    <User className="w-3.5 h-3.5" />
                                  )}
                                  <span>{user.role.name}</span>
                                </div>
                              </SelectValue>
                            </SelectTrigger>
                            <SelectContent>
                              {roles?.map((role: any) => (
                                <SelectItem key={role.id} value={role.role_uuid}>
                                  <div className="flex items-center gap-2">
                                    {role.name.toLowerCase().includes('admin') ? (
                                      <Crown className="w-3.5 h-3.5 text-indigo-600" />
                                    ) : role.name.toLowerCase().includes('teacher') || role.name.toLowerCase().includes('instructor') ? (
                                      <Shield className="w-3.5 h-3.5 text-emerald-600" />
                                    ) : (
                                      <User className="w-3.5 h-3.5 text-gray-500" />
                                    )}
                                    <span>{role.name}</span>
                                  </div>
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </td>

                        {/* Actions */}
                        <td className="px-6 py-4 text-right">
                          <ConfirmationModal
                            confirmationButtonText={t('dashboard.users.active_users.modals.remove_user.button')}
                            confirmationMessage={t('dashboard.users.active_users.modals.remove_user.message')}
                            dialogTitle={t('dashboard.users.active_users.modals.remove_user.title', { username: user.user.username })}
                            dialogTrigger={
                              <button
                                className="inline-flex items-center gap-1.5 h-8 px-3 bg-white text-gray-600 hover:bg-rose-50 hover:text-rose-600 rounded-md text-xs font-medium nice-shadow transition-all"
                                title={t('dashboard.users.active_users.actions.remove_from_org')}
                              >
                                <LogOut className="w-3.5 h-3.5" />
                                <span>{t('dashboard.users.active_users.actions.remove_from_org')}</span>
                              </button>
                            }
                            functionToExecute={() => {
                              handleRemoveUser(user.user.id)
                            }}
                            status="warning"
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              )}
            </div>

            {/* Pagination Controls */}
            {total > ITEMS_PER_PAGE && (
              <div className="flex items-center justify-between px-6 py-4 border-t border-gray-100 bg-gray-50/50">
                <div className="text-xs text-gray-500 font-medium">
                  {t('dashboard.users.active_users.pagination.showing', {
                    start: (page - 1) * ITEMS_PER_PAGE + 1,
                    end: Math.min(page * ITEMS_PER_PAGE, total),
                    total
                  }) || `Showing ${(page - 1) * ITEMS_PER_PAGE + 1}-${Math.min(page * ITEMS_PER_PAGE, total)} of ${total}`}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handlePageChange(page - 1)}
                    disabled={page === 1}
                    className="p-2 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                  >
                    <ChevronLeft className="w-4 h-4 text-gray-600" />
                  </button>
                  <span className="text-sm text-gray-600 font-medium min-w-[80px] text-center bg-white px-3 py-2 rounded-lg border border-gray-200">
                    {t('dashboard.users.active_users.pagination.page', { current: page, total: Math.ceil(total / ITEMS_PER_PAGE) }) || `Page ${page} of ${Math.ceil(total / ITEMS_PER_PAGE)}`}
                  </span>
                  <button
                    onClick={() => handlePageChange(page + 1)}
                    disabled={page * ITEMS_PER_PAGE >= total}
                    className="p-2 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                  >
                    <ChevronRight className="w-4 h-4 text-gray-600" />
                  </button>
                </div>
              </div>
            )}
          </div>
    </div>
  )
}

export default OrgUsers
