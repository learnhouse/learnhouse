import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrg } from '@components/Contexts/OrgContext'
import { getAPIUrl } from '@services/config/config'
import {
  linkUserToUserGroup,
  unLinkUserToUserGroup,
} from '@services/usergroups/usergroups'
import { swrFetcher } from '@services/utils/ts/requests'
import { Check, Plus, X } from 'lucide-react'
import toast from 'react-hot-toast'
import useSWR, { mutate } from 'swr'

type ManageUsersProps = {
  usergroup_id: any
}

function ManageUsers(props: ManageUsersProps) {
  const org = useOrg() as any
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token
  const { data: OrgUsers } = useSWR(
    org ? `${getAPIUrl()}orgs/${org.id}/users` : null,
    (url) => swrFetcher(url, access_token)
  )
  const { data: UGusers } = useSWR(
    org ? `${getAPIUrl()}usergroups/${props.usergroup_id}/users` : null,
    (url) => swrFetcher(url, access_token)
  )

  const isUserPartOfGroup = (user_id: any) => {
    if (UGusers) {
      return UGusers.some((user: any) => user.id === user_id)
    }
    return false
  }

  const handleLinkUser = async (user_id: any) => {
    const res = await linkUserToUserGroup(
      props.usergroup_id,
      user_id,
      access_token
    )
    if (res.status === 200) {
      toast.success('User linked successfully')
      mutate(`${getAPIUrl()}usergroups/${props.usergroup_id}/users`)
    } else {
      toast.error('Error ' + res.status + ': ' + res.data.detail)
    }
  }

  const handleUnlinkUser = async (user_id: any) => {
    const res = await unLinkUserToUserGroup(
      props.usergroup_id,
      user_id,
      access_token
    )
    if (res.status === 200) {
      toast.success('User unlinked successfully')
      mutate(`${getAPIUrl()}usergroups/${props.usergroup_id}/users`)
    } else {
      toast.error('Error ' + res.status + ': ' + res.data.detail)
    }
  }

  return (
    <div className="py-3">
      <table className="w-full table-auto overflow-hidden rounded-md text-left whitespace-nowrap">
        <thead className="rounded-xl bg-gray-100 text-gray-500 uppercase">
          <tr className="font-bolder text-sm">
            <th className="px-4 py-3">User</th>
            <th className="px-4 py-3">Linked</th>
            <th className="px-4 py-3">Actions</th>
          </tr>
        </thead>
        <>
          <tbody className="mt-5 rounded-md bg-white">
            {OrgUsers?.map((user: any) => (
              <tr
                key={user.user.id}
                className="border-b border-dashed border-gray-200 text-sm"
              >
                <td className="flex items-center space-x-2 px-4 py-3">
                  <span>
                    {user.user.first_name + ' ' + user.user.last_name}
                  </span>
                  <span className="rounded-full bg-neutral-100 p-1 px-2 text-xs font-semibold text-neutral-400">
                    @{user.user.username}
                  </span>
                </td>
                <td className="px-4 py-3">
                  {isUserPartOfGroup(user.user.id) ? (
                    <div className="flex w-fit items-center space-x-1 rounded-full bg-cyan-100 px-4 py-1 text-cyan-800">
                      <Check size={16} />
                      <span>Linked</span>
                    </div>
                  ) : (
                    <div className="flex w-fit items-center space-x-1 rounded-full bg-gray-100 px-4 py-1 text-gray-800">
                      <X size={16} />
                      <span>Not linked</span>
                    </div>
                  )}
                </td>
                <td className="flex items-end space-x-2 px-4 py-3">
                  <button
                    onClick={() => handleLinkUser(user.user.id)}
                    className="flex items-center space-x-2 rounded-md bg-cyan-700 p-1 px-3 text-sm font-bold text-cyan-100 hover:cursor-pointer"
                  >
                    <Plus className="h-4 w-4" />
                    <span> Link</span>
                  </button>
                  <button
                    onClick={() => handleUnlinkUser(user.user.id)}
                    className="flex items-center space-x-2 rounded-md bg-gray-700 p-1 px-3 text-sm font-bold text-gray-100 hover:cursor-pointer"
                  >
                    <X className="h-4 w-4" />
                    <span> Unlink</span>
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </>
      </table>
    </div>
  )
}

export default ManageUsers
