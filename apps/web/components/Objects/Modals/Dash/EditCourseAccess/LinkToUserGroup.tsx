'use client';
import { useCookies } from '@components/Contexts/CookiesContext';
import { useCourse } from '@components/Contexts/CourseContext';
import { useLHSession } from '@components/Contexts/LHSessionContext';
import { useOrg } from '@components/Contexts/OrgContext';
import { getAPIUrl, getUriWithOrg } from '@services/config/config';
import { linkResourcesToUserGroup } from '@services/usergroups/usergroups';
import { swrFetcher } from '@services/utils/ts/requests';
import { Info } from 'lucide-react';
import Link from 'next/link';
import React, { useEffect } from 'react'
import toast from 'react-hot-toast';
import useSWR, { mutate } from 'swr'

type LinkToUserGroupProps = {
    // React function, todo: fix types
    setUserGroupModal: any
}

function LinkToUserGroup(props: LinkToUserGroupProps) {
    const cookies = useCookies() as any;
    const course = useCourse() as any
    const org = useOrg() as any
    const session = useLHSession() as any
    const access_token = session?.data?.tokens?.access_token;
    const courseStructure = course.courseStructure

    const { data: usergroups } = useSWR(
        courseStructure && org ? `${getAPIUrl()}usergroups/org/${org.id}` : null,
        (url) => swrFetcher(url, access_token)
    )
    const [selectedUserGroup, setSelectedUserGroup] = React.useState(null) as any


    const handleLink = async () => {
        const res = await linkResourcesToUserGroup(selectedUserGroup, courseStructure.course_uuid, access_token)
        if (res.status === 200) {
            props.setUserGroupModal(false)
            toast.success('Successfully linked to usergroup')
            mutate(`${getAPIUrl()}usergroups/resource/${courseStructure.course_uuid}`)
        }
        else {
            toast.error('Error ' + res.status + ': ' + res.data.detail)
        }
    }

    useEffect(() => {
        if (usergroups && usergroups.length > 0) {
            setSelectedUserGroup(usergroups[0].id)
        }
    }
        , [usergroups])

    return (
        <div className='flex flex-col space-y-1 '>
            <div className='flex bg-yellow-100 text-yellow-900 mx-auto w-fit mt-3 px-4 py-2 space-x-2 text-sm rounded-full items-center'>
                <Info size={19} />
                <h1 className=' font-medium'>Users that are not part of the UserGroup will no longer have access to this course</h1>
            </div>
            <div className='p-4 flex-row flex justify-between items-center'>
                {usergroups?.length >= 1 &&
                    <div className='py-1'>
                        <span className='px-3 text-gray-400 font-bold rounded-full py-1 bg-gray-100 mx-3'>UserGroup Name </span>

                        <select
                            onChange={(e) => setSelectedUserGroup(e.target.value)}
                            defaultValue={selectedUserGroup}
                        >
                            {usergroups && usergroups.map((group: any) => (
                                <option key={group.id} value={group.id}>{group.name}</option>
                            ))}

                        </select>

                    </div>}
                {usergroups?.length == 0 &&
                    <div className='flex space-x-3 items-center'>
                        <span className='px-3 text-yellow-700 font-bold rounded-full py-1 mx-3'>No UserGroups available </span>
                        <Link className='px-3 text-blue-700 font-bold rounded-full py-1 bg-blue-100 mx-1' target='_blank' href={getUriWithOrg(org.slug, '/dash/users/settings/usergroups',cookies)}>Create a UserGroup</Link>
                    </div>}
                <div className='py-3'>
                    <button onClick={() => { handleLink() }} className='bg-green-700 text-white font-bold px-4 py-2 rounded-md shadow'>Link</button>
                </div>
            </div>
        </div>

    )
}

export default LinkToUserGroup