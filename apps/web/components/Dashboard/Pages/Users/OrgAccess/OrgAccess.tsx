import { useOrg } from '@components/Contexts/OrgContext'
import PageLoading from '@components/Objects/Loaders/PageLoading'
import ConfirmationModal from '@components/Objects/StyledElements/ConfirmationModal/ConfirmationModal'
import { getAPIUrl, getUriWithOrg } from '@services/config/config'
import { swrFetcher } from '@services/utils/ts/requests'
import { Check, Copy, Globe, Ticket, UserSquare, Users, X } from 'lucide-react'
import Link from 'next/link'
import React, { useEffect } from 'react'
import useSWR, { mutate } from 'swr'
import dayjs from 'dayjs'
import {
  changeSignupMechanism,
  deleteInviteCode,
} from '@services/organizations/invites'
import toast from 'react-hot-toast'
import { useRouter } from 'next/navigation'
import Modal from '@components/Objects/StyledElements/Modal/Modal'
import OrgInviteCodeGenerate from '@components/Objects/Modals/Dash/OrgAccess/OrgInviteCodeGenerate'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useTranslation } from 'react-i18next'

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = React.useState(false)

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <button
      onClick={handleCopy}
      className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
      title="Copy to clipboard"
    >
      {copied ? <Check className="w-3.5 h-3.5 text-green-600" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  )
}

