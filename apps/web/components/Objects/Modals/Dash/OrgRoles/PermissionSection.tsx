/* eslint-disable no-unused-vars --
   The core no-unused-vars rule false-positives on parameter names inside
   TS type signatures (e.g. `t: (key: string) => string`); switching the
   project to @typescript-eslint/no-unused-vars is tracked in #800. */
'use client'
import React from 'react'
import { CheckSquare, Square } from 'lucide-react'

// Shared between AddRole and EditRole. Defined at module level so React
// keeps a stable component identity — when this was declared inside the
// modal components, every rights change remounted the whole section and
// checkbox interactions lost focus/scroll state.
type PermissionSectionProps = {
    title: string
    icon: any
    section: string
    permissions: string[]
    rights: Record<string, any>
    i18nPrefix: string
    t: (key: string) => string
    onSelectAll: (section: any, value: boolean) => void
    onRightChange: (section: any, action: string, value: boolean) => void
}

const PermissionSection = ({
    title,
    icon: Icon,
    section,
    permissions,
    rights,
    i18nPrefix,
    t,
    onSelectAll,
    onRightChange,
}: PermissionSectionProps) => {
    const sectionRights = (rights[section] || {}) as Record<string, boolean>
    const allSelected = permissions.every(perm => sectionRights[perm])
    const someSelected = permissions.some(perm => sectionRights[perm]) && !allSelected

    return (
        <div className="border border-gray-200 rounded-lg p-4 mb-4 bg-white shadow-sm">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-3 gap-2">
                <div className="flex items-center space-x-2">
                    <Icon className="w-4 h-4 text-gray-500" />
                    <h3 className="font-semibold text-gray-800 text-sm sm:text-base">{title}</h3>
                </div>
                <button
                    type="button"
                    onClick={() => onSelectAll(section, !allSelected)}
                    className="flex items-center space-x-2 text-sm text-blue-600 hover:text-blue-700 font-medium self-start sm:self-auto transition-colors"
                >
                    {allSelected ? <CheckSquare className="w-4 h-4" /> : someSelected ? <Square className="w-4 h-4" /> : <Square className="w-4 h-4" />}
                    <span className="hidden sm:inline">{allSelected ? t(`${i18nPrefix}.deselect_all`) : t(`${i18nPrefix}.select_all`)}</span>
                    <span className="sm:hidden">{allSelected ? t(`${i18nPrefix}.deselect`) : t(`${i18nPrefix}.select`)}</span>
                </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {permissions.map((permission) => (
                    <label key={permission} className="flex items-center space-x-2 cursor-pointer p-2 rounded-md hover:bg-gray-50 transition-colors">
                        <input
                            type="checkbox"
                            checked={sectionRights[permission] || false}
                            onChange={(e) => onRightChange(section, permission, e.target.checked)}
                            className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 focus:ring-2"
                        />
                        <span className="text-sm text-gray-700 capitalize">
                            {t(`${i18nPrefix}.actions.${permission.replace('action_', '').replace(/_/g, '_')}`)}
                        </span>
                    </label>
                ))}
            </div>
        </div>
    )
}

export default PermissionSection
