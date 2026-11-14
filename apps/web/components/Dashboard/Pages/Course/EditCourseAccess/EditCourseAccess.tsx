import { useCourseFieldSync, useCourse } from '@components/Contexts/CourseContext'
import LinkToUserGroup from '@components/Objects/Modals/Dash/EditCourseAccess/LinkToUserGroup'
import { getAPIUrl } from '@services/config/config'
import { unLinkResourcesToUserGroup } from '@services/usergroups/usergroups'
import { apiFetch } from '@services/utils/ts/requests'
import { Eye, Globe, LinkSimple, UsersThree, Users, X } from '@phosphor-icons/react'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrg } from '@components/Contexts/OrgContext'
import React, { useState } from 'react'
import toast from 'react-hot-toast'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query/keys'
import { useTranslation } from 'react-i18next'
import { useLHAnalytics, AnalyticsEvent } from '@services/analytics'
import { Button, Chip, ConfirmDialog, EmptyState, SectionCard } from '@components/Dashboard/Shared/DashKit/DashKit'
import { ChoiceTile, ChoiceTileSkeleton, EditorPage } from '../courseEditorUi'
import CourseLinkedCompanies from '@ee/components/Companies/CourseLinkedCompanies'

type EditCourseAccessProps = {
    orgslug: string
    course_uuid?: string
}

// Visibility is a course field: picking one stages it, and the header Save
// sends it. Linking or unlinking a user group is an action that applies at once.
function EditCourseAccess(_props: EditCourseAccessProps) {
    const { t } = useTranslation()
    const { track } = useLHAnalytics('dashboard')
    const session = useLHSession() as any;
    const access_token = session?.data?.tokens?.access_token;
    const org = useOrg() as any;

    const { syncChanges, courseStructure, isLoading, isSaving } = useCourseFieldSync('editCourseAccess');
    const [confirming, setConfirming] = useState<boolean | null>(null)

    const { data: usergroups } = useQuery({
        queryKey: queryKeys.courseUsergroups.resources(courseStructure?.course_uuid ?? '', org?.id ?? 0),
        queryFn: () => apiFetch(
            `${getAPIUrl()}usergroups/resource/${courseStructure!.course_uuid}?org_id=${org.id}`,
            access_token
        ),
        enabled: !!(courseStructure?.course_uuid && org?.id && access_token),
        staleTime: 60_000,
    });

    // The course store holds the staged value (pending edits are merged into
    // courseStructure), so it survives tab switches.
    const isPublic: boolean | undefined = isLoading ? undefined : courseStructure?.public

    const applyVisibility = (value: boolean) => {
        syncChanges({ public: value }, true)
        track(AnalyticsEvent.CourseAccessChanged, { new_access: value ? 'public' : 'users_only' })
    }

    if (!courseStructure) return null;

    const isReady = isPublic !== undefined;

    return (
        <EditorPage>
            <SectionCard
                icon={<Eye size={18} />}
                title={t('dashboard.courses.access.title')}
                description={t('dashboard.courses.access.subtitle')}
            >
                <div
                    role="radiogroup"
                    aria-label={t('dashboard.courses.access.title')}
                    className={`grid sm:grid-cols-2 gap-3 transition-opacity duration-200 ${isSaving ? 'opacity-50 pointer-events-none' : ''}`}
                >
                    {!isReady ? (
                        <>
                            <ChoiceTileSkeleton />
                            <ChoiceTileSkeleton />
                        </>
                    ) : (
                        <>
                            <ChoiceTile
                                icon={Globe}
                                title={t('dashboard.courses.access.public.title')}
                                description={t('dashboard.courses.access.public.description')}
                                selected={isPublic === true}
                                activeLabel={t('access.active')}
                                tabIndex={0}
                                onClick={() => isPublic !== true && setConfirming(true)}
                                onKeyDown={(e) => {
                                    if ((e.key === 'Enter' || e.key === ' ') && isPublic !== true) {
                                        e.preventDefault()
                                        setConfirming(true)
                                    }
                                }}
                            />
                            <ChoiceTile
                                icon={Users}
                                title={t('dashboard.courses.access.users_only.title')}
                                description={t('dashboard.courses.access.users_only.description')}
                                selected={isPublic === false}
                                activeLabel={t('access.active')}
                                tabIndex={0}
                                onClick={() => isPublic !== false && setConfirming(false)}
                                onKeyDown={(e) => {
                                    if ((e.key === 'Enter' || e.key === ' ') && isPublic !== false) {
                                        e.preventDefault()
                                        setConfirming(false)
                                    }
                                }}
                            />
                        </>
                    )}
                </div>
            </SectionCard>

            <ConfirmDialog
                open={confirming !== null}
                onOpenChange={(open) => !open && setConfirming(null)}
                tone="info"
                title={
                    confirming
                        ? t('dashboard.courses.access.public.confirmation_title')
                        : t('dashboard.courses.access.users_only.confirmation_title')
                }
                message={
                    <>
                        {confirming
                            ? t('dashboard.courses.access.public.confirmation_message')
                            : t('dashboard.courses.access.users_only.confirmation_message')}{' '}
                        {t('dashboard.courses.editor.save.applies_on_save')}
                    </>
                }
                confirmLabel={
                    confirming
                        ? t('dashboard.courses.access.public.confirmation_button')
                        : t('dashboard.courses.access.users_only.confirmation_button')
                }
                onConfirm={() => {
                    if (confirming !== null) applyVisibility(confirming)
                }}
            />

            {isPublic === false && <UserGroupsSection usergroups={Array.isArray(usergroups) ? usergroups : []} />}

            <CourseLinkedCompanies courseUuid={courseStructure.course_uuid} orgslug={_props.orgslug} />
        </EditorPage>
    );
}

