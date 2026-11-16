'use client'
import React from 'react'
import { useFormik } from 'formik'
import toast from 'react-hot-toast'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import { Shield, Sparkle } from '@phosphor-icons/react'
import Modal from '@components/Objects/StyledElements/Modal/Modal'
import { Button, FieldLabel, INPUT, TEXTAREA } from '@components/Dashboard/Shared/DashKit/DashKit'
import { useOrg } from '@components/Contexts/OrgContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useUpgradeModal } from '@components/Dashboard/Shared/PlanRestricted/UpgradeModalContext'
import { createRole, updateRole } from '@services/roles/roles'
import { queryKeys } from '@/lib/query/keys'
import RolePermissionsMatrix from './RolePermissionsMatrix'
import { PREDEFINED_ROLES, RoleRights, TOTAL_PERMISSIONS, countEnabled, normalizeRights, presetKey } from './roleRights'

export type EditableRole = {
    id: number
    name: string
    description: string
    rights: any
}

const FORM_ID = 'role-editor-form'

// Create and edit share one dialog: name + description on top, presets as a
// starting point, then the permission matrix. The submit lives in the footer
// so it stays visible however long the matrix gets.
export default function RoleEditorModal({
    open,
    onOpenChange,
    role,
}: {
    open: boolean
    onOpenChange: (_open: boolean) => void
    /** Present when editing; absent when creating. */
    role?: EditableRole | null
}) {
    const { t } = useTranslation()
    const org = useOrg() as any
    const session = useLHSession() as any
    const access_token = session?.data?.tokens?.access_token
    const queryClient = useQueryClient()
    const { handlePlanLimit } = useUpgradeModal()
    const isEdit = !!role
    const ns = isEdit ? 'dashboard.users.roles.modals.edit' : 'dashboard.users.roles.modals.create'

    const [rights, setRights] = React.useState<RoleRights>(() => normalizeRights(role?.rights))
    const [saving, setSaving] = React.useState(false)

    const formik = useFormik({
        initialValues: { name: role?.name ?? '', description: role?.description ?? '' },
        validate: (values) => {
            const errors: Record<string, string> = {}
            if (!values.name) errors.name = t(`${ns}.validation.name_required`)
            else if (values.name.length < 2) errors.name = t(`${ns}.validation.name_min_length`)
            if (!values.description) errors.description = t(`${ns}.validation.description_required`)
            else if (values.description.length < 10) errors.description = t(`${ns}.validation.description_min_length`)
            return errors
        },
        onSubmit: async (values) => {
            const toastId = toast.loading(t(`${ns}.form.loading`))
            setSaving(true)
            const body = {
                name: values.name,
                description: values.description,
                org_id: org.id,
                // Stored roles can carry resources this editor does not show
                // (newer features); keep those flags untouched on edit.
                rights: { ...(isEdit && role?.rights && typeof role.rights === 'object' ? role.rights : {}), ...normalizeRights(rights) },
            }
            try {
                const res = isEdit
                    ? await updateRole(role!.id, body, access_token)
                    : await createRole(body, access_token)
                if (res.status === 200 || res.status === 201) {
                    queryClient.invalidateQueries({ queryKey: queryKeys.org.roles(org.id) })
                    toast.success(t(`${ns}.toasts.success`), { id: toastId })
                    onOpenChange(false)
                } else if (handlePlanLimit(res, { source: 'role_edit', feature: 'admin_seats', requiredPlan: 'standard' })) {
                    // Granting dashboard access can exceed the plan's admin-seat
                    // cap: offer an upgrade instead of a dead-end error.
                    toast.dismiss(toastId)
                    onOpenChange(false)
                } else {
                    toast.error(t(`${ns}.toasts.error`), { id: toastId })
                }
            } catch {
                toast.error(t(`${ns}.toasts.error`), { id: toastId })
            } finally {
                setSaving(false)
            }
        },
    })

    // Fresh state every time the dialog opens, for the role it opens on.
    const { resetForm } = formik
    React.useEffect(() => {
        if (!open) return
        setRights(normalizeRights(role?.rights))
        resetForm({ values: { name: role?.name ?? '', description: role?.description ?? '' } })
    }, [open, role, resetForm])

    const showError = (field: 'name' | 'description') =>
        (formik.touched[field] || formik.submitCount > 0) ? (formik.errors[field] as string | undefined) : undefined

    const applyPreset = (key: string) => {
        const preset = PREDEFINED_ROLES[key]
        if (!preset) return
        // Only fill text the admin has not typed yet when editing; a new role
        // takes the preset's name and blurb as a starting point.
        // One setValues call: two setFieldValue calls validate out of order and
        // can leave a stale "Required" on a field that is now filled.
        formik.setValues(
            {
                name: !isEdit || !formik.values.name ? preset.name : formik.values.name,
                description: !isEdit || !formik.values.description ? preset.description : formik.values.description,
            },
            true
        )
        setRights(normalizeRights(preset.rights))
    }

    const enabled = countEnabled(rights)

    return (
        <Modal
            isDialogOpen={open}
            onOpenChange={onOpenChange}
            preventClose={saving}
            size="xl"
            icon={<Shield size={16} />}
            dialogTitle={t(`${ns}.title`)}
            dialogDescription={t(`${ns}.description`)}
            footer={
                <>
                    <span className="me-auto text-xs text-neutral-500 tabular-nums">
                        {t('dashboard.users.dash.roles.enabled_count', { count: enabled, total: TOTAL_PERMISSIONS })}
                    </span>
                    <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={saving}>
                        {t('common.cancel')}
                    </Button>
                    <Button variant="primary" type="submit" form={FORM_ID} loading={saving}>
                        {saving ? t(`${ns}.form.loading`) : t(`${ns}.form.submit`)}
                    </Button>
                </>
            }
            dialogContent={
                <form id={FORM_ID} onSubmit={formik.handleSubmit} className="flex flex-col gap-6" noValidate>
                    <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-4">
                        <label className="block">
                            <FieldLabel error={showError('name')} hint={t('dashboard.users.dash.roles.name_hint')}>
                                {t(`${ns}.form.role_name`)}
                            </FieldLabel>
                            <input
                                name="name"
                                value={formik.values.name}
                                onChange={formik.handleChange}
                                onBlur={formik.handleBlur}
                                placeholder={t('dashboard.users.roles.modals.create.form.role_name_placeholder')}
                                className={INPUT}
                                autoFocus
                            />
                        </label>
                        <label className="block">
                            <FieldLabel error={showError('description')} hint={t('dashboard.users.dash.roles.description_hint')}>
                                {t(`${ns}.form.description`)}
                            </FieldLabel>
                            <textarea
                                name="description"
                                value={formik.values.description}
                                onChange={formik.handleChange}
                                onBlur={formik.handleBlur}
                                rows={2}
                                placeholder={t('dashboard.users.roles.modals.create.form.description_placeholder')}
                                className={TEXTAREA}
                            />
                        </label>
                    </div>

                    <div>
                        <div className="flex items-center gap-2 mb-2">
                            <Sparkle size={14} className="text-neutral-400" />
                            <span className="text-sm font-semibold text-neutral-800">{t('dashboard.users.dash.roles.presets_title')}</span>
                            <span className="text-xs text-neutral-400">{t('dashboard.users.dash.roles.presets_hint')}</span>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                            {Object.keys(PREDEFINED_ROLES).map((key) => (
                                <button
                                    key={key}
                                    type="button"
                                    onClick={() => applyPreset(key)}
                                    title={t(`dashboard.users.roles.modals.create.presets.${presetKey(key)}.description`)}
                                    className="h-7 px-2.5 rounded-full text-xs font-medium text-neutral-700 bg-white ring-1 ring-inset ring-neutral-200 hover:ring-neutral-400 hover:text-neutral-900 transition-colors"
                                >
                                    {t(`dashboard.users.roles.modals.create.presets.${presetKey(key)}.name`)}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div>
                        <div className="flex items-baseline justify-between gap-3 mb-2">
                            <span className="text-sm font-semibold text-neutral-800">{t(`${ns}.permissions.title`)}</span>
                            <span className="text-xs text-neutral-400">{t('dashboard.users.dash.roles.matrix_hint')}</span>
                        </div>
                        <RolePermissionsMatrix rights={rights} onChange={setRights} />
                    </div>
                </form>
            }
        />
    )
}
