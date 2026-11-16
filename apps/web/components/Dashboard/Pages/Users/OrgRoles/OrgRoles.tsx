'use client'
import React from 'react'
import toast from 'react-hot-toast'
import { useTranslation } from 'react-i18next'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { DotsThree, Eye, Globe, Lock, PencilSimple, Plus, Shield, ShieldCheck, Trash, UserGear } from '@phosphor-icons/react'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrg } from '@components/Contexts/OrgContext'
import AddRole from '@components/Objects/Modals/Dash/OrgRoles/AddRole'
import EditRole from '@components/Objects/Modals/Dash/OrgRoles/EditRole'
import RolePermissionsMatrix from '@components/Objects/Modals/Dash/OrgRoles/RolePermissionsMatrix'
import {
    TOTAL_PERMISSIONS,
    countEnabled,
    countFlags,
    isSystemRole,
    normalizeRights,
} from '@components/Objects/Modals/Dash/OrgRoles/roleRights'
import Modal from '@components/Objects/StyledElements/Modal/Modal'
import PlanBadge from '@components/Dashboard/Shared/PlanRestricted/PlanBadge'
import FeatureGate from '@components/Dashboard/Shared/FeatureGate/FeatureGate'
import {
    Button,
    Chip,
    ConfirmDialog,
    EmptyState,
    SectionCard,
    SegmentedControl,
} from '@components/Dashboard/Shared/DashKit/DashKit'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@components/ui/dropdown-menu'
import { getAPIUrl } from '@services/config/config'
import { deleteRole } from '@services/roles/roles'
import { apiFetch } from '@services/utils/ts/requests'
import { PlanLevel } from '@services/plans/plans'
import { queryKeys } from '@/lib/query/keys'
import { usePlan } from '@components/Hooks/usePlan'

type RoleFilter = 'all' | 'custom' | 'system'
const ITEM = 'flex items-center gap-2 cursor-pointer'

function RoleRowSkeleton() {
    return (
        <div className="flex items-center gap-3 px-5 py-4 animate-pulse">
            <div className="w-9 h-9 rounded-xl bg-neutral-100" />
            <div className="flex-1 space-y-2">
                <div className="h-3.5 w-40 rounded bg-neutral-100" />
                <div className="h-3 w-64 max-w-full rounded bg-neutral-100" />
            </div>
            <div className="hidden sm:block h-6 w-24 rounded-full bg-neutral-100" />
        </div>
    )
}

