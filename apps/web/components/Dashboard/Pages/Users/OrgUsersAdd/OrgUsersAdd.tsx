import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrg } from '@components/Contexts/OrgContext'
import PageLoading from '@components/Objects/Loaders/PageLoading'
import Toast from '@components/Objects/StyledElements/Toast/Toast'
import ToolTip from '@components/Objects/StyledElements/Tooltip/Tooltip'
import { getAPIUrl } from '@services/config/config'
import { inviteBatchUsers } from '@services/organizations/invites'
import { swrFetcher } from '@services/utils/ts/requests'
import { Info, UserPlus } from 'lucide-react'
import { useState, useEffect } from 'react'
import toast from 'react-hot-toast'
import useSWR, { mutate } from 'swr'

function OrgUsersAdd() {
  const org = useOrg() as any
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token
  const [isLoading, setIsLoading] = useState(false)
  const [invitedUsers, setInvitedUsers] = useState('')
  const [selectedInviteCode, setSelectedInviteCode] = useState('')

  async function sendInvites() {
    const toastId = toast.loading('Sending invite...')
    setIsLoading(true)
    const res = await inviteBatchUsers(
      org.id,
      invitedUsers,
      selectedInviteCode,
      access_token
    )
    if (res.status == 200) {
      mutate(`${getAPIUrl()}orgs/${org?.id}/invites/users`)
      setIsLoading(false)
      toast.success('Invite sent', { id: toastId })
    } else {
      toast.error('Error sending invite', { id: toastId })
      setIsLoading(false)
    }
  }

  const { data: invites } = useSWR(
    org ? `${getAPIUrl()}orgs/${org?.id}/invites` : null,
    (url) => swrFetcher(url, access_token)
  )
  const { data: invited_users } = useSWR(
    org ? `${getAPIUrl()}orgs/${org?.id}/invites/users` : null,
    (url) => swrFetcher(url, access_token)
  )

  useEffect(() => {
    if (invites) {
      setSelectedInviteCode(invites?.[0]?.invite_code_uuid)
    }
  }, [invites, invited_users])

  return (
    <>
      <Toast></Toast>
      {!isLoading ? (
        <>
          <div className="h-6"></div>
          <div className="anit mx-auto mr-10 ml-10 rounded-xl bg-white px-4 py-4 shadow-xs">
            <div className="mb-3 flex flex-col -space-y-1 rounded-md bg-gray-50 px-5 py-3">
              <h1 className="text-xl font-bold text-gray-800">
                Invite users to your Organization
              </h1>
              <h2 className="text-md text-gray-500">
                {' '}
                Send invite via email, separated by comma{' '}
              </h2>
            </div>
            <div className="mx-auto flex space-x-2">
              <textarea
                onChange={(e) => setInvitedUsers(e.target.value)}
                className="h-[200px] w-full rounded-md border bg-gray-100/40 px-3 py-2 placeholder:text-slate-300 placeholder:italic"
                placeholder="Example : spike.spiegel@bepop.space, michael.scott@dundermifflin.com"
                name=""
                id=""
              ></textarea>
            </div>
            <div className="mx-auto my-5 ml-2 flex items-center justify-between space-x-2 space-x-4">
              <div className="flex items-center space-x-2">
                <p className="flex items-center">Invite Code </p>
                <select
                  onChange={(e) => setSelectedInviteCode(e.target.value)}
                  defaultValue={selectedInviteCode}
                  className="rounded-md border px-3 py-1 text-gray-400"
                  name=""
                  id=""
                >
                  {invites?.map((invite: any) => (
                    <option
                      key={invite.invite_code_uuid}
                      value={invite.invite_code_uuid}
                    >
                      {invite.invite_code}
                    </option>
                  ))}
                </select>
                <ToolTip
                  content={
                    'Use one of the invite codes that you generated from the signup access page'
                  }
                  sideOffset={8}
                  side="right"
                >
                  <Info className="text-gray-400" size={14} />
                </ToolTip>
              </div>
              <div className="flex flex-row-reverse">
                <button
                  onClick={sendInvites}
                  className="flex items-center space-x-2 rounded-md bg-green-700 p-1 px-3 text-sm font-bold text-green-100 hover:cursor-pointer"
                >
                  <UserPlus className="h-4 w-4" />
                  <span>Send invites via email</span>
                </button>
              </div>
            </div>

            <div className="mt-3 mb-3 flex flex-col -space-y-1 rounded-md bg-gray-50 px-5 py-3">
              <h1 className="text-xl font-bold text-gray-800">Invited Users</h1>
              <h2 className="text-md text-gray-500">
                {' '}
                Users who have been invited to join your organization{' '}
              </h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full table-auto overflow-hidden rounded-md text-left whitespace-nowrap">
                <thead className="rounded-xl bg-gray-100 text-gray-500 uppercase">
                  <tr className="font-bolder text-sm">
                    <th className="px-4 py-3">Email</th>
                    <th className="px-4 py-3">Signup Status</th>
                    <th className="px-4 py-3">Email sent</th>
                  </tr>
                </thead>
                <>
                  <tbody className="mt-5 rounded-md bg-white">
                    {invited_users?.map((invited_user: any) => (
                      <tr
                        key={invited_user.email}
                        className="border-b border-gray-100 text-sm"
                      >
                        <td className="px-4 py-3">{invited_user.email}</td>
                        <td className="px-4 py-3">
                          {invited_user.pending ? (
                            <div className="py1 w-fit rounded-md bg-orange-400 px-2 text-orange-100">
                              Pending
                            </div>
                          ) : (
                            <div className="py1 w-fit rounded-md bg-green-400 px-2 text-green-100">
                              Signed
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {invited_user.email_sent ? (
                            <div className="py1 w-fit rounded-md bg-green-600 px-2 text-green-100">
                              Sent
                            </div>
                          ) : (
                            <div className="py1 w-fit rounded-md bg-red-400 px-2 text-red-100">
                              No
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </>
              </table>
            </div>
          </div>
        </>
      ) : (
        <PageLoading />
      )}
    </>
  )
}

export default OrgUsersAdd
