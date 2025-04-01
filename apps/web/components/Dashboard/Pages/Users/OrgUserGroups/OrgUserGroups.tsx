'use client'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrg } from '@components/Contexts/OrgContext'
import AddUserGroup from '@components/Objects/Modals/Dash/OrgUserGroups/AddUserGroup'
import EditUserGroup from '@components/Objects/Modals/Dash/OrgUserGroups/EditUserGroup'
import ManageUsers from '@components/Objects/Modals/Dash/OrgUserGroups/ManageUsers'
import ConfirmationModal from '@components/Objects/StyledElements/ConfirmationModal/ConfirmationModal'
import Modal from '@components/Objects/StyledElements/Modal/Modal'
import { getAPIUrl } from '@services/config/config'
import { deleteUserGroup } from '@services/usergroups/usergroups'
import { swrFetcher } from '@services/utils/ts/requests'
import { Pencil, SquareUserRound, Users, X } from 'lucide-react'
import React from 'react'
import toast from 'react-hot-toast'
import useSWR, { mutate } from 'swr'

function OrgUserGroups() {
  const org = useOrg() as any
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token
  const [userGroupManagementModal, setUserGroupManagementModal] =
    React.useState(false)
  const [createUserGroupModal, setCreateUserGroupModal] = React.useState(false)
  const [editUserGroupModal, setEditUserGroupModal] = React.useState(false)
  const [selectedUserGroup, setSelectedUserGroup] = React.useState(null) as any

  const { data: usergroups } = useSWR(
    org ? `${getAPIUrl()}usergroups/org/${org.id}` : null,
    (url) => swrFetcher(url, access_token)
  )

  const deleteUserGroupUI = async (usergroup_id: any) => {
    const toastId = toast.loading('Deleting...')
    const res = await deleteUserGroup(usergroup_id, access_token)
    if (res.status == 200) {
      mutate(`${getAPIUrl()}usergroups/org/${org.id}`)
      toast.success('Deleted usergroup', { id: toastId })
    } else {
      toast.error('Error deleting usergroup', { id: toastId })
    }
  }

  const handleUserGroupManagementModal = (usergroup_id: any) => {
    setSelectedUserGroup(usergroup_id)
    setUserGroupManagementModal(!userGroupManagementModal)
  }

  return (
    <>
      <div className="h-6"></div>
      <div className="mx-auto mr-10 ml-10 rounded-xl bg-white px-4 py-4 shadow-xs">
        <div className="mb-3 flex flex-col -space-y-1 rounded-md bg-gray-50 px-5 py-3">
          <h1 className="text-xl font-bold text-gray-800">
            Manage UserGroups & Users
          </h1>
          <h2 className="text-sm text-gray-500">
            {' '}
            UserGroups are a way to group users together to manage their access
            to the resources (Courses) in your organization.{' '}
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full table-auto overflow-hidden rounded-md text-left whitespace-nowrap">
            <thead className="rounded-xl bg-gray-100 text-gray-500 uppercase">
              <tr className="font-bolder text-sm">
                <th className="px-4 py-3">UserGroup</th>
                <th className="px-4 py-3">Description</th>
                <th className="px-4 py-3">Manage Users</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <>
              <tbody className="mt-5 rounded-md bg-white">
                {usergroups?.map((usergroup: any) => (
                  <tr
                    key={usergroup.id}
                    className="border-b border-gray-100 text-sm"
                  >
                    <td className="px-4 py-3">{usergroup.name}</td>
                    <td className="px-4 py-3">{usergroup.description}</td>
                    <td className="px-4 py-3">
                      <Modal
                        isDialogOpen={
                          userGroupManagementModal &&
                          selectedUserGroup === usergroup.id
                        }
                        onOpenChange={() =>
                          handleUserGroupManagementModal(usergroup.id)
                        }
                        minHeight="lg"
                        minWidth="lg"
                        dialogContent={
                          <ManageUsers usergroup_id={usergroup.id} />
                        }
                        dialogTitle="Manage UserGroup Users"
                        dialogDescription={'Manage the users in this UserGroup'}
                        dialogTrigger={
                          <button className="flex items-center space-x-2 rounded-md bg-yellow-700 p-1 px-3 text-sm font-bold text-yellow-100 hover:cursor-pointer">
                            <Users className="h-4 w-4" />
                            <span> Manage Users</span>
                          </button>
                        }
                      />
                    </td>
                    <td className="flex space-x-2 px-4 py-3">
                      <Modal
                        isDialogOpen={editUserGroupModal}
                        dialogTrigger={
                          <button className="flex items-center space-x-2 rounded-md bg-sky-700 p-1 px-3 text-sm font-bold text-sky-100 hover:cursor-pointer">
                            <Pencil className="size-4" />
                            <span>Edit</span>
                          </button>
                        }
                        minHeight="sm"
                        minWidth="sm"
                        onOpenChange={() => {
                          setEditUserGroupModal(!editUserGroupModal)
                        }}
                        dialogContent={<EditUserGroup usergroup={usergroup} />}
                      />
                      <ConfirmationModal
                        confirmationButtonText="Delete UserGroup"
                        confirmationMessage="Access to all resources will be removed for all users in this UserGroup. Are you sure you want to delete this UserGroup ?"
                        dialogTitle={'Delete UserGroup ?'}
                        dialogTrigger={
                          <button className="flex items-center space-x-2 rounded-md bg-rose-700 p-1 px-3 text-sm font-bold text-rose-100 hover:cursor-pointer">
                            <X className="h-4 w-4" />
                            <span>Delete</span>
                          </button>
                        }
                        functionToExecute={() => {
                          deleteUserGroupUI(usergroup.id)
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
        <div className="mt-3 mr-2 flex justify-end">
          <Modal
            isDialogOpen={createUserGroupModal}
            onOpenChange={() => setCreateUserGroupModal(!createUserGroupModal)}
            minHeight="no-min"
            dialogContent={
              <AddUserGroup setCreateUserGroupModal={setCreateUserGroupModal} />
            }
            dialogTitle="Create a UserGroup"
            dialogDescription={'Create a new UserGroup to manage users'}
            dialogTrigger={
              <button className="flex items-center space-x-2 rounded-md bg-green-700 p-1 px-3 text-sm font-bold text-green-100 hover:cursor-pointer">
                <SquareUserRound className="h-4 w-4" />
                <span>Create a UserGroup</span>
              </button>
            }
          />
        </div>
      </div>
    </>
  )
}

export default OrgUserGroups
