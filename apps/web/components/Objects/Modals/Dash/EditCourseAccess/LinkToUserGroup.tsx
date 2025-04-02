'use client'
import { useCourse } from '@components/Contexts/CourseContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrg } from '@components/Contexts/OrgContext'
import { getAPIUrl, getUriWithOrg } from '@services/config/config'
import { linkResourcesToUserGroup } from '@services/usergroups/usergroups'
import { swrFetcher } from '@services/utils/ts/requests'
import { Info } from 'lucide-react'
import Link from 'next/link'
import { useState, useEffect } from 'react'
import toast from 'react-hot-toast'
import useSWR, { mutate } from 'swr'

type LinkToUserGroupProps = {
  // React function, todo: fix types
  setUserGroupModal: any
}

function LinkToUserGroup(props: LinkToUserGroupProps) {
  const course = useCourse() as any
  const org = useOrg() as any
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token
  const courseStructure = course.courseStructure

  const { data: usergroups } = useSWR(
    courseStructure && org ? `${getAPIUrl()}usergroups/org/${org.id}` : null,
    (url) => swrFetcher(url, access_token)
  )
  const [selectedUserGroup, setSelectedUserGroup] = useState(null) as any

  const handleLink = async () => {
    const res = await linkResourcesToUserGroup(
      selectedUserGroup,
      courseStructure.course_uuid,
      access_token
    )
    if (res.status === 200) {
      props.setUserGroupModal(false)
      toast.success('Successfully linked to usergroup')
      mutate(`${getAPIUrl()}usergroups/resource/${courseStructure.course_uuid}`)
    } else {
      toast.error('Error ' + res.status + ': ' + res.data.detail)
    }
  }

  useEffect(() => {
    if (usergroups && usergroups.length > 0) {
      setSelectedUserGroup(usergroups[0].id)
    }
  }, [usergroups])

  return (
    <div className="flex flex-col space-y-1">
      <div className="mx-auto mt-3 flex w-fit items-center space-x-2 rounded-full bg-yellow-100 px-4 py-2 text-sm text-yellow-900">
        <Info size={19} />
        <h1 className="font-medium">
          Users that are not part of the UserGroup will no longer have access to
          this course
        </h1>
      </div>
      <div className="flex flex-row items-center justify-between p-4">
        {usergroups?.length >= 1 && (
          <div className="py-1">
            <span className="mx-3 rounded-full bg-gray-100 px-3 py-1 font-bold text-gray-400">
              UserGroup Name{' '}
            </span>

            <select
              onChange={(e) => setSelectedUserGroup(e.target.value)}
              defaultValue={selectedUserGroup}
            >
              {usergroups &&
                usergroups.map((group: any) => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                  </option>
                ))}
            </select>
          </div>
        )}
        {usergroups?.length == 0 && (
          <div className="flex items-center space-x-3">
            <span className="mx-3 rounded-full px-3 py-1 font-bold text-yellow-700">
              No UserGroups available{' '}
            </span>
            <Link
              className="mx-1 rounded-full bg-blue-100 px-3 py-1 font-bold text-blue-700"
              target="_blank"
              href={getUriWithOrg(org.slug, '/dash/users/settings/usergroups')}
            >
              Create a UserGroup
            </Link>
          </div>
        )}
        <div className="py-3">
          <button
            onClick={() => {
              handleLink()
            }}
            className="rounded-md bg-green-700 px-4 py-2 font-bold text-white shadow-sm"
          >
            Link
          </button>
        </div>
      </div>
    </div>
  )
}

export default LinkToUserGroup