function OrgAccess() {
  const { t } = useTranslation()
  const org = useOrg() as any
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token;
  const { data: invites } = useSWR(
    org ? `${getAPIUrl()}orgs/${org?.id}/invites` : null,
    (url) => swrFetcher(url, access_token),
    { revalidateOnFocus: false }
  )
  const [isLoading, setIsLoading] = React.useState(false)
  const [joinMethod, setJoinMethod] = React.useState('closed')
  const [invitesModal, setInvitesModal] = React.useState(false)
  const router = useRouter()

  async function getOrgJoinMethod() {
    if (org) {
      const config = org.config?.config
      const isV2 = config?.config_version?.startsWith('2')
      let signupMode: string

      if (isV2) {
        signupMode = config?.admin_toggles?.members?.signup_mode || 'open'
      } else {
        signupMode = config?.features?.members?.signup_mode || 'open'
      }

      setJoinMethod(signupMode === 'open' ? 'open' : 'inviteOnly')
    }
  }

  async function deleteInvite(invite: any) {
    const toastId = toast.loading(t('dashboard.users.signups.invite_codes.toasts.deleting'))
    let res = await deleteInviteCode(org.id, invite.invite_code_uuid, access_token)
    if (res.status == 200) {
      mutate(`${getAPIUrl()}orgs/${org.id}/invites`)
      toast.success(t('dashboard.users.signups.invite_codes.toasts.delete_success'), {id:toastId})
    } else {
      toast.error(t('dashboard.users.signups.invite_codes.toasts.delete_error'), {id:toastId})
    }
  }

  async function changeJoinMethod(method: 'open' | 'inviteOnly') {
    const toastId = toast.loading(t('dashboard.users.signups.invite_codes.toasts.changing_method'))
    let res = await changeSignupMechanism(org.id, method, access_token)
    if (res.status == 200) {
      setJoinMethod(method)
      mutate(`${getAPIUrl()}orgs/slug/${org?.slug}`)
      router.refresh()
      toast.success(t('dashboard.users.signups.invite_codes.toasts.change_success', { method }), {id:toastId})
    } else {
      toast.error(t('dashboard.users.signups.invite_codes.toasts.change_error'), {id:toastId})
    }
  }

  useEffect(() => {
    if (invites && org) {
      getOrgJoinMethod()
      setIsLoading(false)
    }
  }, [org, invites])

  const inviteCount = invites?.length ?? 0

  return (
    <>
      {!isLoading ? (
        <>
          <div className="h-6"></div>
          <div className="mx-4 sm:mx-10 bg-white rounded-xl nice-shadow">
            {/* Join method header */}
            <div className="px-4 sm:px-6 py-5 border-b border-gray-100">
              <h1 className="font-bold text-xl text-gray-800">{t('dashboard.users.signups.title')}</h1>
              <p className="text-sm text-gray-500 mt-0.5">{t('dashboard.users.signups.subtitle')}</p>
            </div>
            {/* Open / Closed selection */}
            <div className="flex gap-3 p-4 sm:p-6">
              <ConfirmationModal
                confirmationButtonText={t('dashboard.users.signups.open.change_to')}
                confirmationMessage={t('dashboard.users.signups.open.confirmation_message')}
                dialogTitle={t('dashboard.users.signups.open.confirmation_title')}
                dialogTrigger={
                  <div className="relative w-full h-[150px] bg-slate-100 rounded-xl cursor-pointer hover:bg-slate-200 transition-colors">
                    {joinMethod == 'open' && (
                      <div className="absolute top-3 left-3 bg-green-200 text-green-700 font-semibold text-xs px-2.5 py-1 rounded-lg">
                        {t('dashboard.users.signups.open.active')}
                      </div>
                    )}
                    <div className="flex flex-col gap-1 justify-center items-center h-full px-3 text-center">
                      <Globe className="text-slate-400" size={32} />
                      <div className="text-lg text-slate-700 font-bold">{t('dashboard.users.signups.open.title')}</div>
                      <div className="text-gray-400 text-xs">{t('dashboard.users.signups.open.description')}</div>
                    </div>
                  </div>
                }
                functionToExecute={() => changeJoinMethod('open')}
                status="info"
              />
              <ConfirmationModal
                confirmationButtonText={t('dashboard.users.signups.closed.change_to')}
                confirmationMessage={t('dashboard.users.signups.closed.confirmation_message')}
                dialogTitle={t('dashboard.users.signups.closed.confirmation_title')}
                dialogTrigger={
                  <div className="relative w-full h-[150px] bg-slate-100 rounded-xl cursor-pointer hover:bg-slate-200 transition-colors">
                    {joinMethod == 'inviteOnly' && (
                      <div className="absolute top-3 left-3 bg-green-200 text-green-700 font-semibold text-xs px-2.5 py-1 rounded-lg">
                        {t('dashboard.users.signups.closed.active')}
                      </div>
                    )}
                    <div className="flex flex-col gap-1 justify-center items-center h-full px-3 text-center">
                      <Ticket className="text-slate-400" size={32} />
                      <div className="text-lg text-slate-700 font-bold">{t('dashboard.users.signups.closed.title')}</div>
                      <div className="text-gray-400 text-xs">{t('dashboard.users.signups.closed.description')}</div>
                    </div>
                  </div>
                }
                functionToExecute={() => changeJoinMethod('inviteOnly')}
                status="info"
              />
            </div>
            {/* Invite codes section */}
            <div className={joinMethod == 'open' ? 'opacity-20 pointer-events-none' : 'pointer-events-auto'}>
              <div className="px-4 sm:px-6 py-4 border-t border-gray-100">
                <h2 className="font-bold text-lg text-gray-800">{t('dashboard.users.signups.invite_codes.title')}</h2>
                <p className="text-sm text-gray-500 mt-0.5">{t('dashboard.users.signups.invite_codes.subtitle')}</p>
              </div>
              <div className="overflow-x-auto">
                <table className="table-auto w-full text-left whitespace-nowrap">
                  <thead className="bg-gray-50 text-gray-500 uppercase">
                    <tr className="text-xs tracking-wider">
                      <th className="py-3 px-4 sm:px-6">{t('dashboard.users.signups.invite_codes.table.code')}</th>
                      <th className="py-3 px-4 sm:px-6">{t('dashboard.users.signups.invite_codes.table.signup_link')}</th>
                      <th className="py-3 px-4 sm:px-6">{t('dashboard.users.signups.invite_codes.table.type')}</th>
                      <th className="py-3 px-4 sm:px-6">{t('dashboard.users.signups.invite_codes.table.expiration_date')}</th>
                      <th className="py-3 px-4 sm:px-6">{t('dashboard.users.signups.invite_codes.table.actions')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invites?.map((invite: any) => (
                      <tr key={invite.invite_code_uuid} className="border-b border-gray-100 text-sm">
                        <td className="py-3 px-4 sm:px-6">
                          <div className="flex items-center gap-2">
                            <code className="bg-gray-50 px-2 py-0.5 rounded text-sm font-mono">{invite.invite_code}</code>
                            <CopyButton text={invite.invite_code} />
                          </div>
                        </td>
                        <td className="py-3 px-4 sm:px-6">
                          <div className="flex items-center gap-2">
                            <Link
                              className="outline bg-gray-50 text-gray-600 px-2 py-1 rounded-md outline-gray-300 outline-dashed outline-1 text-xs truncate max-w-[200px] sm:max-w-[300px]"
                              target="_blank"
                              href={getUriWithOrg(org.slug, `/signup?inviteCode=${invite.invite_code}`)}
                            >
                              {getUriWithOrg(org.slug, `/signup?inviteCode=${invite.invite_code}`)}
                            </Link>
                            <CopyButton text={getUriWithOrg(org.slug, `/signup?inviteCode=${invite.invite_code}`)} />
                          </div>
                        </td>
                        <td className="py-3 px-4 sm:px-6">
                          {invite.usergroup_id ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
                              <UserSquare className="w-3 h-3" />
                              {invite.usergroup_name || t('dashboard.users.signups.invite_codes.types.linked_to_usergroup')}
                            </span>
                          ) : (
                            <div className="flex items-center gap-1.5 text-gray-500 text-sm">
                              <Users className="w-4 h-4 text-gray-400" />
                              {t('dashboard.users.signups.invite_codes.types.normal')}
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-4 sm:px-6 text-sm text-gray-600">
                          {dayjs(invite.created_at).add(1, 'year').format('DD/MM/YYYY')}
                        </td>
                        <td className="py-3 px-4 sm:px-6">
                          <ConfirmationModal
                            confirmationButtonText={t('dashboard.users.signups.invite_codes.actions.delete_code')}
                            confirmationMessage={t('dashboard.users.signups.invite_codes.actions.delete_confirmation_message')}
                            dialogTitle={t('dashboard.users.signups.invite_codes.actions.delete_confirmation_title')}
                            dialogTrigger={
                              <button className="flex items-center gap-1.5 h-8 px-3 bg-rose-50 text-rose-700 hover:bg-rose-100 rounded-md text-xs font-semibold transition-all">
                                <X className="w-3.5 h-3.5" />
                                <span>{t('dashboard.users.signups.invite_codes.actions.delete_code')}</span>
                              </button>
                            }
                            functionToExecute={() => deleteInvite(invite)}
                            status="warning"
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-wrap items-center justify-between px-4 sm:px-6 py-4 gap-2 border-t border-gray-100">
                <span className="text-xs text-gray-400">{inviteCount} / 6 invite codes used</span>
                <Modal
                  isDialogOpen={invitesModal}
                  onOpenChange={() => setInvitesModal(!invitesModal)}
                  minHeight="no-min"
                  minWidth='lg'
                  dialogContent={<OrgInviteCodeGenerate setInvitesModal={setInvitesModal} />}
                  dialogTitle={t('dashboard.users.signups.invite_codes.actions.generate_title')}
                  dialogDescription={t('dashboard.users.signups.invite_codes.actions.generate_description')}
                  dialogTrigger={
                    <button className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 transition-colors">
                      <Ticket className="w-4 h-4" />
                      <span>{t('dashboard.users.signups.invite_codes.actions.generate')}</span>
                    </button>
                  }
                />
              </div>
            </div>
          </div>
        </>
      ) : (
        <PageLoading />
      )}
    </>
  )
}

export default OrgAccess
