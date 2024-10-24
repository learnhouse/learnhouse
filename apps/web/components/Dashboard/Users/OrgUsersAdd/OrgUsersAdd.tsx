import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrg } from '@components/Contexts/OrgContext'
import PageLoading from '@components/Objects/Loaders/PageLoading'
import Toast from '@components/StyledElements/Toast/Toast'
import ToolTip from '@components/StyledElements/Tooltip/Tooltip'
import { getAPIUrl } from '@services/config/config'
import { inviteBatchUsers } from '@services/organizations/invites'
import { swrFetcher } from '@services/utils/ts/requests'
import { Info, UserPlus } from 'lucide-react'
import React, { useEffect } from 'react'
import toast from 'react-hot-toast'
import useSWR, { mutate } from 'swr'

function OrgUsersAdd() {
    const org = useOrg() as any
    const session = useLHSession() as any
    const access_token = session?.data?.tokens?.access_token;
    const [isLoading, setIsLoading] = React.useState(false)
    const [invitedUsers, setInvitedUsers] = React.useState('');
    const [selectedInviteCode, setSelectedInviteCode] = React.useState('');

    async function sendInvites() {
        setIsLoading(true)
        let res = await inviteBatchUsers(org.id, invitedUsers, selectedInviteCode,access_token)
        if (res.status == 200) {
            mutate(`${getAPIUrl()}orgs/${org?.id}/invites/users`)
            setIsLoading(false)
        } else {
            toast.error('Error ' + res.status + ': ' + res.data.detail)
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
    }
        , [invites, invited_users])

    return (
        <>
            <Toast></Toast>
            {!isLoading ? (
                <>
                    <div className="h-6"></div>
                    <div className="ml-10 mr-10 mx-auto bg-white rounded-xl shadow-sm px-4 py-4 anit ">
                        <div className="flex flex-col bg-gray-50 -space-y-1  px-5 py-3 rounded-md mb-3 ">
                            <h1 className="font-bold text-xl text-gray-800">Invite users to your Organization</h1>
                            <h2 className="text-gray-500  text-md">
                                {' '}
                                Send invite via email, separated by comma{' '}
                            </h2>
                        </div>
                        <div className="flex space-x-2 mx-auto">
                            <textarea
                                onChange={(e) => setInvitedUsers(e.target.value)}
                                className='w-full h-[200px] rounded-md border px-3 py-2 bg-gray-100/40 placeholder:italic placeholder:text-slate-300' placeholder='Example : spike.spiegel@bepop.space, michael.scott@dundermifflin.com' name="" id="" ></textarea>
                        </div>
                        <div className="flex space-x-2 mx-auto my-5 ml-2 items-center space-x-4 justify-between">

                            <div className='flex space-x-2 items-center'>
                                <p className='flex items-center'>Invite Code </p>
                                <select
                                    onChange={(e) => setSelectedInviteCode(e.target.value)}
                                    defaultValue={selectedInviteCode}
                                    className='text-gray-400 border rounded-md px-3 py-1' name="" id="">
                                    {invites?.map((invite: any) => (
                                        <option key={invite.invite_code_uuid} value={invite.invite_code_uuid}>{invite.invite_code}</option>
                                    ))}
                                </select>
                                <ToolTip content={'Use one of the invite codes that you generated from the signup access page'} sideOffset={8} side="right"><Info className='text-gray-400' size={14} /></ToolTip>
                            </div>
                            <div className='flex flex-row-reverse '>
                                <button
                                    onClick={sendInvites}
                                    className="flex space-x-2 hover:cursor-pointer p-1 px-3 bg-green-700 rounded-md font-bold items-center text-sm text-green-100"
                                >
                                    <UserPlus className="w-4 h-4" />
                                    <span>Send invites via email</span>
                                </button>
                            </div>
                        </div>


                        <div className="flex flex-col bg-gray-50 -space-y-1  px-5 py-3 rounded-md mt-3 mb-3 ">
                            <h1 className="font-bold text-xl text-gray-800">
                                Invited Users
                            </h1>
                            <h2 className="text-gray-500  text-md">
                                {' '}
                                Users who have been invited to join your organization{' '}
                            </h2>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="table-auto w-full text-left whitespace-nowrap rounded-md overflow-hidden">
                                <thead className="bg-gray-100 text-gray-500 rounded-xl uppercase">
                                    <tr className="font-bolder text-sm">
                                        <th className="py-3 px-4">Email</th>
                                        <th className="py-3 px-4">Signup Status</th>
                                        <th className="py-3 px-4">Email sent</th>
                                    </tr>
                                </thead>
                                <>
                                    <tbody className="mt-5 bg-white rounded-md">
                                        {invited_users?.map((invited_user: any) => (
                                            <tr
                                                key={invited_user.email}
                                                className="border-b border-gray-100 text-sm"
                                            >
                                                <td className="py-3 px-4">{invited_user.email}</td>
                                                <td className="py-3 px-4">{invited_user.pending ? <div className='bg-orange-400 text-orange-100 w-fit px-2 py1 rounded-md'>Pending</div> : <div className='bg-green-400 text-green-100 w-fit px-2 py1 rounded-md'>Signed</div>}</td>
                                                <td className="py-3 px-4">{invited_user.email_sent ? <div className='bg-green-600 text-green-100 w-fit px-2 py1 rounded-md'>Sent</div> : <div className='bg-red-400 text-red-100 w-fit px-2 py1 rounded-md'>No</div>}</td>


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
            )
            }
        </>
    )
}

export default OrgUsersAdd