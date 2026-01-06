import { useCourse, useCourseDispatch } from '@components/Contexts/CourseContext'
import LinkToUserGroup from '@components/Objects/Modals/Dash/EditCourseAccess/LinkToUserGroup'
import ConfirmationModal from '@components/Objects/StyledElements/ConfirmationModal/ConfirmationModal'
import Modal from '@components/Objects/StyledElements/Modal/Modal'
import { getAPIUrl } from '@services/config/config'
import { unLinkResourcesToUserGroup } from '@services/usergroups/usergroups'
import { swrFetcher } from '@services/utils/ts/requests'
import { Globe, SquareUserRound, Users, X } from 'lucide-react'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import React, { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import useSWR, { mutate } from 'swr'
import { useTranslation } from 'react-i18next'

type EditCourseAccessProps = {
    orgslug: string
    course_uuid?: string
}

function EditCourseAccess(props: EditCourseAccessProps) {
    const { t } = useTranslation()
    const session = useLHSession() as any;
    const access_token = session?.data?.tokens?.access_token;
    const course = useCourse() as any;
    const { isLoading, courseStructure } = course as any;
    const dispatchCourse = useCourseDispatch() as any;

    const { data: usergroups } = useSWR(courseStructure ? `${getAPIUrl()}usergroups/resource/${courseStructure.course_uuid}` : null, (url) => swrFetcher(url, access_token));
    const [isClientPublic, setIsClientPublic] = useState<boolean | undefined>(undefined);

    useEffect(() => {
        if (!isLoading && courseStructure?.public !== undefined) {
            setIsClientPublic(courseStructure.public);
        }
    }, [isLoading, courseStructure]);

    useEffect(() => {
        if (!isLoading && courseStructure?.public !== undefined && isClientPublic !== undefined) {
            if (isClientPublic !== courseStructure.public) {
                dispatchCourse({ type: 'setIsNotSaved' });
                const updatedCourse = {
                    ...courseStructure,
                    public: isClientPublic,
                };
                dispatchCourse({ type: 'setCourseStructure', payload: updatedCourse });
            }
        }
    }, [isLoading, isClientPublic, courseStructure, dispatchCourse]);

    return (
        <div>
            {courseStructure && (
                <div>
                    <div className="h-6"></div>
                    <div className="mx-4 sm:mx-10 bg-white rounded-xl shadow-xs px-4 py-4">
                        <div className="flex flex-col bg-gray-50 -space-y-1 px-3 sm:px-5 py-3 rounded-md mb-3">
                            <h1 className="font-bold text-lg sm:text-xl text-gray-800">{t('dashboard.courses.access.title')}</h1>
                            <h2 className="text-gray-500 text-xs sm:text-sm">
                                {t('dashboard.courses.access.subtitle')}
                            </h2>
                        </div>
                        <div className="flex flex-col sm:flex-row sm:space-x-2 space-y-2 sm:space-y-0 mx-auto mb-3">
                            <ConfirmationModal
                                confirmationButtonText={t('dashboard.courses.access.public.confirmation_button')}
                                confirmationMessage={t('dashboard.courses.access.public.confirmation_message')}
                                dialogTitle={t('dashboard.courses.access.public.confirmation_title')}
                                dialogTrigger={
                                    <div className="w-full h-[200px] bg-slate-100 rounded-lg cursor-pointer hover:bg-slate-200 transition-all">
                                        {isClientPublic && (
                                            <div className="bg-green-200 text-green-600 font-bold w-fit my-3 mx-3 absolute text-sm px-3 py-1 rounded-lg">
                                                {t('dashboard.courses.access.public.active')}
                                            </div>
                                        )}
                                        <div className="flex flex-col space-y-1 justify-center items-center h-full p-2 sm:p-4">
                                            <Globe className="text-slate-400" size={32} />
                                            <div className="text-xl sm:text-2xl text-slate-700 font-bold">
                                                {t('dashboard.courses.access.public.title')}
                                            </div>
                                            <div className="text-gray-400 text-sm sm:text-md tracking-tight w-full sm:w-[500px] leading-5 text-center">
                                                {t('dashboard.courses.access.public.description')}
                                            </div>
                                        </div>
                                    </div>
                                }
                                functionToExecute={() => setIsClientPublic(true)}
                                status="info"
                            />
                            <ConfirmationModal
                                confirmationButtonText={t('dashboard.courses.access.users_only.confirmation_button')}
                                confirmationMessage={t('dashboard.courses.access.users_only.confirmation_message')}
                                dialogTitle={t('dashboard.courses.access.users_only.confirmation_title')}
                                dialogTrigger={
                                    <div className="w-full h-[200px] bg-slate-100 rounded-lg cursor-pointer hover:bg-slate-200 transition-all">
                                        {!isClientPublic && (
                                            <div className="bg-green-200 text-green-600 font-bold w-fit my-3 mx-3 absolute text-sm px-3 py-1 rounded-lg">
                                                {t('dashboard.courses.access.users_only.active')}
                                            </div>
                                        )}
                                        <div className="flex flex-col space-y-1 justify-center items-center h-full p-2 sm:p-4">
                                            <Users className="text-slate-400" size={32} />
                                            <div className="text-xl sm:text-2xl text-slate-700 font-bold">
                                                {t('dashboard.courses.access.users_only.title')}
                                            </div>
                                            <div className="text-gray-400 text-sm sm:text-md tracking-tight w-full sm:w-[500px] leading-5 text-center">
                                                {t('dashboard.courses.access.users_only.description')}
                                            </div>
                                        </div>
                                    </div>
                                }
                                functionToExecute={() => setIsClientPublic(false)}
                                status="info"
                            />
                        </div>
                        {!isClientPublic && <UserGroupsSection usergroups={usergroups} />}
                    </div>
                </div>
            )}
        </div>
    );
}

function UserGroupsSection({ usergroups }: { usergroups: any[] }) {
    const { t } = useTranslation()
    const course = useCourse() as any;
    const [userGroupModal, setUserGroupModal] = useState(false);
    const session = useLHSession() as any;
    const access_token = session?.data?.tokens?.access_token;

    const removeUserGroupLink = async (usergroup_id: number) => {
        try {
            const res = await unLinkResourcesToUserGroup(usergroup_id, course.courseStructure.course_uuid, access_token);
            if (res.status === 200) {
                toast.success(t('dashboard.courses.access.usergroups.toasts.unlink_success'));
                mutate(`${getAPIUrl()}usergroups/resource/${course.courseStructure.course_uuid}`);
            } else {
                toast.error(t('dashboard.courses.access.usergroups.toasts.link_error', { status: res.status, detail: res.data.detail }));
            }
        } catch (error) {
            toast.error(t('dashboard.courses.access.usergroups.toasts.unlink_error'));
        }
    };

    return (
        <>
            <div className="flex flex-col bg-gray-50 -space-y-1 px-3 sm:px-5 py-3 rounded-md mb-3">
                <h1 className="font-bold text-lg sm:text-xl text-gray-800">{t('dashboard.courses.access.usergroups.title')}</h1>
                <h2 className="text-gray-500 text-xs sm:text-sm">
                    {t('dashboard.courses.access.usergroups.subtitle')}
                </h2>
            </div>
            <div className="overflow-x-auto">
                <table className="table-auto w-full text-left whitespace-nowrap rounded-md overflow-hidden">
                    <thead className="bg-gray-100 text-gray-500 rounded-xl uppercase">
                        <tr className="font-bolder text-sm">
                            <th className="py-3 px-4">{t('dashboard.courses.access.usergroups.table.name')}</th>
                            <th className="py-3 px-4">{t('dashboard.courses.access.usergroups.table.actions')}</th>
                        </tr>
                    </thead>
                    <tbody className="mt-5 bg-white rounded-md">
                        {usergroups?.map((usergroup: any) => (
                            <tr key={usergroup.invite_code_uuid} className="border-b border-gray-100 text-sm">
                                <td className="py-3 px-4">{usergroup.name}</td>
                                <td className="py-3 px-4">
                                    <ConfirmationModal
                                        confirmationButtonText={t('dashboard.courses.access.usergroups.modals.unlink_button')}
                                        confirmationMessage={t('dashboard.courses.access.usergroups.modals.unlink_message')}
                                        dialogTitle={t('dashboard.courses.access.usergroups.modals.unlink_title')}
                                        dialogTrigger={
                                            <button className="mr-2 flex space-x-2 hover:cursor-pointer p-1 px-3 bg-rose-700 rounded-md font-bold items-center text-sm text-rose-100">
                                                <X className="w-4 h-4" />
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
            </div>
            <div className="flex flex-row-reverse mt-3 mr-2">
                <Modal
                    isDialogOpen={userGroupModal}
                    onOpenChange={() => setUserGroupModal(!userGroupModal)}
                    minHeight="no-min"
                    minWidth="md"
                    dialogContent={<LinkToUserGroup setUserGroupModal={setUserGroupModal} />}
                    dialogTitle={t('dashboard.courses.access.usergroups.modals.link_title')}
                    dialogDescription={t('dashboard.courses.access.usergroups.modals.link_description')}
                    dialogTrigger={
                        <button className="flex space-x-2 hover:cursor-pointer p-1 px-3 bg-green-700 rounded-md font-bold items-center text-xs sm:text-sm text-green-100">
                            <SquareUserRound className="w-3 h-3 sm:w-4 sm:h-4" />
                            <span>{t('dashboard.courses.access.usergroups.actions.link_to_usergroup')}</span>
                        </button>
                    }
                />
            </div>
        </>
    );
}

export default EditCourseAccess;
