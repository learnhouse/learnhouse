'use client';
import { useCourse } from '@components/Contexts/CourseContext';
import { useOrg } from '@components/Contexts/OrgContext';
import { getAPIUrl } from '@services/config/config';
import { linkResourcesToUserGroup } from '@services/usergroups/usergroups';
import { swrFetcher } from '@services/utils/ts/requests';
import React, { useEffect } from 'react'
import toast from 'react-hot-toast';
import useSWR, { mutate } from 'swr'

type LinkToUserGroupProps = {
    // React function, todo: fix types
    setUserGroupModal: any
}

function LinkToUserGroup(props: LinkToUserGroupProps) {
    const course = useCourse() as any
    const org = useOrg() as any
    const courseStructure = course.courseStructure

    const { data: usergroups } = useSWR(
        courseStructure && org ? `${getAPIUrl()}usergroups/org/${org.id}` : null,
        swrFetcher
    )
    const [selectedUserGroup, setSelectedUserGroup] = React.useState(null) as any


    const handleLink = async () => {
        console.log('selectedUserGroup', selectedUserGroup)
        const res = await linkResourcesToUserGroup(selectedUserGroup, courseStructure.course_uuid)
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
        <div className='p-4 flex-row flex justify-between items-center'>

            <div className='py-3'>
                <span className='px-3 text-gray-400 font-bold rounded-full py-1 bg-gray-100 mx-3'>UserGroup Name </span>
                <select
                    onChange={(e) => setSelectedUserGroup(e.target.value)}
                    defaultValue={selectedUserGroup}
                >
                    {usergroups && usergroups.map((group: any) => (
                        <option key={group.id} value={group.id}>{group.name}</option>
                    ))}

                </select>
            </div>
            <div className='py-3'>
                <button onClick={() => { handleLink() }} className='bg-green-700 text-white font-bold px-4 py-2 rounded-md shadow'>Link</button>
            </div>
        </div>
    )
}

export default LinkToUserGroup