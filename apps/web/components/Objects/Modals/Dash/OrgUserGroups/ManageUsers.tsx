import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrg } from '@components/Contexts/OrgContext'
import { getAPIUrl } from '@services/config/config'
import { linkUserToUserGroup, unLinkUserToUserGroup } from '@services/usergroups/usergroups'
import { swrFetcher } from '@services/utils/ts/requests'
import { Check, Plus, X } from 'lucide-react'
import React from 'react'
import toast from 'react-hot-toast'
import useSWR, { mutate } from 'swr'


type ManageUsersProps = {
  usergroup_id: any
}

function ManageUsers(props: ManageUsersProps) {
  const org = useOrg() as any
  const session = useLHSession() as any
    const access_token = session?.data?.tokens?.access_token;
  const { data: OrgUsers } = useSWR(
    org ? `${getAPIUrl()}orgs/${org.id}/users` : null,
    swrFetcher
  )
  const { data: UGusers } = useSWR(
    org ? `${getAPIUrl()}usergroups/${props.usergroup_id}/users` : null,
    swrFetcher
  )

  const isUserPartOfGroup = (user_id: any) => {
    if (UGusers) {
      return UGusers.some((user: any) => user.id === user_id)
    }
    return false
  }

  const handleLinkUser = async (user_id: any) => {
    const res = await linkUserToUserGroup(props.usergroup_id, user_id,access_token)
    if (res.status === 200) {
      toast.success('User linked successfully')
      mutate(`${getAPIUrl()}usergroups/${props.usergroup_id}/users`)
    } else {
      toast.error('Error ' + res.status + ': ' + res.data.detail)
    }
  }

  const handleUnlinkUser = async (user_id: any) => {
    const res = await unLinkUserToUserGroup(props.usergroup_id, user_id,access_token)
    if (res.status === 200) {
      toast.success('User unlinked successfully')
      mutate(`${getAPIUrl()}usergroups/${props.usergroup_id}/users`)
    } else {
      toast.error('Error ' + res.status + ': ' + res.data.detail)
    }
  }

  return (
    <div className='py-3'>
      <table className="table-auto w-full text-left whitespace-nowrap rounded-md overflow-hidden">
        <thead className="bg-gray-100 text-gray-500 rounded-xl uppercase">
          <tr className="font-bolder text-sm">
            <th className="py-3 px-4">User</th>
            <th className="py-3 px-4">Linked</th>
            <th className="py-3 px-4">Actions</th>
          </tr>
        </thead>
        <>
          <tbody className="mt-5 bg-white rounded-md">
            {OrgUsers?.map((user: any) => (
              <tr
                key={user.user.id}
                className="border-b border-gray-200 border-dashed text-sm"
              >
                <td className="py-3 px-4 flex space-x-2 items-center">
                  <span>
                    {user.user.first_name + ' ' + user.user.last_name}
                  </span>
                  <span className="text-xs bg-neutral-100 p-1 px-2 rounded-full text-neutral-400 font-semibold">
                    @{user.user.username}
                  </span>
                </td>
                <td className="py-3 px-4">
                  {isUserPartOfGroup(user.user.id) ?
                    <div className="space-x-1 flex w-fit px-4 py-1 bg-cyan-100 rounded-full items-center text-cyan-800">
                      <Check size={16} />
                      <span>Linked</span>
                    </div>
                    :
                    <div className="space-x-1 flex w-fit px-4 py-1 bg-gray-100 rounded-full items-center text-gray-800">
                      <X size={16} />
                      <span>Not linked</span>
                    </div>
                  }
                </td>
                <td className="py-3 px-4 flex space-x-2 items-end">
                  <button
                    onClick={() => handleLinkUser(user.user.id)}
                    className="flex space-x-2 hover:cursor-pointer p-1 px-3 bg-cyan-700 rounded-md font-bold items-center text-sm text-cyan-100">
                    <Plus className="w-4 h-4" />
                    <span> Link</span>
                  </button>
                  <button
                    onClick={() => handleUnlinkUser(user.user.id)}
                    className="flex space-x-2 hover:cursor-pointer p-1 px-3 bg-gray-700 rounded-md font-bold items-center text-sm text-gray-100">
                    <X className="w-4 h-4" />
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