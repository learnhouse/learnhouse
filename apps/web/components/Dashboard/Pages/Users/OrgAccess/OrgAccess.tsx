import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrg } from '@components/Contexts/OrgContext'
import PageLoading from '@components/Objects/Loaders/PageLoading'
import OrgInviteCodeGenerate from '@components/Objects/Modals/Dash/OrgAccess/OrgInviteCodeGenerate'
import ConfirmationModal from '@components/Objects/StyledElements/ConfirmationModal/ConfirmationModal'
import Modal from '@components/Objects/StyledElements/Modal/Modal'
import { getAPIUrl, getUriWithoutOrg } from '@services/config/config'
import {
  changeSignupMechanism,
  deleteInviteCode,
} from '@services/organizations/invites'
import { swrFetcher } from '@services/utils/ts/requests'
import dayjs from 'dayjs'
import { Globe, Ticket, UserSquare, Users, X } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, useEffect } from 'react'
import toast from 'react-hot-toast'
import useSWR, { mutate } from 'swr'

function OrgAccess() {
  const org = useOrg() as any
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token
  const { data: invites } = useSWR(
    org ? `${getAPIUrl()}orgs/${org?.id}/invites` : null,
    (url) => swrFetcher(url, access_token)
  )
  const [isLoading, setIsLoading] = useState(false)
  const [joinMethod, setJoinMethod] = useState('closed')
  const [invitesModal, setInvitesModal] = useState(false)
  const router = useRouter()

  async function getOrgJoinMethod() {
    if (org) {
      if (org.config.config.features.members.signup_mode == 'open') {
        setJoinMethod('open')
      } else {
        setJoinMethod('inviteOnly')
      }
    }
  }

  async function deleteInvite(invite: any) {
    const toastId = toast.loading('Deleting...')
    const res = await deleteInviteCode(
      org.id,
      invite.invite_code_uuid,
      access_token
    )
    if (res.status == 200) {
      mutate(`${getAPIUrl()}orgs/${org.id}/invites`)
      toast.success('Deleted invite code', { id: toastId })
    } else {
      toast.error('Error deleting', { id: toastId })
    }
  }

  async function changeJoinMethod(method: 'open' | 'inviteOnly') {
    const toastId = toast.loading('Changing join method...')
    const res = await changeSignupMechanism(org.id, method, access_token)
    if (res.status == 200) {
      router.refresh()
      mutate(`${getAPIUrl()}orgs/slug/${org?.slug}`)
      toast.success(`Changed join method to ${method}`, { id: toastId })
    } else {
      toast.error('Error changing join method', { id: toastId })
    }
  }

  useEffect(() => {
    if (invites && org) {
      getOrgJoinMethod()
      setIsLoading(false)
    }
  }, [org, invites])

  return (
    <>
      {!isLoading ? (
        <>
          <div className="h-6"></div>
          <div className="anit mx-auto mr-10 ml-10 rounded-xl bg-white px-4 py-4 shadow-xs">
            <div className="mb-3 flex flex-col -space-y-1 rounded-md bg-gray-50 px-5 py-3">
              <h1 className="text-xl font-bold text-gray-800">Join method</h1>
              <h2 className="text-md text-gray-500">
                {' '}
                Choose how users can join your organization{' '}
              </h2>
            </div>
            <div className="mx-auto flex space-x-2">
              <ConfirmationModal
                confirmationButtonText="Change to open "
                confirmationMessage="Are you sure you want to change the signup mechanism to open ? This will allow users to join your organization freely."
                dialogTitle={'Change to open ?'}
                dialogTrigger={
                  <div className="h-[160px] w-full cursor-pointer rounded-lg bg-slate-100 transition-all ease-linear hover:bg-slate-200">
                    {joinMethod == 'open' ? (
                      <div className="absolute mx-3 my-3 w-fit rounded-lg bg-green-200 px-3 py-1 text-sm font-bold text-green-600">
                        Active
                      </div>
                    ) : null}
                    <div className="flex h-full flex-col items-center justify-center space-y-1">
                      <Globe className="text-slate-400" size={40}></Globe>
                      <div className="text-2xl font-bold text-slate-700">
                        Open
                      </div>
                      <div className="text-center text-gray-400">
                        Users can join freely from the signup page
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
                confirmationButtonText="Change to closed "
                confirmationMessage="Are you sure you want to change the signup mechanism to closed ? This will allow users to join your organization only by invitation."
                dialogTitle={'Change to closed ?'}
                dialogTrigger={
                  <div className="h-[160px] w-full cursor-pointer rounded-lg bg-slate-100 transition-all ease-linear hover:bg-slate-200">
                    {joinMethod == 'inviteOnly' ? (
                      <div className="absolute mx-3 my-3 w-fit rounded-lg bg-green-200 px-3 py-1 text-sm font-bold text-green-600">
                        Active
                      </div>
                    ) : null}
                    <div className="flex h-full flex-col items-center justify-center space-y-1">
                      <Ticket className="text-slate-400" size={40}></Ticket>
                      <div className="text-2xl font-bold text-slate-700">
                        Closed
                      </div>
                      <div className="text-center text-gray-400">
                        Users can join only by invitation
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
                  ? 'pointer-events-none opacity-20'
                  : 'pointer-events-auto'
              }
            >
              <div className="mt-3 mb-3 flex flex-col -space-y-1 rounded-md bg-gray-50 px-5 py-3">
                <h1 className="text-xl font-bold text-gray-800">
                  Invite codes
                </h1>
                <h2 className="text-md text-gray-500">
                  Invite codes can be copied and used to join your
                  organization{' '}
                </h2>
              </div>
              <table className="w-full table-auto overflow-hidden rounded-md text-left whitespace-nowrap">
                <thead className="rounded-xl bg-gray-100 text-gray-500 uppercase">
                  <tr className="font-bolder text-sm">
                    <th className="px-4 py-3">Code</th>
                    <th className="px-4 py-3">Signup link</th>
                    <th className="px-4 py-3">Type</th>
                    <th className="px-4 py-3">Expiration date</th>
                    <th className="px-4 py-3">Actions</th>
                  </tr>
                </thead>
                <>
                  <tbody className="mt-5 rounded-md bg-white">
                    {invites?.map((invite: any) => (
                      <tr
                        key={invite.invite_code_uuid}
                        className="border-b border-gray-100 text-sm"
                      >
                        <td className="px-4 py-3">{invite.invite_code}</td>
                        <td className="px-4 py-3">
                          <Link
                            className="rounded-md bg-gray-50 px-2 py-1 text-gray-600 outline outline-1 outline-gray-300 outline-dashed"
                            target="_blank"
                            href={getUriWithoutOrg(
                              `/signup?inviteCode=${invite.invite_code}&orgslug=${org.slug}`
                            )}
                          >
                            {getUriWithoutOrg(
                              `/signup?inviteCode=${invite.invite_code}&orgslug=${org.slug}`
                            )}
                          </Link>
                        </td>
                        <td className="px-4 py-3">
                          {invite.usergroup_id ? (
                            <div className="flex items-center space-x-2">
                              <UserSquare className="h-4 w-4" />
                              <span>Linked to a UserGroup</span>
                            </div>
                          ) : (
                            <div className="flex items-center space-x-2">
                              <Users className="h-4 w-4" />
                              <span>Normal</span>
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {dayjs(invite.expiration_date)
                            .add(1, 'year')
                            .format('DD/MM/YYYY')}{' '}
                        </td>
                        <td className="px-4 py-3">
                          <ConfirmationModal
                            confirmationButtonText="Delete Code"
                            confirmationMessage="Are you sure you want remove this invite code ?"
                            dialogTitle={'Delete code ?'}
                            dialogTrigger={
                              <button className="mr-2 flex items-center space-x-2 rounded-md bg-rose-700 p-1 px-3 text-sm font-bold text-rose-100 hover:cursor-pointer">
                                <X className="h-4 w-4" />
                                <span> Delete code</span>
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
              <div className="mt-3 mr-2 flex flex-row-reverse">
                <Modal
                  isDialogOpen={invitesModal}
                  onOpenChange={() => setInvitesModal(!invitesModal)}
                  minHeight="no-min"
                  minWidth="lg"
                  dialogContent={
                    <OrgInviteCodeGenerate setInvitesModal={setInvitesModal} />
                  }
                  dialogTitle="Generate Invite Code"
                  dialogDescription={
                    'Generate a new invite code for your organization'
                  }
                  dialogTrigger={
                    <button className="flex items-center space-x-2 rounded-md bg-green-700 p-1 px-3 text-sm font-bold text-green-100 hover:cursor-pointer">
                      <Ticket className="h-4 w-4" />
                      <span> Generate invite code</span>
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
