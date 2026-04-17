import { useCourseFieldSync, useCourse } from '@components/Contexts/CourseContext'
import LinkToUserGroup from '@components/Objects/Modals/Dash/EditCourseAccess/LinkToUserGroup'
import ConfirmationModal from '@components/Objects/StyledElements/ConfirmationModal/ConfirmationModal'
import Modal from '@components/Objects/StyledElements/Modal/Modal'
import { getAPIUrl } from '@services/config/config'
import { unLinkResourcesToUserGroup } from '@services/usergroups/usergroups'
import { swrFetcher } from '@services/utils/ts/requests'
import { Check, Globe, SquareUserRound, Users, X } from 'lucide-react'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrg } from '@components/Contexts/OrgContext'
import React, { useEffect, useState, useRef, useCallback } from 'react'
import toast from 'react-hot-toast'
import useSWR, { mutate } from 'swr'
import { useTranslation } from 'react-i18next'

type EditCourseAccessProps = {
    orgslug: string
    course_uuid?: string
}

// forwardRef so Radix Dialog.Trigger asChild can pass onClick/ref through
type AccessCardProps = {
    icon: React.ElementType
    title: string
    description: string
    selected: boolean
} & React.HTMLAttributes<HTMLDivElement>

const AccessCard = React.forwardRef<HTMLDivElement, AccessCardProps>(
    function AccessCard({ icon: Icon, title, description, selected, className, ...rest }, ref) {
        return (
            <div
                ref={ref}
                {...rest}
                className={`
                    relative w-full rounded-xl p-6 cursor-pointer select-none
                    flex flex-col items-center justify-center text-center
                    transition-all duration-150
                    ${selected
                        ? 'bg-white border border-indigo-200 ring-1 ring-indigo-100 shadow-xs'
                        : 'bg-gray-50/80 border border-gray-100 hover:bg-gray-50 hover:border-gray-200'
                    }
                    ${className || ''}
                `}
                style={{ minHeight: 180 }}
            >
                {selected && (
                    <div className="absolute top-3 right-3 flex items-center gap-1 text-[11px] font-semibold text-indigo-700 bg-indigo-50 border border-indigo-100 rounded-full pl-1 pr-2 py-0.5">
                        <span className="w-4 h-4 rounded-full bg-indigo-600 flex items-center justify-center">
                            <Check size={10} strokeWidth={3.5} className="text-white" />
                        </span>
                        <span>Active</span>
                    </div>
                )}

                <div
                    className={`
                        w-12 h-12 rounded-xl flex items-center justify-center transition-colors duration-150
                        ${selected ? 'bg-indigo-50 text-indigo-600' : 'bg-white border border-gray-100 text-gray-400'}
                    `}
                >
                    <Icon size={24} strokeWidth={1.75} />
                </div>
                <div className={`mt-4 text-base sm:text-lg font-bold tracking-tight ${selected ? 'text-gray-900' : 'text-gray-600'}`}>
                    {title}
                </div>
                <div className="mt-1 text-xs sm:text-sm text-gray-400 leading-snug max-w-[420px]">
                    {description}
                </div>
            </div>
        )
    }
)

function SkeletonCard() {
    return (
        <div
            className="w-full rounded-xl bg-gray-50/80 border border-gray-100 animate-pulse flex flex-col items-center justify-center p-6"
            style={{ minHeight: 180 }}
        >
            <div className="w-12 h-12 rounded-xl bg-gray-100" />
            <div className="mt-4 h-4 w-28 rounded bg-gray-100" />
            <div className="mt-2 h-3 w-48 rounded bg-gray-100" />
        </div>
    )
}

