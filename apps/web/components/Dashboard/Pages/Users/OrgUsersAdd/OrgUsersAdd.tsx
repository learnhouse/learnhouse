import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrg } from '@components/Contexts/OrgContext'
import ConfirmationModal from '@components/Objects/StyledElements/ConfirmationModal/ConfirmationModal'
import Toast from '@components/Objects/StyledElements/Toast/Toast'
import ToolTip from '@components/Objects/StyledElements/Tooltip/Tooltip'
import { getAPIUrl } from '@services/config/config'
import { inviteBatchUsers, removeInvitedUser } from '@services/organizations/invites'
import { swrFetcher } from '@services/utils/ts/requests'
import {
  Info,
  UserPlus,
  Check,
  X,
  AlertTriangle,
  Search,
  ChevronLeft,
  ChevronRight,
  Trash2,
  Mail,
  MailX,
  Clock,
  CheckCircle2,
} from 'lucide-react'
import React, { useEffect, useMemo, useState, useCallback } from 'react'
import toast from 'react-hot-toast'
import useSWR, { mutate } from 'swr'
import { useTranslation } from 'react-i18next'

const ITEMS_PER_PAGE = 10

type InviteResult = {
  email: string
  status: 'sent' | 'email_failed' | 'already_invited'
}

type InviteSummary = {
  total: number
  sent: number
  failed: number
  already_invited: number
}

