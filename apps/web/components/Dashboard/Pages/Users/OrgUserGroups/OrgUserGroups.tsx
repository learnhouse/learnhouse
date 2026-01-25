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
import { useTranslation } from 'react-i18next'

function OrgUserGroups() {
    const { t } = useTranslation()
    const org = useOrg() as any
    const session = useLHSession() as any
    const access_token = session?.data?.tokens?.access_token;
    const [userGroupManagementModal, setUserGroupManagementModal] = React.useState(false)
    const [createUserGroupModal, setCreateUserGroupModal] = React.useState(false)
    const [editUserGroupModal, setEditUserGroupModal] = React.useState(false)
    const [selectedUserGroup, setSelectedUserGroup] = React.useState(null) as any

    const { data: usergroups } = useSWR(
        org ? `${getAPIUrl()}usergroups/org/${org.id}` : null,
        (url) => swrFetcher(url, access_token)
    )

    const deleteUserGroupUI = async (usergroup_id: any) => {
        const toastId = toast.loading(t('dashboard.users.usergroups.toasts.deleting'));
        const res = await deleteUserGroup(usergroup_id, access_token)
        if (res.status == 200) {
            mutate(`${getAPIUrl()}usergroups/org/${org.id}`)
            toast.success(t('dashboard.users.usergroups.toasts.delete_success'), {id:toastId})
        }
        else {
            toast.error(t('dashboard.users.usergroups.toasts.delete_error'), {id:toastId})
        }

    }

    const handleUserGroupManagementModal = (usergroup_id: any) => {
        setSelectedUserGroup(usergroup_id)
        setUserGroupManagementModal(!userGroupManagementModal)
    }

    return (
        <>
            <div className="h-6"></div>
            <div className="ml-10 mr-10 mx-auto bg-white rounded-xl shadow-xs px-4 py-4">
                <div className="flex flex-col bg-gray-50 -space-y-1  px-5 py-3 rounded-md mb-3 ">
                    <h1 className="font-bold text-xl text-gray-800">{t('dashboard.users.usergroups.title')}</h1>
                    <h2 className="text-gray-500 text-sm">
                        {' '}
                        {t('dashboard.users.usergroups.subtitle')}{' '}
                    </h2>
                </div>
                <div className="overflow-x-auto">
                    <table className="table-auto w-full text-left whitespace-nowrap rounded-md overflow-hidden">
                        <thead className="bg-gray-100 text-gray-500 rounded-xl uppercase">
                            <tr className="font-bolder text-sm">
                                <th className="py-3 px-4">{t('dashboard.users.usergroups.table.usergroup')}</th>
                                <th className="py-3 px-4">{t('dashboard.users.usergroups.table.description')}</th>
                                <th className="py-3 px-4">{t('dashboard.users.usergroups.table.manage_users')}</th>
                                <th className="py-3 px-4">{t('dashboard.users.usergroups.table.actions')}</th>
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
                                                dialogTitle={t('dashboard.users.usergroups.modals.manage_users.title')}
                                                dialogDescription={t('dashboard.users.usergroups.modals.manage_users.description')}
                                                dialogTrigger={
                                                    <button className="flex space-x-2 hover:cursor-pointer p-1 px-3 bg-yellow-700 rounded-md font-bold items-center text-sm text-yellow-100">
                                                        <Users className="w-4 h-4" />
                                                        <span> {t('dashboard.users.usergroups.actions.manage_users')}</span>
                                                    </button>
                                                }
                                            />
                                        </td>
                                        <td className="py-3 px-4 flex space-x-2">
                                            <Modal
                                            isDialogOpen={editUserGroupModal}
                                            dialogTrigger={
                                                <button className="flex space-x-2 hover:cursor-pointer p-1 px-3 bg-sky-700 rounded-md font-bold items-center text-sm text-sky-100">
                                                    <Pencil className="size-4" />
                                                    <span>{t('dashboard.users.usergroups.actions.edit')}</span>
                                                </button>
                                            }
                                            minHeight='sm'
                                            minWidth='sm'
                                            onOpenChange={() => {
                                                setEditUserGroupModal(!editUserGroupModal)
                                            }}
                                            dialogContent={
                                                <EditUserGroup usergroup={usergroup} />
                                            }
                                            />
                                            <ConfirmationModal
                                                confirmationButtonText={t('dashboard.users.usergroups.modals.delete.button')}
                                                confirmationMessage={t('dashboard.users.usergroups.modals.delete.message')}
                                                dialogTitle={t('dashboard.users.usergroups.modals.delete.title')}
                                                dialogTrigger={
                                                    <button className="flex space-x-2 hover:cursor-pointer p-1 px-3 bg-rose-700 rounded-md font-bold items-center text-sm text-rose-100">
                                                        <X className="w-4 h-4" />
                                                        <span>{t('dashboard.users.usergroups.actions.delete')}</span>
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
                        dialogTitle={t('dashboard.users.usergroups.modals.create.title')}
                        dialogDescription={t('dashboard.users.usergroups.modals.create.description')}
                        dialogTrigger={
                            <button
                                className=" flex space-x-2 hover:cursor-pointer p-1 px-3 bg-green-700 rounded-md font-bold items-center text-sm text-green-100"
                            >
                                <SquareUserRound className="w-4 h-4" />
                                <span>{t('dashboard.users.usergroups.actions.create')}</span>
                            </button>
                        }
                    />
                </div>

            </div>



        </>
    )
}

export default OrgUserGroups