function EditCourseAccess(props: EditCourseAccessProps) {
    const { t } = useTranslation()
    const session = useLHSession() as any;
    const access_token = session?.data?.tokens?.access_token;
    const org = useOrg() as any;

    const {
        syncChanges,
        cancelPendingSync,
        courseStructure,
        isLoading,
        isSaving,
    } = useCourseFieldSync('editCourseAccess');

    const { data: usergroups } = useSWR(
        courseStructure?.course_uuid && org?.id
            ? `${getAPIUrl()}usergroups/resource/${courseStructure.course_uuid}?org_id=${org.id}`
            : null,
        (url) => swrFetcher(url, access_token),
        { revalidateOnFocus: false }
    );

    const [isClientPublic, setIsClientPublic] = useState<boolean | undefined>(undefined);
    const hasInitializedRef = useRef(false);
    const previousPublicRef = useRef<boolean | undefined>(undefined);

    useEffect(() => {
        if (!isLoading && courseStructure?.public !== undefined && !hasInitializedRef.current) {
            setIsClientPublic(courseStructure.public);
            previousPublicRef.current = courseStructure.public;
            hasInitializedRef.current = true;
        }
    }, [isLoading, courseStructure?.public]);

    useEffect(() => {
        if (!hasInitializedRef.current || isLoading || isSaving) return;
        if (isClientPublic === undefined) return;
        if (isClientPublic === previousPublicRef.current) return;

        syncChanges({ public: isClientPublic }, true);
        previousPublicRef.current = isClientPublic;
    }, [isClientPublic, isLoading, isSaving, syncChanges]);

    useEffect(() => {
        return () => { cancelPendingSync(); };
    }, [cancelPendingSync]);

    const handleSetPublic = useCallback((value: boolean) => {
        setIsClientPublic(value);
    }, []);

    if (!courseStructure) return null;

    const isReady = isClientPublic !== undefined;

    return (
        <div>
            <div className="h-6" />
            <div className="ml-10 mr-10 mx-auto bg-white rounded-xl shadow-xs">

                {/* Header — matches OrgUsers header */}
                <div className="px-6 py-5 border-b border-gray-100">
                    <h1 className="font-bold text-xl text-gray-800">
                        {t('dashboard.courses.access.title')}
                    </h1>
                    <p className="text-sm text-gray-500 mt-0.5">
                        {t('dashboard.courses.access.subtitle')}
                    </p>
                </div>

                {/* Access type cards */}
                <div className="px-6 py-5 border-b border-gray-100">
                    <div className={`flex flex-col sm:flex-row gap-3 transition-opacity duration-200 ${isSaving ? 'opacity-50 pointer-events-none' : ''}`}>
                        {!isReady ? (
                            <>
                                <SkeletonCard />
                                <SkeletonCard />
                            </>
                        ) : (
                            <>
                                {/* Public */}
                                {isClientPublic === true ? (
                                    <AccessCard
                                        icon={Globe}
                                        title={t('dashboard.courses.access.public.title')}
                                        description={t('dashboard.courses.access.public.description')}
                                        selected
                                    />
                                ) : (
                                    <ConfirmationModal
                                        confirmationButtonText={t('dashboard.courses.access.public.confirmation_button')}
                                        confirmationMessage={t('dashboard.courses.access.public.confirmation_message')}
                                        dialogTitle={t('dashboard.courses.access.public.confirmation_title')}
                                        dialogTrigger={
                                            <AccessCard
                                                icon={Globe}
                                                title={t('dashboard.courses.access.public.title')}
                                                description={t('dashboard.courses.access.public.description')}
                                                selected={false}
                                            />
                                        }
                                        functionToExecute={() => handleSetPublic(true)}
                                        status="info"
                                    />
                                )}

                                {/* UsersOnly */}
                                {isClientPublic === false ? (
                                    <AccessCard
                                        icon={Users}
                                        title={t('dashboard.courses.access.users_only.title')}
                                        description={t('dashboard.courses.access.users_only.description')}
                                        selected
                                    />
                                ) : (
                                    <ConfirmationModal
                                        confirmationButtonText={t('dashboard.courses.access.users_only.confirmation_button')}
                                        confirmationMessage={t('dashboard.courses.access.users_only.confirmation_message')}
                                        dialogTitle={t('dashboard.courses.access.users_only.confirmation_title')}
                                        dialogTrigger={
                                            <AccessCard
                                                icon={Users}
                                                title={t('dashboard.courses.access.users_only.title')}
                                                description={t('dashboard.courses.access.users_only.description')}
                                                selected={false}
                                            />
                                        }
                                        functionToExecute={() => handleSetPublic(false)}
                                        status="info"
                                    />
                                )}
                            </>
                        )}
                    </div>
                </div>

                {/* User groups (Users-table styled) */}
                {isClientPublic === false && <UserGroupsSection usergroups={usergroups} />}
            </div>
        </div>
    );
}

