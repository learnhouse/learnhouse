'use client';
import { useCourse } from '@components/Contexts/CourseContext';
import { useLHSession } from '@components/Contexts/LHSessionContext';
import { useOrg } from '@components/Contexts/OrgContext';
import { getUriWithOrg } from '@services/config/config';
import { getUserGroups, linkResourcesToUserGroup } from '@services/usergroups/usergroups';
import { ArrowSquareOut, Check, Info, LinkSimple, Users, UsersThree } from '@phosphor-icons/react';
import Link from 'next/link';
import React, { useMemo, useState } from 'react'
import toast from 'react-hot-toast';
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query/keys'
import { useTranslation } from 'react-i18next'
import { asArray } from '@services/utils/ts/requests'
import Modal from '@components/Objects/StyledElements/Modal/Modal'
import { Button, buttonClass, EmptyState, SearchInput } from '@components/Dashboard/Shared/DashKit/DashKit'

type LinkToUserGroupProps = {
    open: boolean
    onOpenChange: (open: boolean) => void
    // Groups already linked to the course; shown as linked and not selectable.
    linkedIds?: number[]
}

// Pick one or more user groups to give access to a users-only course.
function LinkToUserGroup({ open, onOpenChange, linkedIds = [] }: LinkToUserGroupProps) {
    const { t } = useTranslation()
    const course = useCourse() as any
    const org = useOrg() as any
    const session = useLHSession() as any
    const access_token = session?.data?.tokens?.access_token;
    const queryClient = useQueryClient()
    const courseStructure = course?.courseStructure
    const [query, setQuery] = useState('')
    const [selected, setSelected] = useState<number[]>([])
    const [linking, setLinking] = useState(false)

    const { data: usergroups = [], isPending } = useQuery({
        queryKey: queryKeys.usergroups.list(org?.id),
        queryFn: () => getUserGroups(org.id, access_token),
        select: (res: any) => asArray<any>(res),
        enabled: open && !!(courseStructure && org?.id && access_token),
        staleTime: 60_000,
    })

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase()
        if (!q) return usergroups
        return usergroups.filter((g: any) =>
            `${g.name ?? ''} ${g.description ?? ''}`.toLowerCase().includes(q)
        )
    }, [usergroups, query])

    const close = (next: boolean) => {
        if (!next) {
            setSelected([])
            setQuery('')
        }
        onOpenChange(next)
    }

    const toggle = (id: number) =>
        setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))

    const handleLink = async () => {
        if (selected.length === 0) return
        setLinking(true)
        let linked = 0
        try {
            for (const id of selected) {
                const res = await linkResourcesToUserGroup(id, courseStructure.course_uuid, org.id, access_token)
                if (res.status === 200) {
                    linked += 1
                } else {
                    const name = usergroups.find((g: any) => g.id === id)?.name ?? id
                    toast.error(`${name}: ${t('dashboard.courses.access.usergroups.toasts.link_error', { status: res.status, detail: res.data?.detail })}`)
                }
            }
            if (linked > 0) {
                toast.success(t('dashboard.courses.editor.usergroups.link_success', { count: linked }))
                queryClient.invalidateQueries({ queryKey: queryKeys.courseUsergroups.resources(courseStructure.course_uuid, org.id) })
                close(false)
            }
        } finally {
            setLinking(false)
        }
    }

    const createHref = getUriWithOrg(org?.slug, '/dash/users/settings/usergroups')
    const hasGroups = usergroups.length > 0

    return (
        <Modal
            isDialogOpen={open}
            onOpenChange={close}
            size="md"
            preventClose={linking}
            icon={<UsersThree size={16} />}
            dialogTitle={t('dashboard.courses.editor.usergroups.modal_title')}
            dialogDescription={t('dashboard.courses.editor.usergroups.modal_description')}
            footer={
                hasGroups ? (
                    <>
                        <span className="me-auto text-xs text-neutral-500 tabular-nums">
                            {selected.length > 0 && t('dashboard.courses.editor.usergroups.selected', { count: selected.length })}
                        </span>
                        <Button onClick={() => close(false)} disabled={linking}>
                            {t('common.cancel')}
                        </Button>
                        <Button
                            variant="primary"
                            icon={<LinkSimple size={14} />}
                            loading={linking}
                            disabled={selected.length === 0}
                            onClick={handleLink}
                        >
                            {t('dashboard.courses.editor.usergroups.link_button', { count: Math.max(selected.length, 1) })}
                        </Button>
                    </>
                ) : undefined
            }
            dialogContent={
                <div className="flex flex-col gap-4">
                    <div className="flex items-start gap-2.5 rounded-xl bg-neutral-50 ring-1 ring-inset ring-neutral-200/70 px-3.5 py-3 text-xs text-neutral-600 leading-relaxed">
                        <Info size={15} className="mt-px shrink-0 text-neutral-400" />
                        <span>{t('dashboard.courses.editor.usergroups.explainer')}</span>
                    </div>

                    {isPending ? (
                        <div className="space-y-2 animate-pulse">
                            {[0, 1, 2].map((i) => (
                                <div key={i} className="h-14 rounded-xl bg-neutral-100" />
                            ))}
                        </div>
                    ) : !hasGroups ? (
                        <EmptyState
                            icon={<UsersThree size={22} />}
                            title={t('dashboard.courses.access.usergroups.modals.no_usergroups')}
                            description={t('dashboard.courses.editor.usergroups.none_description')}
                            action={
                                <Link href={createHref} target="_blank" className={buttonClass('primary', 'md')}>
                                    <ArrowSquareOut size={14} />
                                    {t('dashboard.courses.access.usergroups.modals.create_usergroup')}
                                </Link>
                            }
                        />
                    ) : (
                        <>
                            {usergroups.length > 5 && (
                                <SearchInput
                                    value={query}
                                    onChange={setQuery}
                                    placeholder={t('dashboard.courses.editor.usergroups.search')}
                                />
                            )}
                            <ul role="listbox" aria-multiselectable="true" className="rounded-xl ring-1 ring-inset ring-neutral-200 divide-y divide-neutral-100 overflow-hidden max-h-[340px] overflow-y-auto">
                                {filtered.length === 0 && (
                                    <li className="px-4 py-6 text-center text-sm text-neutral-500">
                                        {t('dashboard.courses.editor.usergroups.no_match')}
                                    </li>
                                )}
                                {filtered.map((group: any) => {
                                    const isLinked = linkedIds.includes(group.id)
                                    const isSelected = selected.includes(group.id)
                                    return (
                                        <li key={group.id}>
                                            <button
                                                type="button"
                                                role="option"
                                                aria-selected={isSelected}
                                                disabled={isLinked}
                                                onClick={() => toggle(group.id)}
                                                className={`w-full flex items-center gap-3 px-4 py-3 text-start transition-colors ${
                                                    isLinked
                                                        ? 'cursor-default opacity-60'
                                                        : isSelected
                                                          ? 'bg-neutral-50'
                                                          : 'hover:bg-neutral-50'
                                                }`}
                                            >
                                                <span className="w-9 h-9 rounded-xl bg-violet-50 text-violet-600 flex items-center justify-center shrink-0">
                                                    <Users size={16} />
                                                </span>
                                                <span className="min-w-0 flex-1">
                                                    <span className="block text-sm font-semibold text-neutral-900 truncate">{group.name}</span>
                                                    <span className="block text-xs text-neutral-500 truncate">
                                                        {group.description || t('dashboard.courses.editor.usergroups.no_description')}
                                                    </span>
                                                </span>
                                                {isLinked ? (
                                                    <span className="text-xs font-medium text-neutral-500 shrink-0">
                                                        {t('dashboard.courses.editor.usergroups.already_linked')}
                                                    </span>
                                                ) : (
                                                    <span
                                                        className={`h-[18px] w-[18px] shrink-0 rounded-md flex items-center justify-center transition-colors ${
                                                            isSelected ? 'bg-neutral-900 text-white' : 'bg-white ring-1 ring-inset ring-neutral-300'
                                                        }`}
                                                    >
                                                        {isSelected && <Check size={12} weight="bold" />}
                                                    </span>
                                                )}
                                            </button>
                                        </li>
                                    )
                                })}
                            </ul>
                            <Link href={createHref} target="_blank" className="self-start inline-flex items-center gap-1 text-xs font-medium text-neutral-500 hover:text-neutral-900">
                                <ArrowSquareOut size={12} />
                                {t('dashboard.courses.access.usergroups.modals.create_usergroup')}
                            </Link>
                        </>
                    )}
                </div>
            }
        />
    )
}

export default LinkToUserGroup
