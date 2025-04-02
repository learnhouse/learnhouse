import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrg } from '@components/Contexts/OrgContext'
import { getAPIUrl, getUriWithOrg } from '@services/config/config'
import {
  createInviteCode,
  createInviteCodeWithUserGroup,
} from '@services/organizations/invites'
import { swrFetcher } from '@services/utils/ts/requests'
import { Ticket } from 'lucide-react'
import Link from 'next/link'
import { useState, useEffect } from 'react'
import toast from 'react-hot-toast'
import useSWR, { mutate } from 'swr'

type OrgInviteCodeGenerateProps = {
  setInvitesModal: any
}

function OrgInviteCodeGenerate(props: OrgInviteCodeGenerateProps) {
  const org = useOrg() as any
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token
  const [usergroup_id, setUsergroup_id] = useState(0)

  const { data: usergroups } = useSWR(
    org ? `${getAPIUrl()}usergroups/org/${org.id}` : null,
    (url) => swrFetcher(url, access_token)
  )

  async function createInviteWithUserGroup() {
    const res = await createInviteCodeWithUserGroup(
      org.id,
      usergroup_id,
      session.data?.tokens?.access_token
    )
    if (res.status == 200) {
      mutate(`${getAPIUrl()}orgs/${org.id}/invites`)
      props.setInvitesModal(false)
    } else {
      toast.error('Error ' + res.status + ': ' + res.data.detail)
    }
  }

  async function createInvite() {
    const res = await createInviteCode(
      org.id,
      session.data?.tokens?.access_token
    )
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
  }, [usergroups])
  return (
    <div className="flex space-x-2 pt-2">
      <div className="flex h-[140px] w-full rounded-lg bg-slate-100">
        <div className="mx-auto flex flex-col">
          <h1 className="mx-auto pt-4 font-medium text-gray-600">
            Invite Code linked to a UserGroup
          </h1>
          <h2 className="mx-auto text-xs font-medium text-gray-600">
            On Signup, Users will be automatically linked to a UserGroup of your
            choice
          </h2>
          <div className="mx-auto flex items-center space-x-4 pt-3">
            {usergroups?.length >= 1 && (
              <div className="flex items-center space-x-4">
                <select
                  defaultValue={usergroup_id}
                  className="flex w-fit rounded-md border-2 border-slate-300 bg-gray-100 p-2 text-sm"
                >
                  {usergroups?.map((usergroup: any) => (
                    <option key={usergroup.id} value={usergroup.id}>
                      {usergroup.name}
                    </option>
                  ))}
                </select>

                <div className="">
                  <button
                    onClick={createInviteWithUserGroup}
                    className="flex w-fit items-center space-x-2 rounded-md bg-green-700 p-1 px-3 text-sm font-bold text-green-100 hover:cursor-pointer"
                  >
                    <Ticket className="h-4 w-4" />
                    <span> Generate </span>
                  </button>
                </div>
              </div>
            )}
            {usergroups?.length == 0 && (
              <div className="flex items-center space-x-3 pt-3 text-xs">
                <span className="mx-3 rounded-full px-3 py-1 font-bold text-yellow-700">
                  No UserGroups available{' '}
                </span>
                <Link
                  className="mx-1 rounded-full bg-blue-100 px-3 py-1 font-bold text-blue-700"
                  target="_blank"
                  href={getUriWithOrg(
                    org.slug,
                    '/dash/users/settings/usergroups'
                  )}
                >
                  Create a UserGroup{' '}
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="flex h-[140px] w-full rounded-lg bg-slate-100">
        <div className="mx-auto flex flex-col">
          <h1 className="mx-auto pt-4 font-medium text-gray-600">
            Normal Invite Code
          </h1>
          <h2 className="mx-auto text-xs font-medium text-gray-600">
            On Signup, User will not be linked to any UserGroup
          </h2>
          <div className="mx-auto pt-4">
            <button
              onClick={createInvite}
              className="flex w-fit items-center space-x-2 rounded-md bg-green-700 p-1 px-3 text-sm font-bold text-green-100 hover:cursor-pointer"
            >
              <Ticket className="h-4 w-4" />
              <span> Generate </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default OrgInviteCodeGenerate
