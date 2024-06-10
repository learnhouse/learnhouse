import { useOrg } from '@components/Contexts/OrgContext'
import PageLoading from '@components/Objects/Loaders/PageLoading'
import ConfirmationModal from '@components/StyledElements/ConfirmationModal/ConfirmationModal'
import { getAPIUrl, getUriWithOrg } from '@services/config/config'
import { swrFetcher } from '@services/utils/ts/requests'
import { Globe, Ticket, UserSquare, Users, X } from 'lucide-react'
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
import Modal from '@components/StyledElements/Modal/Modal'
import OrgInviteCodeGenerate from '@components/Objects/Modals/Dash/OrgAccess/OrgInviteCodeGenerate'
import { useLHSession } from '@components/Contexts/LHSessionContext'

function OrgAccess() {
  const org = useOrg() as any
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token;
  const { data: invites } = useSWR(
    org ? `${getAPIUrl()}orgs/${org?.id}/invites` : null,
    (url) => swrFetcher(url, access_token)
  )
  const [isLoading, setIsLoading] = React.useState(false)
  const [joinMethod, setJoinMethod] = React.useState('closed')
  const [invitesModal, setInvitesModal] = React.useState(false)
  const router = useRouter()

  async function getOrgJoinMethod() {
    if (org) {
      if (org.config.config.GeneralConfig.users.signup_mechanism == 'open') {
        setJoinMethod('open')
      } else {
        setJoinMethod('inviteOnly')
      }
    }
  }

  async function deleteInvite(invite: any) {
    let res = await deleteInviteCode(org.id, invite.invite_code_uuid, access_token)
    if (res.status == 200) {
      mutate(`${getAPIUrl()}orgs/${org.id}/invites`)
    } else {
      toast.error('Error ' + res.status + ': ' + res.data.detail)
    }
  }

  async function changeJoinMethod(method: 'open' | 'inviteOnly') {
    let res = await changeSignupMechanism(org.id, method, access_token)
    if (res.status == 200) {
      router.refresh()
      mutate(`${getAPIUrl()}orgs/slug/${org?.slug}`)
    } else {
      toast.error('Error ' + res.status + ': ' + res.data.detail)
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
          <div className="ml-10 mr-10 mx-auto bg-white rounded-xl shadow-sm px-4 py-4 anit ">
            <div className="flex flex-col bg-gray-50 -space-y-1  px-5 py-3 rounded-md mb-3 ">
              <h1 className="font-bold text-xl text-gray-800">Join method</h1>
              <h2 className="text-gray-500  text-md">
                {' '}
                Choose how users can join your organization{' '}
              </h2>
            </div>
            <div className="flex space-x-2 mx-auto">
              <ConfirmationModal
                confirmationButtonText="Change to open "
                confirmationMessage="Are you sure you want to change the signup mechanism to open ? This will allow users to join your organization freely."
                dialogTitle={'Change to open ?'}
                dialogTrigger={
                  <div className="w-full h-[160px] bg-slate-100 rounded-lg cursor-pointer hover:bg-slate-200 ease-linear transition-all">
                    {joinMethod == 'open' ? (
                      <div className="bg-green-200 text-green-600 font-bold w-fit my-3 mx-3 absolute text-sm px-3 py-1 rounded-lg">
                        Active
                      </div>
                    ) : null}
                    <div className="flex flex-col space-y-1 justify-center items-center h-full">
                      <Globe className="text-slate-400" size={40}></Globe>
                      <div className="text-2xl text-slate-700 font-bold">
                        Open
                      </div>
                      <div className="text-gray-400 text-center">
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
                  <div className="w-full h-[160px] bg-slate-100 rounded-lg cursor-pointer hover:bg-slate-200 ease-linear transition-all">
                    {joinMethod == 'inviteOnly' ? (
                      <div className="bg-green-200 text-green-600 font-bold w-fit my-3 mx-3 absolute text-sm px-3 py-1 rounded-lg">
                        Active
                      </div>
                    ) : null}
                    <div className="flex flex-col space-y-1 justify-center items-center h-full">
                      <Ticket className="text-slate-400" size={40}></Ticket>
                      <div className="text-2xl text-slate-700 font-bold">
                        Closed
                      </div>
                      <div className="text-gray-400 text-center">
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
                  ? 'opacity-20 pointer-events-none'
                  : 'pointer-events-auto'
              }
            >
              <div className="flex flex-col bg-gray-50 -space-y-1  px-5 py-3 rounded-md mt-3 mb-3 ">
                <h1 className="font-bold text-xl text-gray-800">
                  Invite codes
                </h1>
                <h2 className="text-gray-500  text-md">
                  Invite codes can be copied and used to join your organization{' '}
                </h2>
              </div>
              <table className="table-auto w-full text-left whitespace-nowrap rounded-md overflow-hidden">
                <thead className="bg-gray-100 text-gray-500 rounded-xl uppercase">
                  <tr className="font-bolder text-sm">
                    <th className="py-3 px-4">Code</th>
                    <th className="py-3 px-4">Signup link</th>
                    <th className="py-3 px-4">Type</th>
                    <th className="py-3 px-4">Expiration date</th>
                    <th className="py-3 px-4">Actions</th>
                  </tr>
                </thead>
                <>
                  <tbody className="mt-5 bg-white rounded-md">
                    {invites?.map((invite: any) => (
                      <tr
                        key={invite.invite_code_uuid}
                        className="border-b border-gray-100 text-sm"
                      >
                        <td className="py-3 px-4">{invite.invite_code}</td>
                        <td className="py-3 px-4 ">
                          <Link
                            className="outline bg-gray-50 text-gray-600 px-2 py-1 rounded-md outline-gray-300 outline-dashed outline-1"
                            target="_blank"
                            href={getUriWithOrg(
                              org?.slug,
                              `/signup?inviteCode=${invite.invite_code}`
                            )}
                          >
                            {getUriWithOrg(
                              org?.slug,
                              `/signup?inviteCode=${invite.invite_code}`
                            )}
                          </Link>
                        </td>
                        <td className="py-3 px-4">
                          {invite.usergroup_id ? (
                            <div className="flex space-x-2 items-center">
                              <UserSquare className="w-4 h-4" />
                              <span>Linked to a UserGroup</span>
                            </div>
                          ) : (
                            <div className="flex space-x-2 items-center">
                              <Users className="w-4 h-4" />
                              <span>Normal</span>
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-4">
                          {dayjs(invite.expiration_date)
                            .add(1, 'year')
                            .format('DD/MM/YYYY')}{' '}
                        </td>
                        <td className="py-3 px-4">
                          <ConfirmationModal
                            confirmationButtonText="Delete Code"
                            confirmationMessage="Are you sure you want remove this invite code ?"
                            dialogTitle={'Delete code ?'}
                            dialogTrigger={
                              <button className="mr-2 flex space-x-2 hover:cursor-pointer p-1 px-3 bg-rose-700 rounded-md font-bold items-center text-sm text-rose-100">
                                <X className="w-4 h-4" />
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
              <div className='flex flex-row-reverse mt-3 mr-2'>
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
                  dialogTitle="Generate Invite Code"
                  dialogDescription={
                    'Generate a new invite code for your organization'
                  }
                  dialogTrigger={
                    <button
                      className=" flex space-x-2 hover:cursor-pointer p-1 px-3 bg-green-700 rounded-md font-bold items-center text-sm text-green-100"
                    >
                      <Ticket className="w-4 h-4" />
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
