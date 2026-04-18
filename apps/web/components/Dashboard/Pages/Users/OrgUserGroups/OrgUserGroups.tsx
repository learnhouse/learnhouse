'use client'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrg } from '@components/Contexts/OrgContext'
import AddUserGroup from '@components/Objects/Modals/Dash/OrgUserGroups/AddUserGroup'
import EditUserGroup from '@components/Objects/Modals/Dash/OrgUserGroups/EditUserGroup'
import ManageUsers from '@components/Objects/Modals/Dash/OrgUserGroups/ManageUsers'
import LearnHouseSpinner from '@components/Objects/Loaders/LearnHouseSpinner'
import ConfirmationModal from '@components/Objects/StyledElements/ConfirmationModal/ConfirmationModal'
import Modal from '@components/Objects/StyledElements/Modal/Modal'
import PlanRestrictedFeature from '@components/Dashboard/Shared/PlanRestricted/PlanRestrictedFeature'
import { getAPIUrl } from '@services/config/config'
import { deleteUserGroup } from '@services/usergroups/usergroups'
import { swrFetcher } from '@services/utils/ts/requests'
import { PlanLevel } from '@services/plans/plans'
import { Pencil, SquareUserRound, Users, X, Search, Calendar } from 'lucide-react'
import React, { useState, useMemo } from 'react'
import toast from 'react-hot-toast'
import useSWR, { mutate } from 'swr'
import { useTranslation } from 'react-i18next'
import { Badge } from '@components/ui/badge'
import { usePlan } from '@components/Hooks/usePlan'

