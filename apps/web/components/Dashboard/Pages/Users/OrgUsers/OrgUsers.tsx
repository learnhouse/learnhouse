import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrg } from '@components/Contexts/OrgContext'
import PageLoading from '@components/Objects/Loaders/PageLoading'
import RolesUpdate from '@components/Objects/Modals/Dash/OrgUsers/RolesUpdate'
import ConfirmationModal from '@components/Objects/StyledElements/ConfirmationModal/ConfirmationModal'
import Modal from '@components/Objects/StyledElements/Modal/Modal'
import Toast from '@components/Objects/StyledElements/Toast/Toast'
import { getAPIUrl } from '@services/config/config'
import { removeUserFromOrg } from '@services/organizations/orgs'
import { swrFetcher } from '@services/utils/ts/requests'
import { KeyRound, LogOut } from 'lucide-react'
import React, { useEffect } from 'react'
import toast from 'react-hot-toast'
import useSWR, { mutate } from 'swr'

function OrgUsers() {
  const org = useOrg() as any
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token
  const { data: orgUsers } = useSWR(
    org ? `${getAPIUrl()}orgs/${org?.id}/users` : null,
    (url) => swrFetcher(url, access_token)
  )
  const [rolesModal, setRolesModal] = React.useState(false)
  const [selectedUser, setSelectedUser] = React.useState(null) as any
  const [isLoading, setIsLoading] = React.useState(true)

  const handleRolesModal = (user_uuid: any) => {
    setSelectedUser(user_uuid)
    setRolesModal(!rolesModal)
  }

  const handleRemoveUser = async (user_id: any) => {
    const toastId = toast.loading('Removing...')
    const res = await removeUserFromOrg(org.id, user_id, access_token)
    if (res.status === 200) {
      await mutate(`${getAPIUrl()}orgs/${org.id}/users`)
      toast.success('Removed user from org', { id: toastId })
    } else {
      toast.error('Error removing user', { id: toastId })
    }
  }

  useEffect(() => {
    if (orgUsers) {
      setIsLoading(false)
    }
  }, [org, orgUsers])

  return (
    <div>
      {isLoading ? (
        <div>
          <PageLoading />
        </div>
      ) : (
        <>
          <Toast></Toast>
          <div className="h-6"></div>
          <div className="mx-auto mr-10 ml-10 rounded-xl bg-white px-4 py-4 shadow-xs">
            <div className="mb-3 flex flex-col -space-y-1 rounded-md bg-gray-50 px-5 py-3">
              <h1 className="text-xl font-bold text-gray-800">Active users</h1>
              <h2 className="text-md text-gray-500">
                {' '}
                Manage your organization users, assign roles and
                permissions{' '}
              </h2>
            </div>
            <table className="w-full table-auto overflow-hidden rounded-md text-left whitespace-nowrap">
              <thead className="rounded-xl bg-gray-100 text-gray-500 uppercase">
                <tr className="font-bolder text-sm">
                  <th className="px-4 py-3">User</th>
                  <th className="px-4 py-3">Role</th>
                  <th className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <>
                <tbody className="mt-5 rounded-md bg-white">
                  {orgUsers?.map((user: any) => (
                    <tr
                      key={user.user.id}
                      className="border-b border-dashed border-gray-200"
                    >
                      <td className="flex items-center space-x-2 px-4 py-3">
                        <span>
                          {user.user.first_name + ' ' + user.user.last_name}
                        </span>
                        <span className="rounded-full bg-neutral-100 p-1 px-2 text-xs font-semibold text-neutral-400">
                          @{user.user.username}
                        </span>
                      </td>
                      <td className="px-4 py-3">{user.role.name}</td>
                      <td className="flex items-end space-x-2 px-4 py-3">
                        <Modal
                          isDialogOpen={
                            rolesModal && selectedUser === user.user.user_uuid
                          }
                          onOpenChange={() =>
                            handleRolesModal(user.user.user_uuid)
                          }
                          minHeight="no-min"
                          dialogContent={
                            <RolesUpdate
                              alreadyAssignedRole={user.role.role_uuid}
                              setRolesModal={setRolesModal}
                              user={user}
                            />
                          }
                          dialogTitle="Update Role"
                          dialogDescription={
                            'Update @' + user.user.username + "'s role"
                          }
                          dialogTrigger={
                            <button className="flex items-center space-x-2 rounded-md bg-yellow-700 p-1 px-3 text-sm font-bold text-yellow-100 hover:cursor-pointer">
                              <KeyRound className="h-4 w-4" />
                              <span> Edit Role</span>
                            </button>
                          }
                        />

                        <ConfirmationModal
                          confirmationButtonText="Remove User"
                          confirmationMessage="Are you sure you want remove this user from the organization?"
                          dialogTitle={'Delete ' + user.user.username + ' ?'}
                          dialogTrigger={
                            <button className="mr-2 flex items-center space-x-2 rounded-md bg-rose-700 p-1 px-3 text-sm font-bold text-rose-100 hover:cursor-pointer">
                              <LogOut className="h-4 w-4" />
                              <span> Remove from organization</span>
                            </button>
                          }
                          functionToExecute={() => {
                            handleRemoveUser(user.user.id)
                          }}
                          status="warning"
                        ></ConfirmationModal>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

export default OrgUsers
