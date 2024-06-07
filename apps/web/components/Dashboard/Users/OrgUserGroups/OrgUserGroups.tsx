'use client'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrg } from '@components/Contexts/OrgContext'
import AddUserGroup from '@components/Objects/Modals/Dash/OrgUserGroups/AddUserGroup'
import ManageUsers from '@components/Objects/Modals/Dash/OrgUserGroups/ManageUsers'
import ConfirmationModal from '@components/StyledElements/ConfirmationModal/ConfirmationModal'
import Modal from '@components/StyledElements/Modal/Modal'
import { getAPIUrl } from '@services/config/config'
import { deleteUserGroup } from '@services/usergroups/usergroups'
import { swrFetcher } from '@services/utils/ts/requests'
import { SquareUserRound, Users, X } from 'lucide-react'
import React from 'react'
import toast from 'react-hot-toast'
import useSWR, { mutate } from 'swr'

function OrgUserGroups() {
    const org = useOrg() as any
    const session = useLHSession() as any
    const access_token = session.data.tokens.access_token;
    const [userGroupManagementModal, setUserGroupManagementModal] = React.useState(false)
    const [createUserGroupModal, setCreateUserGroupModal] = React.useState(false)
    const [selectedUserGroup, setSelectedUserGroup] = React.useState(null) as any

    const { data: usergroups } = useSWR(
        org ? `${getAPIUrl()}usergroups/org/${org.id}` : null,
        (url) => swrFetcher(url, access_token)
    )

    const deleteUserGroupUI = async (usergroup_id: any) => {
        const res = await deleteUserGroup(usergroup_id, access_token)
        if (res.status == 200) {
            mutate(`${getAPIUrl()}usergroups/org/${org.id}`)
        }
        else {
            toast.error('Error ' + res.status + ': ' + res.data.detail)
        }

    }

    const handleUserGroupManagementModal = (usergroup_id: any) => {
        setSelectedUserGroup(usergroup_id)
        setUserGroupManagementModal(!userGroupManagementModal)
    }

    return (
        <>
            <div className="h-6"></div>
            <div className="ml-10 mr-10 mx-auto bg-white rounded-xl shadow-sm px-4 py-4">
                <div className="flex flex-col bg-gray-50 -space-y-1  px-5 py-3 rounded-md mb-3 ">
                    <h1 className="font-bold text-xl text-gray-800">Manage UserGroups & Users</h1>
                    <h2 className="text-gray-500 text-sm">
                        {' '}
                        UserGroups are a way to group users together to manage their access to the resources (Courses) in your organization.{' '}
                    </h2>
                </div>
                <table className="table-auto w-full text-left whitespace-nowrap rounded-md overflow-hidden">
                    <thead className="bg-gray-100 text-gray-500 rounded-xl uppercase">
                        <tr className="font-bolder text-sm">
                            <th className="py-3 px-4">UserGroup</th>
                            <th className="py-3 px-4">Description</th>
                            <th className="py-3 px-4">Manage Users</th>
                            <th className="py-3 px-4">Actions</th>
                        </tr>
                    </thead>
                    <>
                        <tbody className="mt-5 bg-white rounded-md">
                            {usergroups?.map((usergroup: any) => (
                                <tr key={usergroup.id} className="border-b border-gray-100 text-sm">
                                    <td className="py-3 px-4">{usergroup.name}</td>
                                    <td className="py-3 px-4 ">{usergroup.description}</td>
                                    <td className="py-3 px-4 ">
                                        <Modal
                                            isDialogOpen={
                                                userGroupManagementModal &&
                                                selectedUserGroup === usergroup.id
                                            }
                                            onOpenChange={() =>
                                                handleUserGroupManagementModal(usergroup.id)
                                            }
                                            minHeight="lg"
                                            minWidth='lg'
                                            dialogContent={
                                                <ManageUsers
                                                    usergroup_id={usergroup.id}
                                                />
                                            }
                                            dialogTitle="Manage UserGroup Users"
                                            dialogDescription={
                                                'Manage the users in this UserGroup'
                                            }
                                            dialogTrigger={
                                                <button className="flex space-x-2 hover:cursor-pointer p-1 px-3 bg-yellow-700 rounded-md font-bold items-center text-sm text-yellow-100">
                                                    <Users className="w-4 h-4" />
                                                    <span> Manage Users</span>
                                                </button>
                                            }
                                        />
                                    </td>
                                    <td className="py-3 px-4 ">

                                        <ConfirmationModal
                                            confirmationButtonText="Delete UserGroup"
                                            confirmationMessage="Access to all resources will be removed for all users in this UserGroup. Are you sure you want to delete this UserGroup ?"
                                            dialogTitle={'Delete UserGroup ?'}
                                            dialogTrigger={
                                                <button className="flex space-x-2 hover:cursor-pointer p-1 px-3 bg-rose-700 rounded-md font-bold items-center text-sm text-rose-100">
                                                    <X className="w-4 h-4" />
                                                    <span> Delete</span>
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
                <div className='flex justify-end mt-3 mr-2'>
                    <Modal
                        isDialogOpen={
                            createUserGroupModal
                        }
                        onOpenChange={() =>
                            setCreateUserGroupModal(!createUserGroupModal)
                        }
                        minHeight="no-min"
                        dialogContent={
                            <AddUserGroup
                                setCreateUserGroupModal={setCreateUserGroupModal}
                            />
                        }
                        dialogTitle="Create a UserGroup"
                        dialogDescription={
                            'Create a new UserGroup to manage users'
                        }
                        dialogTrigger={
                            <button
                                className=" flex space-x-2 hover:cursor-pointer p-1 px-3 bg-green-700 rounded-md font-bold items-center text-sm text-green-100"
                            >
                                <SquareUserRound className="w-4 h-4" />
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