function UserGroupsSection({ usergroups }: { usergroups: any[] }) {
    const { t } = useTranslation()
    const course = useCourse() as any;
    const [linkOpen, setLinkOpen] = useState(false);
    const [unlinking, setUnlinking] = useState<any | null>(null);
    const session = useLHSession() as any;
    const access_token = session?.data?.tokens?.access_token;
    const org = useOrg() as any;
    const queryClient = useQueryClient();

    const removeUserGroupLink = async (usergroup_id: number) => {
        try {
            const res = await unLinkResourcesToUserGroup(
                usergroup_id,
                course.courseStructure.course_uuid,
                org.id,
                access_token
            );
            if (res.status === 200) {
                toast.success(t('dashboard.courses.access.usergroups.toasts.unlink_success'));
                queryClient.invalidateQueries({
                    queryKey: queryKeys.courseUsergroups.resources(course.courseStructure.course_uuid, org.id),
                });
            } else {
                toast.error(t('dashboard.courses.access.usergroups.toasts.link_error', { status: res.status, detail: res.data?.detail }));
            }
        } catch {
            toast.error(t('dashboard.courses.access.usergroups.toasts.unlink_error'));
        }
    };

    const hasGroups = usergroups.length > 0;
    const linkButton = (
        <Button variant={hasGroups ? 'secondary' : 'primary'} icon={<LinkSimple size={14} />} onClick={() => setLinkOpen(true)}>
            {t('dashboard.courses.editor.usergroups.link_action')}
        </Button>
    )

    return (
        <SectionCard
            icon={<UsersThree size={18} />}
            title={t('dashboard.courses.editor.usergroups.title')}
            description={t('dashboard.courses.editor.usergroups.description')}
            bodyClassName={hasGroups ? 'px-2 pb-2 pt-3' : 'p-0'}
            actions={
                <>
                    {hasGroups && (
                        <Chip tone="neutral">
                            {t('dashboard.courses.editor.access.group_count', { count: usergroups.length })}
                        </Chip>
                    )}
                    {hasGroups && linkButton}
                </>
            }
        >
            {hasGroups ? (
                <ul className="divide-y divide-neutral-100">
                    {usergroups.map((usergroup: any) => (
                        <li
                            key={usergroup.usergroup_uuid ?? usergroup.id}
                            className="flex items-center justify-between gap-3 px-3 py-3 rounded-xl hover:bg-neutral-50 transition-colors"
                        >
                            <div className="flex items-center gap-3 min-w-0">
                                <div className="w-9 h-9 rounded-xl bg-violet-50 text-violet-600 flex items-center justify-center shrink-0">
                                    <Users size={16} />
                                </div>
                                <div className="flex flex-col min-w-0">
                                    <span className="font-semibold text-neutral-900 text-sm truncate">{usergroup.name}</span>
                                    {usergroup.description && (
                                        <span className="text-xs text-neutral-500 truncate">{usergroup.description}</span>
                                    )}
                                </div>
                            </div>
                            <Button
                                variant="danger-ghost"
                                size="sm"
                                icon={<X size={13} />}
                                onClick={() => setUnlinking(usergroup)}
                                title={t('dashboard.courses.editor.usergroups.unlink')}
                            >
                                <span className="hidden sm:inline">{t('dashboard.courses.editor.usergroups.unlink')}</span>
                            </Button>
                        </li>
                    ))}
                </ul>
            ) : (
                <EmptyState
                    icon={<UsersThree size={22} />}
                    title={t('dashboard.courses.editor.usergroups.empty_title')}
                    description={t('dashboard.courses.editor.usergroups.empty_description')}
                    action={linkButton}
                />
            )}

            <LinkToUserGroup
                open={linkOpen}
                onOpenChange={setLinkOpen}
                linkedIds={usergroups.map((g: any) => g.id)}
            />

            <ConfirmDialog
                open={unlinking !== null}
                onOpenChange={(open) => !open && setUnlinking(null)}
                title={t('dashboard.courses.access.usergroups.modals.unlink_title')}
                message={t('dashboard.courses.editor.usergroups.unlink_message', { name: unlinking?.name ?? '' })}
                confirmLabel={t('dashboard.courses.editor.usergroups.unlink')}
                onConfirm={() => unlinking && removeUserGroupLink(unlinking.id)}
            />
        </SectionCard>
    );
}

export default EditCourseAccess;
