'use client'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrg } from '@components/Contexts/OrgContext'
import AddRole from '@components/Objects/Modals/Dash/OrgRoles/AddRole'
import EditRole from '@components/Objects/Modals/Dash/OrgRoles/EditRole'
import ConfirmationModal from '@components/Objects/StyledElements/ConfirmationModal/ConfirmationModal'
import Modal from '@components/Objects/StyledElements/Modal/Modal'
import PlanBadge from '@components/Dashboard/Shared/PlanRestricted/PlanBadge'
import { getAPIUrl } from '@services/config/config'
import { deleteRole } from '@services/roles/roles'
import { swrFetcher } from '@services/utils/ts/requests'
import { PlanLevel } from '@services/plans/plans'
import { Pencil, Shield, X, Globe, Lock, Eye, Check, XCircle } from 'lucide-react'
import React from 'react'
import toast from 'react-hot-toast'
import useSWR, { mutate } from 'swr'
import { useTranslation } from 'react-i18next'
import { usePlan } from '@components/Hooks/usePlan'

function OrgRoles() {
    const { t } = useTranslation()
    const org = useOrg() as any
    const session = useLHSession() as any
    const access_token = session?.data?.tokens?.access_token;
    const currentPlan = usePlan()
    const rf = org?.config?.config?.resolved_features
    const canCreateRoles = rf?.roles?.enabled === true
    const [createRoleModal, setCreateRoleModal] = React.useState(false)
    const [editRoleModal, setEditRoleModal] = React.useState(false)
    const [viewRightsModal, setViewRightsModal] = React.useState(false)
    const [selectedRole, setSelectedRole] = React.useState(null) as any

    const { data: roles } = useSWR(
        org ? `${getAPIUrl()}roles/org/${org.id}` : null,
        (url) => swrFetcher(url, access_token),
        { revalidateOnFocus: false }
    )

    const deleteRoleUI = async (role_id: any) => {
        const toastId = toast.loading(t('dashboard.users.roles.toasts.deleting'));
        const res = await deleteRole(role_id, org.id, access_token)
        if (res.status === 200) {
            mutate(`${getAPIUrl()}roles/org/${org.id}`)
            toast.success(t('dashboard.users.roles.toasts.delete_success'), {id:toastId})
        }
        else {
            toast.error(t('dashboard.users.roles.toasts.delete_error'), {id:toastId})
        }
    }

    const handleEditRoleModal = (role: any) => {
        setSelectedRole(role)
        setEditRoleModal(!editRoleModal)
    }

    const handleViewRightsModal = (role: any) => {
        setSelectedRole(role)
        setViewRightsModal(!viewRightsModal)
    }

    const formatActionName = (action: string) => {
        return action
            .replace('action_', '')
            .split('_')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ')
    }

    const formatResourceName = (resource: string) => {
        const resourceNames: { [key: string]: string } = {
            courses: t('dashboard.users.roles.rights.resources.courses'),
            users: t('dashboard.users.roles.rights.resources.users'),
            usergroups: t('dashboard.users.roles.rights.resources.usergroups'),
            collections: t('dashboard.users.roles.rights.resources.collections'),
            organizations: t('dashboard.users.roles.rights.resources.organizations'),
            coursechapters: t('dashboard.users.roles.rights.resources.coursechapters'),
            activities: t('dashboard.users.roles.rights.resources.activities'),
            roles: t('dashboard.users.roles.rights.resources.roles'),
            dashboard: t('dashboard.users.roles.rights.resources.dashboard'),
        }
        return resourceNames[resource] || resource.charAt(0).toUpperCase() + resource.slice(1)
    }

    const RightsDetailView = ({ rights }: { rights: any }) => {
        if (!rights || Object.keys(rights).length === 0) {
            return (
                <div className="text-center py-8 text-gray-500">
                    {t('dashboard.users.roles.no_permissions')}
                </div>
            )
        }

        return (
            <div className="space-y-4 max-h-[60vh] overflow-y-auto">
                {Object.entries(rights).map(([resource, actions]: [string, any]) => (
                    <div key={resource} className="border border-gray-200 rounded-lg overflow-hidden">
                        <div className="bg-gray-50 px-4 py-2 font-medium text-gray-700 border-b border-gray-200">
                            {formatResourceName(resource)}
                        </div>
                        <div className="p-3">
                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                                {Object.entries(actions).map(([action, enabled]: [string, any]) => (
                                    <div
                                        key={action}
                                        className={`flex items-center space-x-2 px-3 py-2 rounded-md text-sm ${
                                            enabled
                                                ? 'bg-green-50 text-green-700'
                                                : 'bg-gray-50 text-gray-400'
                                        }`}
                                    >
                                        {enabled ? (
                                            <Check className="w-4 h-4 text-green-600" />
                                        ) : (
                                            <XCircle className="w-4 h-4 text-gray-300" />
                                        )}
                                        <span>{formatActionName(action)}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        )
    }

    const getRightsSummary = (rights: any) => {
        if (!rights) return t('dashboard.users.roles.no_permissions')
        
        const totalPermissions = Object.keys(rights).reduce((acc, key) => {
            if (typeof rights[key] === 'object') {
                return acc + Object.keys(rights[key]).filter(k => rights[key][k] === true).length
            }
            return acc
        }, 0)
        
        return t('dashboard.users.roles.permissions_count', { count: totalPermissions })
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
            <div className="mx-4 sm:mx-6 lg:mx-10 bg-white rounded-xl nice-shadow px-3 sm:px-4 py-4">
                <div className="flex flex-col bg-gray-50 -space-y-1 px-3 sm:px-5 py-3 rounded-md mb-3">
                    <h1 className="font-bold text-lg sm:text-xl text-gray-800">{t('dashboard.users.roles.title')}</h1>
                    <h2 className="text-gray-500 text-xs sm:text-sm">
                        {' '}
                        {t('dashboard.users.roles.subtitle')}{' '}
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
                                                <Globe className="w-3 h-3 me-1" />
                                                {t('dashboard.users.roles.system_wide')}
                                            </span>
                                        )}
                                    </div>
                                    <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                                        {getRightsSummary(role.rights)}
                                    </span>
                                </div>
                                <p className="text-gray-600 text-sm">{role.description || t('dashboard.users.roles.no_description')}</p>
                                <div className="flex space-x-2">
                                    <Modal
                                        isDialogOpen={
                                            viewRightsModal &&
                                            selectedRole?.id === role.id
                                        }
                                        onOpenChange={() =>
                                            handleViewRightsModal(role)
                                        }
                                        minHeight="md"
                                        minWidth='lg'
                                        dialogContent={
                                            <RightsDetailView rights={role.rights} />
                                        }
                                        dialogTitle={t('dashboard.users.roles.modals.view_rights.title', { roleName: role.name })}
                                        dialogDescription={t('dashboard.users.roles.modals.view_rights.description')}
                                        dialogTrigger={
                                            <button className="flex-1 flex justify-center space-x-2 hover:cursor-pointer p-2 bg-blue-600 rounded-md font-bold items-center text-sm text-white hover:bg-blue-700 transition-colors shadow-sm">
                                                <Eye className="w-4 h-4" />
                                                <span>{t('dashboard.users.roles.actions.view_rights')}</span>
                                            </button>
                                        }
                                    />
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
                                                dialogTitle={t('dashboard.users.roles.modals.edit.title')}
                                                dialogDescription={t('dashboard.users.roles.modals.edit.description')}
                                                dialogTrigger={
                                                    <button className="flex-1 flex justify-center space-x-2 hover:cursor-pointer p-2 bg-black rounded-md font-bold items-center text-sm text-white hover:bg-gray-800 transition-colors shadow-sm">
                                                        <Pencil className="w-4 h-4" />
                                                        <span>{t('dashboard.users.roles.actions.edit')}</span>
                                                    </button>
                                                }
                                            />
                                            <ConfirmationModal
                                                confirmationButtonText={t('dashboard.users.roles.modals.delete.button')}
                                                confirmationMessage={t('dashboard.users.roles.modals.delete.message')}
                                                dialogTitle={t('dashboard.users.roles.modals.delete.title')}
                                                dialogTrigger={
                                                    <button className="flex-1 flex justify-center space-x-2 hover:cursor-pointer p-2 bg-red-600 rounded-md font-bold items-center text-sm text-white hover:bg-red-700 transition-colors shadow-sm">
                                                        <X className="w-4 h-4" />
                                                        <span>{t('dashboard.users.roles.actions.delete')}</span>
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
                    <table className="table-auto w-full text-start whitespace-nowrap rounded-md overflow-hidden">
                        <thead className="bg-gray-100 text-gray-500 rounded-xl uppercase">
                            <tr className="font-bolder text-sm">
                                <th className="py-3 px-4">{t('dashboard.users.roles.table.role_name')}</th>
                                <th className="py-3 px-4">{t('dashboard.users.roles.table.description')}</th>
                                <th className="py-3 px-4">{t('dashboard.users.roles.table.permissions')}</th>
                                <th className="py-3 px-4">{t('dashboard.users.roles.table.actions')}</th>
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
                                                            <Globe className="w-3 h-3 me-1" />
                                                            {t('dashboard.users.roles.system_wide')}
                                                        </span>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="py-3 px-4 text-gray-600">{role.description || t('dashboard.users.roles.no_description')}</td>
                                            <td className="py-3 px-4">
                                                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                                                    {getRightsSummary(role.rights)}
                                                </span>
                                            </td>
                                            <td className="py-3 px-4">
                                                <div className="flex space-x-2">
                                                    <Modal
                                                        isDialogOpen={
                                                            viewRightsModal &&
                                                            selectedRole?.id === role.id
                                                        }
                                                        onOpenChange={() =>
                                                            handleViewRightsModal(role)
                                                        }
                                                        minHeight="md"
                                                        minWidth='lg'
                                                        dialogContent={
                                                            <RightsDetailView rights={role.rights} />
                                                        }
                                                        dialogTitle={t('dashboard.users.roles.modals.view_rights.title', { roleName: role.name })}
                                                        dialogDescription={t('dashboard.users.roles.modals.view_rights.description')}
                                                        dialogTrigger={
                                                            <button className="flex space-x-2 hover:cursor-pointer p-1 px-3 bg-blue-600 rounded-md font-bold items-center text-sm text-white hover:bg-blue-700 transition-colors shadow-sm">
                                                                <Eye className="w-4 h-4" />
                                                                <span>{t('dashboard.users.roles.actions.view_rights')}</span>
                                                            </button>
                                                        }
                                                    />
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
                                                                dialogTitle={t('dashboard.users.roles.modals.edit.title')}
                                                                dialogDescription={t('dashboard.users.roles.modals.edit.description')}
                                                                dialogTrigger={
                                                                    <button className="flex space-x-2 hover:cursor-pointer p-1 px-3 bg-black rounded-md font-bold items-center text-sm text-white hover:bg-gray-800 transition-colors shadow-sm">
                                                                        <Pencil className="w-4 h-4" />
                                                                        <span>{t('dashboard.users.roles.actions.edit')}</span>
                                                                    </button>
                                                                }
                                                            />
                                                            <ConfirmationModal
                                                                confirmationButtonText={t('dashboard.users.roles.modals.delete.button')}
                                                                confirmationMessage={t('dashboard.users.roles.modals.delete.message')}
                                                                dialogTitle={t('dashboard.users.roles.modals.delete.title')}
                                                                dialogTrigger={
                                                                    <button className="flex space-x-2 hover:cursor-pointer p-1 px-3 bg-red-600 rounded-md font-bold items-center text-sm text-white hover:bg-red-700 transition-colors shadow-sm">
                                                                        <X className="w-4 h-4" />
                                                                        <span>{t('dashboard.users.roles.actions.delete')}</span>
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
                
                <div className='flex justify-end mt-3 me-2'>
                    {canCreateRoles ? (
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
                            dialogTitle={t('dashboard.users.roles.modals.create.title')}
                            dialogDescription={t('dashboard.users.roles.modals.create.description')}
                            dialogTrigger={
                                <button className="flex space-x-2 hover:cursor-pointer p-2 sm:p-1 sm:px-3 bg-black rounded-md font-bold items-center text-sm text-white w-full sm:w-auto justify-center hover:bg-gray-800 transition-colors shadow-sm">
                                    <Shield className="w-4 h-4" />
                                    <span>{t('dashboard.users.roles.actions.create')}</span>
                                </button>
                            }
                        />
                    ) : (
                        <div className="flex items-center space-x-2">
                            <button
                                disabled
                                className="flex space-x-2 p-2 sm:p-1 sm:px-3 bg-gray-300 rounded-md font-bold items-center text-sm text-gray-500 w-full sm:w-auto justify-center cursor-not-allowed"
                            >
                                <Lock className="w-4 h-4" />
                                <span>{t('dashboard.users.roles.actions.create')}</span>
                            </button>
                            <PlanBadge currentPlan={currentPlan} requiredPlan={(rf?.roles?.required_plan || 'pro') as PlanLevel} />
                        </div>
                    )}
                </div>
            </div>
        </>
    )
}

export default OrgRoles 