function UserGroupsSection({ usergroups }: { usergroups: any[] }) {
    const { t } = useTranslation()
    const course = useCourse() as any;
    const [userGroupModal, setUserGroupModal] = useState(false);
    const session = useLHSession() as any;
    const access_token = session?.data?.tokens?.access_token;
    const org = useOrg() as any;

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
                mutate(`${getAPIUrl()}usergroups/resource/${course.courseStructure.course_uuid}?org_id=${org.id}`);
            } else {
                toast.error(t('dashboard.courses.access.usergroups.toasts.link_error', { status: res.status, detail: res.data.detail }));
            }
        } catch {
            toast.error(t('dashboard.courses.access.usergroups.toasts.unlink_error'));
        }
    };

    const hasGroups = usergroups && usergroups.length > 0;

    return (
        <>
            {/* Section header */}
            <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100">
                <div className="flex-1">
                    <h2 className="font-bold text-xl text-gray-800">
                        {t('dashboard.courses.access.usergroups.title')}
                    </h2>
                    <p className="text-sm text-gray-500 mt-0.5">
                        {t('dashboard.courses.access.usergroups.subtitle')}
                    </p>
                </div>
                <div className="flex items-center gap-3">
                    {hasGroups && (
                        <div className="text-sm text-gray-500 bg-gray-50 px-3 py-1.5 rounded-lg font-medium">
                            {usergroups.length} {usergroups.length === 1 ? 'group' : 'groups'}
                        </div>
                    )}
                    <Modal
                        isDialogOpen={userGroupModal}
                        onOpenChange={() => setUserGroupModal(!userGroupModal)}
                        minHeight="no-min"
                        minWidth="md"
                        dialogContent={<LinkToUserGroup setUserGroupModal={setUserGroupModal} />}
                        dialogTitle={t('dashboard.courses.access.usergroups.modals.link_title')}
                        dialogDescription={t('dashboard.courses.access.usergroups.modals.link_description')}
                        dialogTrigger={
                            <button className="inline-flex items-center gap-1.5 px-3 py-2 border border-gray-200 rounded-lg text-sm font-medium text-gray-600 bg-white hover:bg-gray-50 transition-all">
                                <SquareUserRound className="w-4 h-4" />
                                <span>{t('dashboard.courses.access.usergroups.actions.link_to_usergroup')}</span>
                            </button>
                        }
                    />
                </div>
            </div>

            {/* Table / Empty state */}
            <div className="relative">
                {hasGroups ? (
                    <table className="w-full">
                        <thead>
                            <tr className="border-b border-gray-100">
                                <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-6 py-3">
                                    {t('dashboard.courses.access.usergroups.table.name')}
                                </th>
                                <th className="text-right text-xs font-semibold text-gray-500 uppercase tracking-wider px-6 py-3">
                                    {t('dashboard.courses.access.usergroups.table.actions')}
                                </th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                            {usergroups.map((usergroup: any) => (
                                <tr
                                    key={usergroup.invite_code_uuid}
                                    className="hover:bg-gray-50 transition-colors"
                                >
                                    <td className="px-6 py-4">
                                        <div className="flex items-center gap-3">
                                            <div className="w-10 h-10 rounded-full bg-indigo-50 text-indigo-500 flex items-center justify-center flex-shrink-0">
                                                <Users className="w-4 h-4" />
                                            </div>
                                            <div className="flex flex-col min-w-0">
                                                <span className="font-semibold text-gray-800 text-sm truncate">
                                                    {usergroup.name}
                                                </span>
                                                {usergroup.description && (
                                                    <span className="text-xs text-gray-400 truncate">
                                                        {usergroup.description}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    </td>
                                    <td className="px-6 py-4 text-right">
                                        <ConfirmationModal
                                            confirmationButtonText={t('dashboard.courses.access.usergroups.modals.unlink_button')}
                                            confirmationMessage={t('dashboard.courses.access.usergroups.modals.unlink_message')}
                                            dialogTitle={t('dashboard.courses.access.usergroups.modals.unlink_title')}
                                            dialogTrigger={
                                                <button
                                                    className="inline-flex items-center gap-1.5 h-8 px-3 bg-white text-gray-600 hover:bg-rose-50 hover:text-rose-600 rounded-md text-xs font-medium nice-shadow transition-all"
                                                    title={t('dashboard.courses.access.usergroups.actions.delete_link')}
                                                >
                                                    <X className="w-3.5 h-3.5" />
                                                    <span>{t('dashboard.courses.access.usergroups.actions.delete_link')}</span>
                                                </button>
                                            }
                                            functionToExecute={() => removeUserGroupLink(usergroup.id)}
                                            status="warning"
                                        />
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                ) : (
                    <div className="py-16 text-center">
                        <div className="flex flex-col items-center gap-3">
                            <div className="bg-gray-100 p-4 rounded-full">
                                <Users className="w-8 h-8 text-gray-400" />
                            </div>
                            <p className="text-gray-400 text-sm font-medium max-w-sm">
                                {t('dashboard.courses.access.usergroups.subtitle')}
                            </p>
                        </div>
                    </div>
                )}
            </div>
        </>
    );
}

export default EditCourseAccess;
