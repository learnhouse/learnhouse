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
      router.refresh()
      mutate(`${getAPIUrl()}orgs/slug/${org?.slug}`)
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
          <div className="ml-10 mr-10 mx-auto bg-white rounded-xl shadow-xs px-4 py-4 anit ">
            <div className="flex flex-col bg-gray-50 -space-y-1  px-5 py-3 rounded-md mb-3 ">
              <h1 className="font-bold text-xl text-gray-800">{t('dashboard.users.signups.title')}</h1>
              <h2 className="text-gray-500  text-md">
                {' '}
                {t('dashboard.users.signups.subtitle')}{' '}
              </h2>
            </div>
            <div className="flex space-x-2 mx-auto">
              <ConfirmationModal
                confirmationButtonText={t('dashboard.users.signups.open.change_to')}
                confirmationMessage={t('dashboard.users.signups.open.confirmation_message')}
                dialogTitle={t('dashboard.users.signups.open.confirmation_title')}
                dialogTrigger={
                  <div className="w-full h-[160px] bg-slate-100 rounded-lg cursor-pointer hover:bg-slate-200 ease-linear transition-all">
                    {joinMethod == 'open' ? (
                      <div className="bg-green-200 text-green-600 font-bold w-fit my-3 mx-3 absolute text-sm px-3 py-1 rounded-lg">
                        {t('dashboard.users.signups.open.active')}
                      </div>
                    ) : null}
                    <div className="flex flex-col space-y-1 justify-center items-center h-full">
                      <Globe className="text-slate-400" size={40}></Globe>
                      <div className="text-2xl text-slate-700 font-bold">
                        {t('dashboard.users.signups.open.title')}
                      </div>
                      <div className="text-gray-400 text-center">
                        {t('dashboard.users.signups.open.description')}
                      </div>
                    </div>
                  </div>
                }
                functionToExecute={() => {
                  changeJoinMethod('open')
                }}
                status="info"
              ></ConfirmationModal>
              <ConfirmationModal
                confirmationButtonText={t('dashboard.users.signups.closed.change_to')}
                confirmationMessage={t('dashboard.users.signups.closed.confirmation_message')}
                dialogTitle={t('dashboard.users.signups.closed.confirmation_title')}
                dialogTrigger={
                  <div className="w-full h-[160px] bg-slate-100 rounded-lg cursor-pointer hover:bg-slate-200 ease-linear transition-all">
                    {joinMethod == 'inviteOnly' ? (
                      <div className="bg-green-200 text-green-600 font-bold w-fit my-3 mx-3 absolute text-sm px-3 py-1 rounded-lg">
                        {t('dashboard.users.signups.closed.active')}
                      </div>
                    ) : null}
                    <div className="flex flex-col space-y-1 justify-center items-center h-full">
                      <Ticket className="text-slate-400" size={40}></Ticket>
                      <div className="text-2xl text-slate-700 font-bold">
                        {t('dashboard.users.signups.closed.title')}
                      </div>
                      <div className="text-gray-400 text-center">
                        {t('dashboard.users.signups.closed.description')}
                      </div>
                    </div>
                  </div>
                }
                functionToExecute={() => {
                  changeJoinMethod('inviteOnly')
                }}
                status="info"
              ></ConfirmationModal>
            </div>
            <div
              className={
                joinMethod == 'open'
                  ? 'opacity-20 pointer-events-none'
                  : 'pointer-events-auto'
              }
            >
              <div className="flex flex-col bg-gray-50 -space-y-1  px-5 py-3 rounded-md mt-3 mb-3 ">
                <h1 className="font-bold text-xl text-gray-800">
                  {t('dashboard.users.signups.invite_codes.title')}
                </h1>
                <h2 className="text-gray-500  text-md">
                  {t('dashboard.users.signups.invite_codes.subtitle')}{' '}
                </h2>
              </div>
              <table className="table-auto w-full text-left whitespace-nowrap rounded-md overflow-hidden">
                <thead className="bg-gray-100 text-gray-500 rounded-xl uppercase">
                  <tr className="font-bolder text-sm">
                    <th className="py-3 px-4">{t('dashboard.users.signups.invite_codes.table.code')}</th>
                    <th className="py-3 px-4">{t('dashboard.users.signups.invite_codes.table.signup_link')}</th>
                    <th className="py-3 px-4">{t('dashboard.users.signups.invite_codes.table.type')}</th>
                    <th className="py-3 px-4">{t('dashboard.users.signups.invite_codes.table.expiration_date')}</th>
                    <th className="py-3 px-4">{t('dashboard.users.signups.invite_codes.table.actions')}</th>
                  </tr>
                </thead>
                <>
                  <tbody className="mt-5 bg-white rounded-md">
                    {invites?.map((invite: any) => (
                      <tr
                        key={invite.invite_code_uuid}
                        className="border-b border-gray-100 text-sm"
                      >
                        <td className="py-3 px-4">
                          <div className="flex items-center space-x-2">
                            <code className="bg-gray-50 px-2 py-0.5 rounded text-sm font-mono">{invite.invite_code}</code>
                            <CopyButton text={invite.invite_code} />
                          </div>
                        </td>
                        <td className="py-3 px-4 ">
                          <div className="flex items-center space-x-2">
                            <Link
                              className="outline bg-gray-50 text-gray-600 px-2 py-1 rounded-md outline-gray-300 outline-dashed outline-1 text-xs truncate max-w-[300px]"
                              target="_blank"
                              href={getUriWithOrg(org.slug, `/signup?inviteCode=${invite.invite_code}`)}
                            >
                              {getUriWithOrg(org.slug, `/signup?inviteCode=${invite.invite_code}`)}
                            </Link>
                            <CopyButton text={getUriWithOrg(org.slug, `/signup?inviteCode=${invite.invite_code}`)} />
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          {invite.usergroup_id ? (
                            <div className="flex items-center space-x-1.5">
                              <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
                                <UserSquare className="w-3 h-3" />
                                <span>{invite.usergroup_name || t('dashboard.users.signups.invite_codes.types.linked_to_usergroup')}</span>
                              </span>
                            </div>
                          ) : (
                            <div className="flex space-x-2 items-center">
                              <Users className="w-4 h-4 text-gray-400" />
                              <span className="text-gray-500">{t('dashboard.users.signups.invite_codes.types.normal')}</span>
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-4">
                          {dayjs(invite.created_at)
                            .add(1, 'year')
                            .format('DD/MM/YYYY')}{' '}
                        </td>
                        <td className="py-3 px-4">
                          <ConfirmationModal
                            confirmationButtonText={t('dashboard.users.signups.invite_codes.actions.delete_code')}
                            confirmationMessage={t('dashboard.users.signups.invite_codes.actions.delete_confirmation_message')}
                            dialogTitle={t('dashboard.users.signups.invite_codes.actions.delete_confirmation_title')}
                            dialogTrigger={
                              <button className="mr-2 flex space-x-2 hover:cursor-pointer p-1 px-3 bg-rose-700 rounded-md font-bold items-center text-sm text-rose-100">
                                <X className="w-4 h-4" />
                                <span> {t('dashboard.users.signups.invite_codes.actions.delete_code')}</span>
                              </button>
                            }
                            functionToExecute={() => {
                              deleteInvite(invite)
                            }}
                            status="warning"
                          ></ConfirmationModal>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </>
              </table>
              <div className='flex items-center justify-between mt-3 mr-2'>
                <span className='text-xs text-gray-400 ml-2'>
                  {inviteCount} / 6 invite codes used
                </span>
                <Modal
                  isDialogOpen={
                    invitesModal
                  }
                  onOpenChange={() =>
                    setInvitesModal(!invitesModal)
                  }
                  minHeight="no-min"
                  minWidth='lg'
                  dialogContent={
                    <OrgInviteCodeGenerate
                      setInvitesModal={setInvitesModal}
                    />
                  }
                  dialogTitle={t('dashboard.users.signups.invite_codes.actions.generate_title')}
                  dialogDescription={t('dashboard.users.signups.invite_codes.actions.generate_description')}
                  dialogTrigger={
                    <button
                      className=" flex space-x-2 hover:cursor-pointer p-1 px-3 bg-green-700 rounded-md font-bold items-center text-sm text-green-100"
                    >
                      <Ticket className="w-4 h-4" />
                      <span> {t('dashboard.users.signups.invite_codes.actions.generate')}</span>
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
