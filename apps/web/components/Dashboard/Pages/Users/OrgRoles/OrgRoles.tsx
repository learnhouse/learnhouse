'use client'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrg } from '@components/Contexts/OrgContext'
import AddRole from '@components/Objects/Modals/Dash/OrgRoles/AddRole'
import EditRole from '@components/Objects/Modals/Dash/OrgRoles/EditRole'
import ConfirmationModal from '@components/Objects/StyledElements/ConfirmationModal/ConfirmationModal'
import Modal from '@components/Objects/StyledElements/Modal/Modal'
import { getAPIUrl } from '@services/config/config'
import { deleteRole } from '@services/roles/roles'
import { swrFetcher } from '@services/utils/ts/requests'
import { Pencil, Shield, Users, X, Globe } from 'lucide-react'
import React from 'react'
import toast from 'react-hot-toast'
import useSWR, { mutate } from 'swr'

function OrgRoles() {
    const org = useOrg() as any
    const session = useLHSession() as any
    const access_token = session?.data?.tokens?.access_token;
    const [createRoleModal, setCreateRoleModal] = React.useState(false)
    const [editRoleModal, setEditRoleModal] = React.useState(false)
    const [selectedRole, setSelectedRole] = React.useState(null) as any

    const { data: roles } = useSWR(
        org ? `${getAPIUrl()}roles/org/${org.id}` : null,
        (url) => swrFetcher(url, access_token)
    )

    const deleteRoleUI = async (role_id: any) => {
        const toastId = toast.loading("Deleting...");
        const res = await deleteRole(role_id, org.id, access_token)
        if (res.status === 200) {
            mutate(`${getAPIUrl()}roles/org/${org.id}`)
            toast.success("Deleted role", {id:toastId})
        }
        else {
            toast.error('Error deleting role', {id:toastId})
        }
    }

    const handleEditRoleModal = (role: any) => {
        setSelectedRole(role)
        setEditRoleModal(!editRoleModal)
    }

    const getRightsSummary = (rights: any) => {
        if (!rights) return 'No permissions'
        
        const totalPermissions = Object.keys(rights).reduce((acc, key) => {
            if (typeof rights[key] === 'object') {
                return acc + Object.keys(rights[key]).filter(k => rights[key][k] === true).length
            }
            return acc
        }, 0)
        
        return `${totalPermissions} permissions`
    }

    // Check if a role is system-wide (TYPE_GLOBAL or role_uuid starts with role_global_)
    const isSystemRole = (role: any) => {
        // Check for role_type field first
        if (role.role_type === 'TYPE_GLOBAL') {
            return true
        }
        
        // Check for role_uuid starting with role_global_
        if (role.role_uuid && role.role_uuid.startsWith('role_global_')) {
            return true
        }
        
        // Check for common system role IDs (1-4 are typically system roles)
        if (role.id && [1, 2, 3, 4].includes(role.id)) {
            return true
        }
        
        // Check if the role name indicates it's a system role
        if (role.name && ['Admin', 'Maintainer', 'Instructor', 'User'].includes(role.name)) {
            return true
        }
        
        return false
    }

    return (
        <>
            <div className="h-6"></div>
            <div className="mx-4 sm:mx-6 lg:mx-10 bg-white rounded-xl nice-shadow px-3 sm:px-4 py-4">
                <div className="flex flex-col bg-gray-50 -space-y-1 px-3 sm:px-5 py-3 rounded-md mb-3">
                    <h1 className="font-bold text-lg sm:text-xl text-gray-800">Manage Roles & Permissions</h1>
                    <h2 className="text-gray-500 text-xs sm:text-sm">
                        {' '}
                        Roles define what users can do within your organization. Create custom roles with specific permissions for different user types.{' '}
                    </h2>
                </div>
                
                {/* Mobile view - Cards */}
                <div className="block sm:hidden space-y-3">
                    {roles?.map((role: any) => {
                        const isSystem = isSystemRole(role)
                        return (
                            <div key={role.id} className="bg-white border border-gray-200 rounded-lg p-4 space-y-3 shadow-sm">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center space-x-2">
                                        <Shield className="w-4 h-4 text-gray-400" />
                                        <span className="font-medium text-sm">{role.name}</span>
                                        {isSystem && (
                                            <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-purple-100 text-purple-800">
                                                <Globe className="w-3 h-3 mr-1" />
                                                System-wide
                                            </span>
                                        )}
                                    </div>
                                    <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                                        {getRightsSummary(role.rights)}
                                    </span>
                                </div>
                                <p className="text-gray-600 text-sm">{role.description || 'No description'}</p>
                                <div className="flex space-x-2">
                                    {!isSystem ? (
                                        <>
                                            <Modal
                                                isDialogOpen={
                                                    editRoleModal &&
                                                    selectedRole?.id === role.id
                                                }
                                                onOpenChange={() =>
                                                    handleEditRoleModal(role)
                                                }
                                                minHeight="lg"
                                                minWidth='xl'
                                                customWidth="max-w-7xl"
                                                dialogContent={
                                                    <EditRole
                                                        role={role}
                                                        setEditRoleModal={setEditRoleModal}
                                                    />
                                                }
                                                dialogTitle="Edit Role"
                                                dialogDescription={
                                                    'Edit the role permissions and details'
                                                }
                                                dialogTrigger={
                                                    <button className="flex-1 flex justify-center space-x-2 hover:cursor-pointer p-2 bg-black rounded-md font-bold items-center text-sm text-white hover:bg-gray-800 transition-colors shadow-sm">
                                                        <Pencil className="w-4 h-4" />
                                                        <span>Edit</span>
                                                    </button>
                                                }
                                            />
                                            <ConfirmationModal
                                                confirmationButtonText="Delete Role"
                                                confirmationMessage="This action cannot be undone. All users with this role will lose their permissions. Are you sure you want to delete this role?"
                                                dialogTitle={'Delete Role ?'}
                                                dialogTrigger={
                                                    <button className="flex-1 flex justify-center space-x-2 hover:cursor-pointer p-2 bg-red-600 rounded-md font-bold items-center text-sm text-white hover:bg-red-700 transition-colors shadow-sm">
                                                        <X className="w-4 h-4" />
                                                        <span>Delete</span>
                                                    </button>
                                                }
                                                functionToExecute={() => {
                                                    deleteRoleUI(role.id)
                                                }}
                                                status="warning"
                                            />
                                        </>
                                    ) : null}
                                </div>
                            </div>
                        )
                    })}
                </div>

                {/* Desktop view - Table */}
                <div className="hidden sm:block overflow-x-auto">
                    <table className="table-auto w-full text-left whitespace-nowrap rounded-md overflow-hidden">
                        <thead className="bg-gray-100 text-gray-500 rounded-xl uppercase">
                            <tr className="font-bolder text-sm">
                                <th className="py-3 px-4">Role Name</th>
                                <th className="py-3 px-4">Description</th>
                                <th className="py-3 px-4">Permissions</th>
                                <th className="py-3 px-4">Actions</th>
                            </tr>
                        </thead>
                        <>
                            <tbody className="mt-5 bg-white rounded-md">
                                {roles?.map((role: any) => {
                                    const isSystem = isSystemRole(role)
                                    return (
                                        <tr key={role.id} className="border-b border-gray-100 text-sm hover:bg-gray-50 transition-colors">
                                            <td className="py-3 px-4">
                                                <div className="flex items-center space-x-2">
                                                    <Shield className="w-4 h-4 text-gray-400" />
                                                    <span className="font-medium">{role.name}</span>
                                                    {isSystem && (
                                                        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-purple-100 text-purple-800">
                                                            <Globe className="w-3 h-3 mr-1" />
                                                            System-wide
                                                        </span>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="py-3 px-4 text-gray-600">{role.description || 'No description'}</td>
                                            <td className="py-3 px-4">
                                                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                                                    {getRightsSummary(role.rights)}
                                                </span>
                                            </td>
                                            <td className="py-3 px-4">
                                                <div className="flex space-x-2">
                                                    {!isSystem ? (
                                                        <>
                                                            <Modal
                                                                isDialogOpen={
                                                                    editRoleModal &&
                                                                    selectedRole?.id === role.id
                                                                }
                                                                onOpenChange={() =>
                                                                    handleEditRoleModal(role)
                                                                }
                                                                minHeight="lg"
                                                                minWidth='xl'
                                                                customWidth="max-w-7xl"
                                                                dialogContent={
                                                                    <EditRole
                                                                        role={role}
                                                                        setEditRoleModal={setEditRoleModal}
                                                                    />
                                                                }
                                                                dialogTitle="Edit Role"
                                                                dialogDescription={
                                                                    'Edit the role permissions and details'
                                                                }
                                                                dialogTrigger={
                                                                    <button className="flex space-x-2 hover:cursor-pointer p-1 px-3 bg-black rounded-md font-bold items-center text-sm text-white hover:bg-gray-800 transition-colors shadow-sm">
                                                                        <Pencil className="w-4 h-4" />
                                                                        <span>Edit</span>
                                                                    </button>
                                                                }
                                                            />
                                                            <ConfirmationModal
                                                                confirmationButtonText="Delete Role"
                                                                confirmationMessage="This action cannot be undone. All users with this role will lose their permissions. Are you sure you want to delete this role?"
                                                                dialogTitle={'Delete Role ?'}
                                                                dialogTrigger={
                                                                    <button className="flex space-x-2 hover:cursor-pointer p-1 px-3 bg-red-600 rounded-md font-bold items-center text-sm text-white hover:bg-red-700 transition-colors shadow-sm">
                                                                        <X className="w-4 h-4" />
                                                                        <span>Delete</span>
                                                                    </button>
                                                                }
                                                                functionToExecute={() => {
                                                                    deleteRoleUI(role.id)
                                                                }}
                                                                status="warning"
                                                            />
                                                        </>
                                                    ) : null}
                                                </div>
                                            </td>
                                        </tr>
                                    )
                                })}
                            </tbody>
                        </>
                    </table>
                </div>
                
                <div className='flex justify-end mt-3 mr-2'>
                    <Modal
                        isDialogOpen={createRoleModal}
                        onOpenChange={() => setCreateRoleModal(!createRoleModal)}
                        minHeight="no-min"
                        minWidth='xl'
                        customWidth="max-w-7xl"
                        dialogContent={
                            <AddRole
                                setCreateRoleModal={setCreateRoleModal}
                            />
                        }
                        dialogTitle="Create a Role"
                        dialogDescription={
                            'Create a new role with specific permissions'
                        }
                        dialogTrigger={
                            <button className="flex space-x-2 hover:cursor-pointer p-2 sm:p-1 sm:px-3 bg-black rounded-md font-bold items-center text-sm text-white w-full sm:w-auto justify-center hover:bg-gray-800 transition-colors shadow-sm">
                                <Shield className="w-4 h-4" />
                                <span>Create a Role</span>
                            </button>
                        }
                    />
                </div>
            </div>
        </>
    )
}

export default OrgRoles 