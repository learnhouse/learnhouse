import { useOrg } from '@components/Contexts/OrgContext'
import { getAPIUrl, getUriWithOrg } from '@services/config/config'
import { createInviteCode, createInviteCodeWithUserGroup } from '@services/organizations/invites'
import { swrFetcher } from '@services/utils/ts/requests'
import { Ticket } from 'lucide-react'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import React, { useEffect } from 'react'
import toast from 'react-hot-toast'
import useSWR, { mutate } from 'swr'
import Link from 'next/link'

type OrgInviteCodeGenerateProps = {
    setInvitesModal: any
}

function OrgInviteCodeGenerate(props: OrgInviteCodeGenerateProps) {
    const org = useOrg() as any
    const session = useLHSession() as any
    const access_token = session?.data?.tokens?.access_token;
    const [usergroup_id, setUsergroup_id] = React.useState(0);

    const { data: usergroups } = useSWR(
        org ? `${getAPIUrl()}usergroups/org/${org.id}` : null,
        (url) => swrFetcher(url, access_token)
    )

    async function createInviteWithUserGroup() {
        let res = await createInviteCodeWithUserGroup(org.id, usergroup_id, session.data?.tokens?.access_token)
        if (res.status == 200) {
            mutate(`${getAPIUrl()}orgs/${org.id}/invites`)
            props.setInvitesModal(false)
        } else {
            toast.error('Error ' + res.status + ': ' + res.data.detail)
        }
    }

    async function createInvite() {
        let res = await createInviteCode(org.id, session.data?.tokens?.access_token)
        if (res.status == 200) {
            mutate(`${getAPIUrl()}orgs/${org.id}/invites`)
            props.setInvitesModal(false)
        } else {
            toast.error('Error ' + res.status + ': ' + res.data.detail)
        }
    }

    useEffect(() => {
        if (usergroups && usergroups.length > 0) {
            setUsergroup_id(usergroups[0].id)
        }
    }
        , [usergroups])
    return (
        <div className='flex space-x-2 pt-2'>
            <div className='flex bg-slate-100 w-full h-[140px] rounded-lg'>
                <div className='flex flex-col mx-auto'>
                    <h1 className='mx-auto pt-4 text-gray-600 font-medium'>Invite Code linked to a UserGroup</h1>
                    <h2 className='mx-auto text-xs text-gray-600 font-medium'>On Signup, Users will be automatically linked to a UserGroup of your choice</h2>
                    <div className='flex items-center space-x-4 pt-3 mx-auto'>
                        {usergroups?.length >= 1 &&
                            <div className='flex space-x-4 items-center'>
                                <select
                                    defaultValue={usergroup_id}
                                    className='flex p-2 w-fit  rounded-md text-sm bg-gray-100'>
                                    {usergroups?.map((usergroup: any) => (
                                        <option key={usergroup.id} value={usergroup.id}>
                                            {usergroup.name}
                                        </option>
                                    ))}

                                </select>

                                <div className=''>
                                    <button
                                        onClick={createInviteWithUserGroup}
                                        className="flex space-x-2 w-fit hover:cursor-pointer p-1 px-3 bg-green-700 rounded-md font-bold items-center text-sm text-green-100"
                                    >
                                        <Ticket className="w-4 h-4" />
                                        <span> Generate </span>
                                    </button>
                                </div>
                            </div>}
                        {usergroups?.length == 0 &&
                            <div className='flex space-x-3 items-center text-xs pt-3'>
                                <span className='px-3 text-yellow-700 font-bold rounded-full py-1 mx-3'>No UserGroups available </span>
                                <Link className='px-3 text-blue-700 font-bold rounded-full py-1 bg-blue-100 mx-1' target='_blank' href={getUriWithOrg(org.slug, '/dash/users/settings/usergroups')}>Create a UserGroup </Link>
                            </div>}
                    </div>
                </div>
            </div>
            <div className='flex bg-slate-100 w-full h-[140px] rounded-lg'>
                <div className='flex flex-col mx-auto'>
                    <h1 className='mx-auto pt-4 text-gray-600 font-medium'>Normal Invite Code</h1>
                    <h2 className='mx-auto text-xs text-gray-600 font-medium'>On Signup, User will not be linked to any UserGroup</h2>
                    <div className='mx-auto pt-4'>
                        <button
                            onClick={createInvite}
                            className="flex space-x-2 w-fit hover:cursor-pointer p-1 px-3 bg-green-700 rounded-md font-bold items-center text-sm text-green-100"
                        >
                            <Ticket className="w-4 h-4" />
                            <span> Generate </span>
                        </button>
                    </div>
                </div>
            </div>
        </div>
    )
}

export default OrgInviteCodeGenerate