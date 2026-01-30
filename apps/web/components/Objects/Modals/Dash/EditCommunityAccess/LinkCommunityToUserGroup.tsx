'use client'
import { useCommunity } from '@components/Contexts/CommunityContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrg } from '@components/Contexts/OrgContext'
import { getAPIUrl, getUriWithOrg } from '@services/config/config'
import { linkResourcesToUserGroup } from '@services/usergroups/usergroups'
import { swrFetcher } from '@services/utils/ts/requests'
import { Info } from 'lucide-react'
import Link from 'next/link'
import React, { useEffect } from 'react'
import toast from 'react-hot-toast'
import useSWR, { mutate } from 'swr'
import { useTranslation } from 'react-i18next'

type LinkCommunityToUserGroupProps = {
  setUserGroupModal: (value: boolean) => void
}

function LinkCommunityToUserGroup(props: LinkCommunityToUserGroupProps) {
  const { t } = useTranslation()
  const communityState = useCommunity()
  const community = communityState?.community
  const org = useOrg() as any
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token

  const { data: usergroups } = useSWR(
    community && org ? `${getAPIUrl()}usergroups/org/${org.id}?org_id=${org.id}` : null,
    (url) => swrFetcher(url, access_token)
  )
  const [selectedUserGroup, setSelectedUserGroup] = React.useState<any>(null)

  const handleLink = async () => {
    if (!community || !selectedUserGroup) return
    const res = await linkResourcesToUserGroup(
      selectedUserGroup,
      community.community_uuid,
      org.id,
      access_token
    )
    if (res.status === 200) {
      props.setUserGroupModal(false)
      toast.success(t('dashboard.courses.communities.access.usergroups.toasts.link_success'))
      mutate(`${getAPIUrl()}usergroups/resource/${community.community_uuid}?org_id=${org.id}`)
    } else {
      toast.error(
        t('dashboard.courses.communities.access.usergroups.toasts.link_error', {
          status: res.status,
          detail: res.data.detail,
        })
      )
    }
  }

  useEffect(() => {
    if (usergroups && usergroups.length > 0) {
      setSelectedUserGroup(usergroups[0].id)
    }
  }, [usergroups])

  return (
    <div className="flex flex-col space-y-1 ">
      <div className="flex bg-yellow-100 text-yellow-900 mx-auto w-fit mt-3 px-4 py-2 space-x-2 text-sm rounded-full items-center">
        <Info size={19} />
        <h1 className=" font-medium">
          {t('dashboard.courses.communities.access.usergroups.modals.warning')}
        </h1>
      </div>
      <div className="p-4 flex-row flex justify-between items-center">
        {usergroups?.length >= 1 && (
          <div className="py-1">
            <span className="px-3 text-gray-400 font-bold rounded-full py-1 bg-gray-100 mx-3">
              {t('dashboard.courses.communities.access.usergroups.modals.usergroup_name')}{' '}
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
          <div className="flex space-x-3 items-center">
            <span className="px-3 text-yellow-700 font-bold rounded-full py-1 mx-3">
              {t('dashboard.courses.communities.access.usergroups.modals.no_usergroups')}{' '}
            </span>
            <Link
              className="px-3 text-blue-700 font-bold rounded-full py-1 bg-blue-100 mx-1"
              target="_blank"
              href={getUriWithOrg(org.slug, '/dash/users/settings/usergroups')}
            >
              {t('dashboard.courses.communities.access.usergroups.modals.create_usergroup')}
            </Link>
          </div>
        )}
        <div className="py-3">
          <button
            onClick={() => {
              handleLink()
            }}
            className="bg-green-700 text-white font-bold px-4 py-2 rounded-md shadow-sm"
          >
            {t('dashboard.courses.communities.access.usergroups.modals.link_button')}
          </button>
        </div>
      </div>
    </div>
  )
}

export default LinkCommunityToUserGroup