function OrgRoles() {
    const { t } = useTranslation()
    const org = useOrg() as any
    const session = useLHSession() as any
    const access_token = session?.data?.tokens?.access_token
    const queryClient = useQueryClient()
    const currentPlan = usePlan()
    const rf = org?.config?.config?.resolved_features
    const canCreateRoles = rf?.roles?.enabled === true

    const [filter, setFilter] = React.useState<RoleFilter>('all')
    const [createOpen, setCreateOpen] = React.useState(false)
    const [editing, setEditing] = React.useState<any>(null)
    const [viewing, setViewing] = React.useState<any>(null)
    const [deleting, setDeleting] = React.useState<any>(null)

    const rolesKey = queryKeys.org.roles(org?.id)
    const { data, isLoading } = useQuery({
        queryKey: rolesKey,
        queryFn: () => apiFetch(`${getAPIUrl()}roles/org/${org.id}`, access_token),
        enabled: !!org?.id && !!access_token,
        staleTime: 60_000,
    })
    const roles: any[] = React.useMemo(() => (Array.isArray(data) ? data : []), [data])

    const counts = React.useMemo(() => {
        const system = roles.filter(isSystemRole).length
        return { all: roles.length, system, custom: roles.length - system }
    }, [roles])

    const visible = roles.filter((role) => {
        if (filter === 'system') return isSystemRole(role)
        if (filter === 'custom') return !isSystemRole(role)
        return true
    })

    // Optimistic: the row goes away at once and comes back if the API refuses.
    const removeRole = async (role: any) => {
        const previous = queryClient.getQueryData(rolesKey)
        queryClient.setQueryData(rolesKey, (old: any) => (Array.isArray(old) ? old.filter((r: any) => r.id !== role.id) : old))
        const res = await deleteRole(role.id, org.id, access_token)
        if (res.status === 200) {
            toast.success(t('dashboard.users.roles.toasts.delete_success'))
            queryClient.invalidateQueries({ queryKey: rolesKey })
        } else {
            queryClient.setQueryData(rolesKey, previous)
            toast.error(t('dashboard.users.roles.toasts.delete_error'))
        }
    }

    const newRoleButton = canCreateRoles ? (
        <Button variant="primary" icon={<Plus size={14} weight="bold" />} onClick={() => setCreateOpen(true)}>
            {t('dashboard.users.roles.actions.create')}
        </Button>
    ) : (
        <span className="inline-flex items-center gap-2">
            <Button variant="secondary" icon={<Lock size={14} />} disabled>
                {t('dashboard.users.roles.actions.create')}
            </Button>
            <PlanBadge currentPlan={currentPlan} requiredPlan={(rf?.roles?.required_plan || 'pro') as PlanLevel} />
        </span>
    )

    return (
        <FeatureGate feature="roles">
            <div className="flex flex-col gap-5">
                <SectionCard
                    icon={<UserGear size={18} />}
                    title={t('dashboard.users.roles.title')}
                    description={t('dashboard.users.dash.roles.description')}
                    actions={newRoleButton}
                    bodyClassName="pt-4"
                >
                    {roles.length > 0 && (
                        <div className="px-5 pb-3 overflow-x-auto scrollbar-hide">
                            <SegmentedControl<RoleFilter>
                                value={filter}
                                onChange={setFilter}
                                ariaLabel={t('dashboard.users.dash.roles.filter_label')}
                                options={[
                                    { key: 'all', label: t('dashboard.users.dash.roles.filters.all'), count: counts.all },
                                    { key: 'custom', label: t('dashboard.users.dash.roles.filters.custom'), count: counts.custom },
                                    { key: 'system', label: t('dashboard.users.dash.roles.filters.system'), count: counts.system },
                                ]}
                            />
                        </div>
                    )}

                    <div className="border-t border-neutral-100 divide-y divide-neutral-100">
                        {isLoading ? (
                            [0, 1, 2, 3].map((i) => <RoleRowSkeleton key={i} />)
                        ) : visible.length === 0 ? (
                            <EmptyState
                                icon={<Shield size={22} />}
                                title={
                                    filter === 'custom'
                                        ? t('dashboard.users.dash.roles.empty_custom_title')
                                        : t('dashboard.users.dash.roles.empty_title')
                                }
                                description={t('dashboard.users.dash.roles.empty_description')}
                                action={canCreateRoles ? <div className="mt-1">{newRoleButton}</div> : undefined}
                            />
                        ) : (
                            visible.map((role) => {
                                const system = isSystemRole(role)
                                const enabled = countEnabled(role.rights)
                                const open = () => (system ? setViewing(role) : setEditing(role))
                                return (
                                    <div key={role.id} className="group flex items-center gap-3 px-5 py-3.5 hover:bg-neutral-50/70 transition-colors">
                                        <div
                                            className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                                                system ? 'bg-violet-50 text-violet-600' : 'bg-neutral-100 text-neutral-600'
                                            }`}
                                        >
                                            {system ? <ShieldCheck size={17} /> : <Shield size={17} />}
                                        </div>
                                        <button type="button" onClick={open} className="min-w-0 flex-1 text-start">
                                            <span className="flex items-center gap-2 min-w-0">
                                                <span className="text-sm font-semibold text-neutral-900 truncate group-hover:underline underline-offset-2" dir="auto">
                                                    {role.name}
                                                </span>
                                                {system ? (
                                                    <Chip tone="violet" icon={<Globe size={11} />}>
                                                        {t('dashboard.users.roles.system_wide')}
                                                    </Chip>
                                                ) : (
                                                    <Chip tone="neutral">{t('dashboard.users.dash.roles.custom')}</Chip>
                                                )}
                                            </span>
                                            <span className="block text-xs text-neutral-500 truncate mt-0.5" dir="auto">
                                                {role.description || t('dashboard.users.roles.no_description')}
                                            </span>
                                        </button>
                                        <div className="hidden sm:flex flex-col items-end gap-1 w-36 shrink-0">
                                            <span className="text-xs font-medium text-neutral-600 tabular-nums">
                                                {t('dashboard.users.roles.permissions_count', { count: enabled })}
                                            </span>
                                            <span className="h-1.5 w-full rounded-full bg-neutral-100 overflow-hidden">
                                                <span
                                                    className="block h-full rounded-full bg-neutral-800"
                                                    style={{ width: `${Math.min(100, Math.round((enabled / Math.max(1, countFlags(role.rights) || TOTAL_PERMISSIONS)) * 100))}%` }}
                                                />
                                            </span>
                                        </div>
                                        <DropdownMenu>
                                            <DropdownMenuTrigger asChild>
                                                <button
                                                    type="button"
                                                    aria-label={t('dashboard.users.roles.table.actions')}
                                                    className="h-8 w-8 inline-flex items-center justify-center rounded-lg text-neutral-500 hover:text-neutral-900 hover:bg-neutral-100 data-[state=open]:bg-neutral-100 transition-colors shrink-0"
                                                >
                                                    <DotsThree size={18} weight="bold" />
                                                </button>
                                            </DropdownMenuTrigger>
                                            <DropdownMenuContent align="end" className="w-52 rounded-xl p-1.5">
                                                <DropdownMenuItem onSelect={() => setViewing(role)} className={ITEM}>
                                                    <Eye size={15} /> {t('dashboard.users.roles.actions.view_rights')}
                                                </DropdownMenuItem>
                                                {!system && (
                                                    <>
                                                        <DropdownMenuItem onSelect={() => setEditing(role)} className={ITEM}>
                                                            <PencilSimple size={15} /> {t('dashboard.users.roles.actions.edit')}
                                                        </DropdownMenuItem>
                                                        <DropdownMenuSeparator />
                                                        <DropdownMenuItem
                                                            onSelect={() => setDeleting(role)}
                                                            className={`${ITEM} text-rose-600 focus:text-rose-700 focus:bg-rose-50`}
                                                        >
                                                            <Trash size={15} /> {t('dashboard.users.roles.actions.delete')}
                                                        </DropdownMenuItem>
                                                    </>
                                                )}
                                            </DropdownMenuContent>
                                        </DropdownMenu>
                                    </div>
                                )
                            })
                        )}
                    </div>
                </SectionCard>
            </div>

            {canCreateRoles && <AddRole open={createOpen} onOpenChange={setCreateOpen} />}
            <EditRole role={editing} open={!!editing} onOpenChange={(o) => !o && setEditing(null)} />

            <Modal
                isDialogOpen={!!viewing}
                onOpenChange={(o) => !o && setViewing(null)}
                size="lg"
                icon={<Eye size={16} />}
                dialogTitle={viewing ? t('dashboard.users.roles.modals.view_rights.title', { roleName: viewing.name }) : ''}
                dialogDescription={t('dashboard.users.roles.modals.view_rights.description')}
                footer={
                    <>
                        {viewing && !isSystemRole(viewing) && (
                            <Button
                                variant="secondary"
                                icon={<PencilSimple size={14} />}
                                onClick={() => {
                                    const role = viewing
                                    setViewing(null)
                                    setEditing(role)
                                }}
                            >
                                {t('dashboard.users.roles.actions.edit')}
                            </Button>
                        )}
                        <Button variant="primary" onClick={() => setViewing(null)}>
                            {t('common.close')}
                        </Button>
                    </>
                }
                dialogContent={viewing ? <RolePermissionsMatrix rights={normalizeRights(viewing.rights)} /> : null}
            />

            <ConfirmDialog
                open={!!deleting}
                onOpenChange={(o) => !o && setDeleting(null)}
                title={t('dashboard.users.roles.modals.delete.title')}
                message={t('dashboard.users.roles.modals.delete.message')}
                confirmLabel={t('dashboard.users.roles.modals.delete.button')}
                onConfirm={() => deleting && removeRole(deleting)}
            />
        </FeatureGate>
    )
}

export default OrgRoles
