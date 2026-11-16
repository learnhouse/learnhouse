'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import {
    BookOpen,
    Buildings,
    Check,
    FileText,
    FolderOpen,
    Image as ImageIcon,
    Lightning,
    Minus,
    Monitor,
    Shield,
    User,
    UsersThree,
} from '@phosphor-icons/react'
import { ACTION_COLUMNS, ROLE_RESOURCES, RoleRights } from './roleRights'

const RESOURCE_ICONS: Record<string, React.ElementType> = {
    courses: BookOpen,
    coursechapters: FileText,
    activities: Lightning,
    folders: FolderOpen,
    media: ImageIcon,
    users: User,
    usergroups: UsersThree,
    roles: Shield,
    organizations: Buildings,
    dashboard: Monitor,
}

// Resource rows x action columns. One table so it reads at a glance which
// resources a role can touch; a row toggle on the end flips the whole row.
// Without onChange it renders read-only (used to inspect system roles).
const GRID =
    'grid grid-cols-[minmax(150px,1.5fr)_repeat(8,minmax(52px,1fr))_56px] items-center gap-x-1'

function MatrixBox({
    state,
    onClick,
    label,
    readOnly,
}: {
    state: 'on' | 'off' | 'some'
    onClick?: () => void
    label: string
    readOnly?: boolean
}) {
    if (readOnly) {
        return state === 'on' ? (
            <span className="mx-auto w-5 h-5 rounded-md bg-emerald-50 text-emerald-600 flex items-center justify-center" aria-label={label}>
                <Check size={12} weight="bold" />
            </span>
        ) : (
            <span className="mx-auto w-5 h-5 rounded-md bg-neutral-50 text-neutral-300 flex items-center justify-center" aria-label={label}>
                <Minus size={12} weight="bold" />
            </span>
        )
    }
    return (
        <button
            type="button"
            role="checkbox"
            aria-checked={state === 'some' ? 'mixed' : state === 'on'}
            aria-label={label}
            title={label}
            onClick={onClick}
            className={`mx-auto w-5 h-5 rounded-md flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/20 ${
                state === 'on'
                    ? 'bg-neutral-900 text-white'
                    : state === 'some'
                      ? 'bg-neutral-300 text-white'
                      : 'bg-white ring-1 ring-inset ring-neutral-300 hover:ring-neutral-500'
            }`}
        >
            {state === 'on' && <Check size={12} weight="bold" />}
            {state === 'some' && <Minus size={12} weight="bold" />}
        </button>
    )
}

export default function RolePermissionsMatrix({
    rights,
    onChange,
}: {
    rights: RoleRights
    onChange?: (_rights: RoleRights) => void
}) {
    const { t } = useTranslation()
    const readOnly = !onChange

    const actionLabel = (action: string) =>
        t(`dashboard.users.roles.modals.create.permissions.actions.${action.replace('action_', '')}`)
    const resourceLabel = (key: string) => t(`dashboard.users.roles.rights.resources.${key}`)

    const setOne = (resource: string, action: string, value: boolean) =>
        onChange?.({ ...rights, [resource]: { ...rights[resource], [action]: value } })

    const setRow = (resource: string, actions: string[], value: boolean) =>
        onChange?.({
            ...rights,
            [resource]: Object.fromEntries(actions.map((a) => [a, value])),
        })

    const setColumn = (action: string, value: boolean) => {
        const next: RoleRights = { ...rights }
        for (const res of ROLE_RESOURCES) {
            if (res.actions.includes(action)) next[res.key] = { ...next[res.key], [action]: value }
        }
        onChange?.(next)
    }

    return (
        <div className="overflow-x-auto -mx-1 px-1">
            <div className="min-w-[720px] rounded-xl ring-1 ring-inset ring-neutral-200 overflow-hidden">
                <div className={`${GRID} px-3 py-2.5 bg-neutral-50 border-b border-neutral-200 text-[11px] font-semibold text-neutral-500`}>
                    <span className="truncate">{t('dashboard.users.dash.roles.matrix.resource')}</span>
                    {ACTION_COLUMNS.map((action) => {
                        const applicable = ROLE_RESOURCES.filter((r) => r.actions.includes(action))
                        const allOn = applicable.every((r) => rights[r.key]?.[action])
                        return readOnly ? (
                            <span key={action} className="text-center capitalize leading-tight">
                                {actionLabel(action)}
                            </span>
                        ) : (
                            <button
                                key={action}
                                type="button"
                                onClick={() => setColumn(action, !allOn)}
                                title={t('dashboard.users.dash.roles.matrix.toggle_column')}
                                className="text-center capitalize leading-tight rounded-md py-0.5 hover:bg-neutral-200/60 hover:text-neutral-800 transition-colors"
                            >
                                {actionLabel(action)}
                            </button>
                        )
                    })}
                    <span className="text-center truncate">{readOnly ? '' : t('dashboard.users.dash.roles.matrix.all')}</span>
                </div>
                <div className="divide-y divide-neutral-100">
                    {ROLE_RESOURCES.map((res) => {
                        const Icon = RESOURCE_ICONS[res.key] || Shield
                        const enabled = res.actions.filter((a) => rights[res.key]?.[a]).length
                        const rowState = enabled === 0 ? 'off' : enabled === res.actions.length ? 'on' : 'some'
                        return (
                            <div key={res.key} className={`${GRID} px-3 py-2 hover:bg-neutral-50/70 transition-colors`}>
                                <span className="flex items-center gap-2 min-w-0">
                                    <span className="w-7 h-7 rounded-lg bg-neutral-100 text-neutral-500 flex items-center justify-center shrink-0">
                                        <Icon size={14} />
                                    </span>
                                    <span className="text-sm font-medium text-neutral-800 truncate">{resourceLabel(res.key)}</span>
                                </span>
                                {ACTION_COLUMNS.map((action) =>
                                    res.actions.includes(action) ? (
                                        <MatrixBox
                                            key={action}
                                            readOnly={readOnly}
                                            state={rights[res.key]?.[action] ? 'on' : 'off'}
                                            label={`${resourceLabel(res.key)}: ${actionLabel(action)}`}
                                            onClick={() => setOne(res.key, action, !rights[res.key]?.[action])}
                                        />
                                    ) : (
                                        <span key={action} className="text-center text-neutral-200 text-xs select-none" aria-hidden>
                                            ·
                                        </span>
                                    )
                                )}
                                {readOnly ? (
                                    <span className="text-center text-xs text-neutral-400 tabular-nums">
                                        {enabled}/{res.actions.length}
                                    </span>
                                ) : (
                                    <MatrixBox
                                        state={rowState}
                                        label={t('dashboard.users.dash.roles.matrix.toggle_row', { resource: resourceLabel(res.key) })}
                                        onClick={() => setRow(res.key, res.actions, rowState !== 'on')}
                                    />
                                )}
                            </div>
                        )
                    })}
                </div>
            </div>
        </div>
    )
}