function OrgUsersAdd() {
  const { t } = useTranslation()
  const org = useOrg() as any
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token
  const [isLoading, setIsLoading] = useState(false)
  const [invitedUsers, setInvitedUsers] = useState('')
  const [selectedInviteCode, setSelectedInviteCode] = useState<string | undefined>(undefined)
  const [sendResults, setSendResults] = useState<InviteResult[] | null>(null)
  const [sendSummary, setSendSummary] = useState<InviteSummary | null>(null)
  const [searchValue, setSearchValue] = useState('')
  const [page, setPage] = useState(1)

  const { data: invites } = useSWR(
    org ? `${getAPIUrl()}orgs/${org?.id}/invites` : null,
    (url) => swrFetcher(url, access_token),
    { revalidateOnFocus: false }
  )
  const { data: invited_users } = useSWR(
    org ? `${getAPIUrl()}orgs/${org?.id}/invites/users` : null,
    (url) => swrFetcher(url, access_token),
    { revalidateOnFocus: false }
  )


  // Filter + paginate invited users
  const filteredUsers = useMemo(() => {
    if (!invited_users) return []
    if (!searchValue) return invited_users
    const q = searchValue.toLowerCase()
    return invited_users.filter((u: any) => u.email?.toLowerCase().includes(q))
  }, [invited_users, searchValue])

  const totalFiltered = filteredUsers.length
  const totalPages = Math.max(1, Math.ceil(totalFiltered / ITEMS_PER_PAGE))
  const paginatedUsers = useMemo(
    () => filteredUsers.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE),
    [filteredUsers, page]
  )

  // Reset page when search changes
  const handleSearchChange = useCallback((value: string) => {
    setSearchValue(value)
    setPage(1)
  }, [])

  async function sendInvites() {
    if (!invitedUsers.trim()) return
    const toastId = toast.loading(t('dashboard.users.invite_members.toasts.sending'))
    setIsLoading(true)
    setSendResults(null)
    setSendSummary(null)
    let res = await inviteBatchUsers(org.id, invitedUsers, selectedInviteCode, access_token)
    if (res.status == 200) {
      const data = res.data
      setSendResults(data.results || [])
      setSendSummary(data.summary || null)
      mutate(`${getAPIUrl()}orgs/${org?.id}/invites/users`)
      setIsLoading(false)
      setInvitedUsers('')

      if (data.summary?.failed > 0) {
        toast.error(
          t('dashboard.users.invite_members.toasts.partial', {
            sent: data.summary.sent,
            failed: data.summary.failed,
          }),
          { id: toastId }
        )
      } else {
        toast.success(t('dashboard.users.invite_members.toasts.success'), { id: toastId })
      }
    } else {
      toast.error(t('dashboard.users.invite_members.toasts.error'), { id: toastId })
      setIsLoading(false)
    }
  }

  async function handleRemoveInvitedUser(email: string) {
    const toastId = toast.loading(t('dashboard.users.invite_members.invited_users.removing'))
    const res = await removeInvitedUser(org.id, email, access_token)
    if (res.status === 200) {
      mutate(`${getAPIUrl()}orgs/${org?.id}/invites/users`)
      toast.success(t('dashboard.users.invite_members.invited_users.remove_success'), {
        id: toastId,
      })
    } else {
      toast.error(t('dashboard.users.invite_members.invited_users.remove_error'), {
        id: toastId,
      })
    }
  }

  const statusIcon = (status: string) => {
    switch (status) {
      case 'sent':
        return <Check className="w-3.5 h-3.5" />
      case 'email_failed':
        return <X className="w-3.5 h-3.5" />
      case 'already_invited':
        return <AlertTriangle className="w-3.5 h-3.5" />
      default:
        return null
    }
  }

  const statusStyle = (status: string) => {
    switch (status) {
      case 'sent':
        return 'bg-green-100 text-green-700 border-green-200'
      case 'email_failed':
        return 'bg-red-100 text-red-700 border-red-200'
      case 'already_invited':
        return 'bg-yellow-100 text-yellow-700 border-yellow-200'
      default:
        return 'bg-gray-100 text-gray-700 border-gray-200'
    }
  }

  return (
    <>
      <Toast />
      <div className="h-6"></div>

      {/* Send Invites Section */}
      <div className="ms-10 me-10 mx-auto bg-white rounded-xl shadow-xs">
        <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100">
          <div className="flex-1">
            <h1 className="font-bold text-xl text-gray-800">
              {t('dashboard.users.invite_members.title')}
            </h1>
            <p className="text-sm text-gray-500 mt-0.5">
              {t('dashboard.users.invite_members.subtitle')}
            </p>
          </div>
        </div>

        <div className="px-6 py-5">
          <textarea
            value={invitedUsers}
            onChange={(e) => setInvitedUsers(e.target.value)}
            aria-label={t('dashboard.users.invite_members.email_placeholder')}
            className="w-full h-[140px] rounded-lg border border-gray-200 px-4 py-3 bg-gray-50/50 placeholder:italic placeholder:text-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 transition-all resize-none"
            placeholder={t('dashboard.users.invite_members.email_placeholder')}
          />
          <div className="flex items-center justify-between mt-4">
            <div className="flex items-center gap-3">
              <span className="text-sm text-gray-600 font-medium">
                {t('dashboard.users.invite_members.invite_code_label')}
              </span>
              <select
                onChange={(e) => setSelectedInviteCode(e.target.value || undefined)}
                value={selectedInviteCode || ''}
                aria-label={t('dashboard.users.invite_members.invite_code_label')}
                className="text-sm text-gray-600 border border-gray-200 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 transition-all"
              >
                <option value="">{t('dashboard.users.invite_members.no_invite_code') || 'None'}</option>
                {invites?.map((invite: any) => (
                  <option key={invite.invite_code_uuid} value={invite.invite_code_uuid}>
                    {invite.invite_code}
                  </option>
                ))}
              </select>
              <ToolTip
                content={t('dashboard.users.invite_members.invite_code_tooltip')}
                sideOffset={8}
                side="right"
              >
                <Info className="text-gray-400" size={14} />
              </ToolTip>
            </div>
            <button
              onClick={sendInvites}
              disabled={isLoading || !invitedUsers.trim()}
              className="flex items-center gap-2 px-4 py-2 bg-green-700 hover:bg-green-800 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg font-semibold text-sm text-white transition-all"
            >
              <UserPlus className="w-4 h-4" />
              <span>{t('dashboard.users.invite_members.send_button')}</span>
            </button>
          </div>
        </div>

        {/* Send Results */}
        {sendResults && sendResults.length > 0 && (
          <div className="border-t border-gray-100">
            {sendSummary && (
              <div className="flex items-center gap-4 px-6 py-3 bg-gray-50/50 border-b border-gray-100 text-sm">
                <span className="font-medium text-gray-700">
                  {t('dashboard.users.invite_members.results.summary_title')}
                </span>
                {sendSummary.sent > 0 && (
                  <span className="flex items-center gap-1 text-green-700">
                    <Check className="w-3.5 h-3.5" />
                    {t('dashboard.users.invite_members.results.sent_count', {
                      count: sendSummary.sent,
                    })}
                  </span>
                )}
                {sendSummary.failed > 0 && (
                  <span className="flex items-center gap-1 text-red-700">
                    <X className="w-3.5 h-3.5" />
                    {t('dashboard.users.invite_members.results.failed_count', {
                      count: sendSummary.failed,
                    })}
                  </span>
                )}
                {sendSummary.already_invited > 0 && (
                  <span className="flex items-center gap-1 text-yellow-700">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    {t('dashboard.users.invite_members.results.skipped_count', {
                      count: sendSummary.already_invited,
                    })}
                  </span>
                )}
                <button
                  onClick={() => {
                    setSendResults(null)
                    setSendSummary(null)
                  }}
                  className="ms-auto text-xs text-gray-400 hover:text-gray-600 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}
            <div className="divide-y divide-gray-50">
              {sendResults.map((result) => (
                <div
                  key={result.email}
                  className="flex items-center justify-between px-6 py-2.5 text-sm"
                >
                  <span className="text-gray-700">{result.email}</span>
                  <span
                    className={`flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-xs font-medium border ${statusStyle(result.status)}`}
                  >
                    {statusIcon(result.status)}
                    {t(`dashboard.users.invite_members.results.status.${result.status}`)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Invited Users Table */}
      <div className="h-6"></div>
      <div className="ms-10 me-10 mx-auto bg-white rounded-xl shadow-xs">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100">
          <div className="flex-1">
            <h1 className="font-bold text-xl text-gray-800">
              {t('dashboard.users.invite_members.invited_users.title')}
            </h1>
            <p className="text-sm text-gray-500 mt-0.5">
              {t('dashboard.users.invite_members.invited_users.subtitle')}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {totalFiltered > 0 && (
              <div className="text-sm text-gray-500 bg-gray-50 px-3 py-1.5 rounded-lg font-medium">
                {totalFiltered} {totalFiltered === 1 ? 'invite' : 'invites'}
              </div>
            )}
            <div className="relative">
              <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                placeholder={
                  t('dashboard.users.invite_members.invited_users.search_placeholder') ||
                  'Search by email...'
                }
                className="ps-10 pe-4 py-2 w-[240px] border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 transition-all"
                value={searchValue}
                onChange={(e) => handleSearchChange(e.target.value)}
              />
            </div>
          </div>
        </div>

        {/* Table */}
        <div className="px-0">
          {!invited_users ? (
            <div className="py-16 text-center">
              <p className="text-gray-400 text-sm font-medium">Loading...</p>
            </div>
          ) : paginatedUsers.length === 0 ? (
            <div className="py-16 text-center">
              <div className="flex flex-col items-center gap-3">
                <div className="bg-gray-100 p-4 rounded-full">
                  <Mail className="w-8 h-8 text-gray-400" />
                </div>
                <p className="text-gray-400 text-sm font-medium">
                  {searchValue
                    ? t('dashboard.users.invite_members.invited_users.no_results') ||
                      'No invitations found matching your search'
                    : t('dashboard.users.invite_members.invited_users.no_invites') ||
                      'No pending invitations'}
                </p>
              </div>
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-start text-xs font-semibold text-gray-500 uppercase tracking-wider px-6 py-3">
                    {t('dashboard.users.invite_members.invited_users.table.email')}
                  </th>
                  <th className="text-start text-xs font-semibold text-gray-500 uppercase tracking-wider px-6 py-3">
                    {t('dashboard.users.invite_members.invited_users.table.signup_status')}
                  </th>
                  <th className="text-start text-xs font-semibold text-gray-500 uppercase tracking-wider px-6 py-3">
                    {t('dashboard.users.invite_members.invited_users.table.email_sent')}
                  </th>
                  <th className="text-end text-xs font-semibold text-gray-500 uppercase tracking-wider px-6 py-3">
                    {t('dashboard.users.invite_members.invited_users.table.actions') || 'Actions'}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {paginatedUsers.map((invited_user: any) => (
                  <tr key={invited_user.email} className="hover:bg-gray-50 transition-colors">
                    <td className="px-6 py-4">
                      <span className="text-sm text-gray-800">{invited_user.email}</span>
                    </td>
                    <td className="px-6 py-4">
                      {invited_user.pending ? (
                        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700 bg-amber-50 px-2.5 py-1 rounded-md">
                          <Clock className="w-3.5 h-3.5" />
                          {t('dashboard.users.invite_members.invited_users.status.pending')}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-md">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          {t('dashboard.users.invite_members.invited_users.status.signed')}
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      {invited_user.email_sent ? (
                        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-md">
                          <Mail className="w-3.5 h-3.5" />
                          {t('dashboard.users.invite_members.invited_users.email_status.sent')}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-red-700 bg-red-50 px-2.5 py-1 rounded-md">
                          <MailX className="w-3.5 h-3.5" />
                          {t('dashboard.users.invite_members.invited_users.email_status.no')}
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-end">
                      <ConfirmationModal
                        confirmationButtonText={
                          t('dashboard.users.invite_members.invited_users.remove_button') ||
                          'Remove'
                        }
                        confirmationMessage={
                          t('dashboard.users.invite_members.invited_users.remove_message', {
                            email: invited_user.email,
                          }) || `Remove invitation for ${invited_user.email}?`
                        }
                        dialogTitle={
                          t('dashboard.users.invite_members.invited_users.remove_title') ||
                          'Remove invitation'
                        }
                        dialogTrigger={
                          <button className="inline-flex items-center gap-1.5 h-8 px-3 bg-white text-gray-600 hover:bg-rose-50 hover:text-rose-600 rounded-md text-xs font-medium nice-shadow transition-all">
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>
                              {t('dashboard.users.invite_members.invited_users.remove_button') ||
                                'Remove'}
                            </span>
                          </button>
                        }
                        functionToExecute={() => handleRemoveInvitedUser(invited_user.email)}
                        status="warning"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Pagination */}
        {totalFiltered > ITEMS_PER_PAGE && (
          <div className="flex items-center justify-between px-6 py-4 border-t border-gray-100 bg-gray-50/50">
            <div className="text-xs text-gray-500 font-medium">
              {`${(page - 1) * ITEMS_PER_PAGE + 1}-${Math.min(page * ITEMS_PER_PAGE, totalFiltered)} of ${totalFiltered}`}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="p-2 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
              >
                <ChevronLeft className="w-4 h-4 text-gray-600" />
              </button>
              <span className="text-sm text-gray-600 font-medium min-w-[80px] text-center bg-white px-3 py-2 rounded-lg border border-gray-200">
                {`Page ${page} of ${totalPages}`}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="p-2 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
              >
                <ChevronRight className="w-4 h-4 text-gray-600" />
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  )
}

export default OrgUsersAdd