function OrgUserGroups() {
    const { t } = useTranslation()
    const org = useOrg() as any
    const session = useLHSession() as any
    const access_token = session?.data?.tokens?.access_token;
    const currentPlan = usePlan()
    const [userGroupManagementModal, setUserGroupManagementModal] = React.useState(false)
    const [createUserGroupModal, setCreateUserGroupModal] = React.useState(false)
    const [editUserGroupModal, setEditUserGroupModal] = React.useState(false)
    const [selectedUserGroup, setSelectedUserGroup] = React.useState(null) as any
    const [searchValue, setSearchValue] = useState('')

    const { data: usergroups, isValidating: isUsergroupsValidating } = useSWR(
        org && access_token ? `${getAPIUrl()}usergroups/org/${org.id}?org_id=${org.id}` : null,
        (url) => swrFetcher(url, access_token),
        { revalidateOnFocus: false }
    )
    const isInitialLoading = !usergroups && isUsergroupsValidating

    // Filter usergroups based on search
    const filteredUsergroups = useMemo(() => {
        if (!usergroups) return []
        if (!searchValue.trim()) return usergroups
        const search = searchValue.toLowerCase()
        return usergroups.filter((group: any) =>
            group.name?.toLowerCase().includes(search) ||
            group.description?.toLowerCase().includes(search)
        )
    }, [usergroups, searchValue])

    const deleteUserGroupUI = async (usergroup_id: any) => {
        const toastId = toast.loading(t('dashboard.users.usergroups.toasts.deleting'));
        const res = await deleteUserGroup(usergroup_id, org.id, access_token)
        if (res.status == 200) {
            mutate(`${getAPIUrl()}usergroups/org/${org.id}?org_id=${org.id}`)
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
        <PlanRestrictedFeature
            currentPlan={currentPlan}
            requiredPlan="standard"
            icon={SquareUserRound}
            titleKey="common.plans.feature_restricted.usergroups.title"
            descriptionKey="common.plans.feature_restricted.usergroups.description"
        >
            <div className="ms-10 me-10 mx-auto bg-white rounded-xl shadow-xs">
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100">
                    <div className="flex-1">
                        <h1 className="font-bold text-xl text-gray-800">{t('dashboard.users.usergroups.title')}</h1>
                        <p className="text-sm text-gray-500 mt-0.5">
                            {t('dashboard.users.usergroups.subtitle')}
                        </p>
                    </div>
                    <div className="flex items-center gap-3">
                        {usergroups && usergroups.length > 0 && (
                            <div className="text-sm text-gray-500 bg-gray-50 px-3 py-1.5 rounded-lg font-medium">
                                {usergroups.length} {usergroups.length === 1
                                    ? t('dashboard.users.usergroups.count.singular')
                                    : t('dashboard.users.usergroups.count.plural')}
                            </div>
                        )}
                        <div className="relative">
                            <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                            <input
                                placeholder={t('dashboard.users.usergroups.search_placeholder')}
                                className="ps-10 pe-4 py-2 w-[260px] border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 transition-all"
                                value={searchValue}
                                onChange={(e) => setSearchValue(e.target.value)}
                            />
                        </div>
                        <Modal
                            isDialogOpen={createUserGroupModal}
                            onOpenChange={() => setCreateUserGroupModal(!createUserGroupModal)}
                            minHeight="no-min"
                            dialogContent={
                                <AddUserGroup
                                    setCreateUserGroupModal={setCreateUserGroupModal}
                                />
                            }
                            dialogTitle={t('dashboard.users.usergroups.modals.create.title')}
                            dialogDescription={t('dashboard.users.usergroups.modals.create.description')}
                            dialogTrigger={
                                <button className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 transition-colors">
                                    <SquareUserRound className="w-4 h-4" />
                                    <span>{t('dashboard.users.usergroups.actions.create')}</span>
                                </button>
                            }
                        />
                    </div>
                </div>

                {/* Content */}
                <div className="px-3 py-2">
                    {/* UserGroups List */}
                    <div className="space-y-1">
                        {isInitialLoading ? (
                            <div className="py-20 flex justify-center">
                                <LearnHouseSpinner size={36} />
                            </div>
                        ) : filteredUsergroups.length === 0 ? (
                            <div className="py-16 text-center">
                                <div className="flex flex-col items-center gap-3">
                                    <div className="bg-gray-100 p-4 rounded-full">
                                        <SquareUserRound className="w-8 h-8 text-gray-400" />
                                    </div>
                                    <p className="text-gray-400 text-sm font-medium">
                                        {searchValue
                                            ? t('dashboard.users.usergroups.no_results')
                                            : t('dashboard.users.usergroups.no_groups')
                                        }
                                    </p>
                                </div>
                            </div>
                        ) : (
                            filteredUsergroups.map((usergroup: any) => (
                                <div
                                    key={usergroup.id}
                                    className="group flex items-center justify-between p-4 hover:bg-gray-50 rounded-lg transition-all duration-200"
                                >
                                    {/* Group Info */}
                                    <div className="flex items-center gap-4 flex-1 min-w-0">
                                        <div className="bg-indigo-50 p-2.5 rounded-lg">
                                            <SquareUserRound className="w-5 h-5 text-indigo-600" />
                                        </div>
                                        <div className="flex flex-col min-w-0 flex-1">
                                            <div className="flex items-center gap-2">
                                                <span className="font-semibold text-gray-800 text-sm truncate">
                                                    {usergroup.name}
                                                </span>
                                                <MemberCountBadge usergroup_id={usergroup.id} org_id={org.id} access_token={access_token} />
                                            </div>
                                            <div className="flex items-center gap-2">
                                                {usergroup.description && (
                                                    <span className="text-xs text-gray-400 truncate">
                                                        {usergroup.description}
                                                    </span>
                                                )}
                                                {usergroup.creation_date && (
                                                    <span className="inline-flex items-center gap-1 text-xs text-gray-400">
                                                        <Calendar className="w-3 h-3" />
                                                        {(() => {
                                                            try {
                                                                const d = new Date(usergroup.creation_date)
                                                                if (isNaN(d.getTime())) return usergroup.creation_date
                                                                return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                                                            } catch { return usergroup.creation_date }
                                                        })()}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    </div>

                                    {/* Actions */}
                                    <div className="flex items-center gap-2 ms-4">
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
                                                <button className="flex items-center gap-1.5 h-8 px-3 bg-amber-50 text-amber-700 hover:bg-amber-100 rounded-md text-xs font-semibold transition-all">
                                                    <Users className="w-3.5 h-3.5" />
                                                    <span>{t('dashboard.users.usergroups.actions.manage_users')}</span>
                                                </button>
                                            }
                                        />
                                        <Modal
                                            isDialogOpen={editUserGroupModal && selectedUserGroup === usergroup.id}
                                            dialogTrigger={
                                                <button
                                                    onClick={() => setSelectedUserGroup(usergroup.id)}
                                                    className="flex items-center gap-1.5 h-8 px-3 bg-sky-50 text-sky-700 hover:bg-sky-100 rounded-md text-xs font-semibold transition-all"
                                                >
                                                    <Pencil className="w-3.5 h-3.5" />
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
                                                <button className="flex items-center gap-1.5 h-8 px-3 bg-rose-50 text-rose-700 hover:bg-rose-100 rounded-md text-xs font-semibold transition-all">
                                                    <X className="w-3.5 h-3.5" />
                                                    <span>{t('dashboard.users.usergroups.actions.delete')}</span>
                                                </button>
                                            }
                                            functionToExecute={() => {
                                                deleteUserGroupUI(usergroup.id)
                                            }}
                                            status="warning"
                                        ></ConfirmationModal>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </div>
        </PlanRestrictedFeature>
    )
}

// Component to fetch and display member count for a usergroup
function MemberCountBadge({ usergroup_id, org_id, access_token }: { usergroup_id: number, org_id: number, access_token: string }) {
    const { t } = useTranslation()
    const { data: users } = useSWR(
        access_token ? `${getAPIUrl()}usergroups/${usergroup_id}/users?org_id=${org_id}` : null,
        (url) => swrFetcher(url, access_token),
        { revalidateOnFocus: false }
    )

    const count = users?.length || 0

    return (
        <Badge variant="secondary" className="bg-gray-100 text-gray-600 text-xs">
            <Users className="w-3 h-3 me-1" />
            {count} {count === 1
                ? t('dashboard.users.usergroups.member_count.singular')
                : t('dashboard.users.usergroups.member_count.plural')}
        </Badge>
    )
}

export default OrgUserGroups
