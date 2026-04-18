'use client';
import { Breadcrumbs } from '@components/Objects/Breadcrumbs/Breadcrumbs'
import {
    ALargeSmall,
    BookOpen,
    BookX,
    EllipsisVertical,
    Eye,
    GraduationCap,
    Hash,
    Layers2,
    Monitor,
    Pencil,
    Percent,
    Shield,
    ThumbsUp,
    UserRoundPen,
    Backpack,
    Zap,
} from 'lucide-react'
import React, { useEffect } from 'react'
import { AssignmentProvider, useAssignments } from '@components/Contexts/Assignments/AssignmentContext';
import ToolTip from '@components/Objects/StyledElements/Tooltip/Tooltip';
import { updateAssignment } from '@services/courses/assignments';
import { useLHSession } from '@components/Contexts/LHSessionContext';
import { mutate } from 'swr';
import { getAPIUrl } from '@services/config/config';
import toast from 'react-hot-toast';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { updateActivity } from '@services/courses/activities';
// Lazy Loading
import dynamic from 'next/dynamic';
import AssignmentEditorSubPage from './subpages/AssignmentEditorSubPage';
import { useMediaQuery } from 'usehooks-ts';
import EditAssignmentModal from '@components/Objects/Modals/Activities/Assignments/EditAssignmentModal';
import { useTranslation } from 'react-i18next';
const AssignmentSubmissionsSubPage = dynamic(() => import('./subpages/AssignmentSubmissionsSubPage'))

function AssignmentEdit() {
    const { t } = useTranslation()
    const params = useParams<{ assignmentuuid: string; }>()
    const searchParams = useSearchParams()
    const [selectedSubPage, setSelectedSubPage] = React.useState(searchParams.get('subpage') || 'editor')
    const isMobile = useMediaQuery('(max-width: 767px)')

    if (isMobile) {
        // TODO: Work on a better mobile experience
        return (
          <div className="h-screen w-full bg-[#f8f8f8] flex items-center justify-center p-4">
            <div className="bg-white p-6 rounded-lg shadow-md text-center">
              <h2 className="text-xl font-bold mb-4">{t('dashboard.assignments.detail.mobile.title')}</h2>
              <Monitor className='mx-auto my-5' size={60} />    
              <p>{t('dashboard.assignments.detail.mobile.message1')}</p>
              <p>{t('dashboard.assignments.detail.mobile.message2')}</p>
            </div>
          </div>
        )
    }
    
    return (
        <div className='flex w-full flex-col h-screen'>
            <AssignmentProvider assignment_uuid={'assignment_' + params.assignmentuuid}>
                <div className='flex flex-col bg-white z-10 nice-shadow relative'>
                    <div className='flex justify-between me-10 h-full'>
                        <div className="ps-10 me-10 tracking-tighter">
                            <BrdCmpx />
                            <div className="w-100 flex justify-between">
                                <div className="flex flex-col space-y-2">
                                    <AssignmentTitle />
                                    <AssignmentInfoBadges />
                                </div>
                            </div>
                        </div>
                        <div className='flex flex-col justify-center antialiased'>
                            <PublishingState />
                        </div>
                    </div>
                    <div className='flex space-x-2 pt-2 text-sm tracking-tight font-semibold ps-10 me-10'>
                        <div
                            onClick={() => setSelectedSubPage('editor')}
                            className={`flex space-x-4 py-2 w-fit text-center border-black transition-all ease-linear ${selectedSubPage === 'editor'
                                ? 'border-b-4'
                                : 'opacity-50'
                                } cursor-pointer`}
                        >
                            <div className="flex items-center space-x-2.5 mx-2">
                                <Layers2 size={16} />
                                <div>{t('dashboard.assignments.detail.tabs.editor')}</div>
                            </div>
                        </div>
                        <div
                            onClick={() => setSelectedSubPage('submissions')}
                            className={`flex space-x-4 py-2 w-fit text-center border-black transition-all ease-linear ${selectedSubPage === 'submissions'
                                ? 'border-b-4'
                                : 'opacity-50'
                                } cursor-pointer`}
                        >
                            <div className="flex items-center space-x-2.5 mx-2">
                                <UserRoundPen size={16} />
                                <div>{t('dashboard.assignments.detail.tabs.submissions')}</div>
                            </div>
                        </div>
                    </div>
                </div>
                <div className="flex flex-1 min-h-0 w-full">
                    {selectedSubPage === 'editor' && <AssignmentEditorSubPage assignmentuuid={params.assignmentuuid} />}
                    {selectedSubPage === 'submissions' && <AssignmentSubmissionsSubPage assignment_uuid={params.assignmentuuid} />}
                </div>
            </AssignmentProvider>
        </div>
    )
}

export default AssignmentEdit

function BrdCmpx() {
    const { t } = useTranslation()
    const assignment = useAssignments() as any

    useEffect(() => {
    }, [assignment])

    return (
        <div className="pt-6 pb-4">
            <Breadcrumbs items={[
                { label: t('common.assignments'), href: '/dash/assignments', icon: <Backpack size={14} /> },
                ...(assignment?.assignment_object?.title ? [{ label: assignment.assignment_object.title }] : [])
            ]} />
        </div>
    )
}

function PublishingState() {
    const { t } = useTranslation()
    const assignment = useAssignments() as any;
    const session = useLHSession() as any;
    const access_token = session?.data?.tokens?.access_token;
    const [isEditModalOpen, setIsEditModalOpen] = React.useState(false);

    async function updateAssignmentPublishState(assignmentUUID: string) {
        const res = await updateAssignment({ published: !assignment?.assignment_object?.published }, assignmentUUID, access_token)
        const res2 = await updateActivity({ published: !assignment?.assignment_object?.published }, assignment?.activity_object?.activity_uuid, access_token)
        const toast_loading = toast.loading(t('dashboard.assignments.detail.publishing.toasts.updating'))
        if (res.success && res2) {
            mutate(`${getAPIUrl()}assignments/${assignmentUUID}`)
            toast.success(t('dashboard.assignments.detail.publishing.toasts.update_success'))
            toast.dismiss(toast_loading)
        }
        else {
            toast.error(t('dashboard.assignments.detail.publishing.toasts.update_error'))
        }
    }

    useEffect(() => {
    }, [assignment])

    return (
        <>
            <div className='flex mx-auto mt-5 items-center space-x-4'>
                <div className={`flex text-xs rounded-full px-3.5 py-2 mx-auto font-bold outline outline-1 ${!assignment?.assignment_object?.published ? 'outline-gray-300 bg-gray-200/60' : 'outline-green-300 bg-green-200/60'}`}>
                    {assignment?.assignment_object?.published ? t('dashboard.assignments.detail.publishing.published') : t('dashboard.assignments.detail.publishing.unpublished')}
                </div>
                <div><EllipsisVertical className='text-gray-500' size={13} /></div>

                <ToolTip
                    side='left'
                    slateBlack
                    sideOffset={10}
                    content={t('dashboard.assignments.detail.publishing.edit_tooltip')}>
                    <div
                        onClick={() => setIsEditModalOpen(true)}
                        className='flex px-3 py-2 cursor-pointer rounded-md space-x-2 items-center bg-linear-to-bl text-blue-800 font-medium from-blue-400/50 to-blue-200/80 border border-blue-600/10 shadow-blue-900/10 shadow-lg'>
                        <Pencil size={18} />
                        <p className='text-sm font-bold'>{t('dashboard.assignments.detail.publishing.edit')}</p>
                    </div>
                </ToolTip>

                <ToolTip
                    side='left'
                    slateBlack
                    sideOffset={10}
                    content={t('dashboard.assignments.detail.publishing.preview_tooltip')} >
                    <Link
                        target='_blank'
                        href={`/course/${assignment?.course_object?.course_uuid.replace('course_', '')}/activity/${assignment?.activity_object?.activity_uuid.replace('activity_', '')}`}
                        className='flex px-3 py-2 cursor-pointer rounded-md space-x-2 items-center bg-linear-to-bl text-cyan-800 font-medium from-sky-400/50 to-cyan-200/80  border border-cyan-600/10 shadow-cyan-900/10 shadow-lg'>
                        <Eye size={18} />
                        <p className=' text-sm font-bold'>{t('dashboard.assignments.detail.publishing.preview')}</p>
                    </Link>
                </ToolTip>
                {assignment?.assignment_object?.published && <ToolTip
                    side='left'
                    slateBlack
                    sideOffset={10}
                    content={t('dashboard.assignments.detail.publishing.unpublish_tooltip')} >
                    <div
                        onClick={() => updateAssignmentPublishState(assignment?.assignment_object?.assignment_uuid)}
                        className='flex px-3 py-2 cursor-pointer rounded-md space-x-2 items-center bg-linear-to-bl text-gray-800 font-medium from-gray-400/50 to-gray-200/80 border border-gray-600/10 shadow-gray-900/10 shadow-lg'>
                        <BookX size={18} />
                        <p className='text-sm font-bold'>{t('dashboard.assignments.detail.publishing.unpublish')}</p>
                    </div>
                </ToolTip>}
                {!assignment?.assignment_object?.published &&
                    <ToolTip
                        side='left'
                        slateBlack
                        sideOffset={10}
                        content={t('dashboard.assignments.detail.publishing.publish_tooltip')} >
                        <div
                            onClick={() => updateAssignmentPublishState(assignment?.assignment_object?.assignment_uuid)}
                            className='flex px-3 py-2 cursor-pointer rounded-md space-x-2 items-center bg-linear-to-bl text-green-800 font-medium from-green-400/50 to-lime-200/80  border border-green-600/10 shadow-green-900/10 shadow-lg'>
                            <BookOpen size={18} />
                            <p className=' text-sm font-bold'>{t('dashboard.assignments.detail.publishing.publish')}</p>
                        </div>
                    </ToolTip>}
            </div>
            {isEditModalOpen && (
                <EditAssignmentModal
                    isOpen={isEditModalOpen}
                    onClose={() => setIsEditModalOpen(false)}
                    assignment={{
                        ...assignment?.assignment_object,
                        assignment_tasks: assignment?.assignment_tasks,
                    }}
                    accessToken={access_token}
                />
            )}
        </>
    )
}

function AssignmentTitle() {
    const { t } = useTranslation()
    const assignment = useAssignments() as any;
    const name = assignment?.assignment_object?.title;

    return (
        <div className="flex items-baseline gap-2 font-bold text-2xl">
            <span className="text-gray-400">{t('dashboard.assignments.detail.title_prefix')}</span>
            <span className="text-gray-900 truncate max-w-[500px]">{name || '...'}</span>
        </div>
    );
}

// Skeuomorphic badge tokens — vertical gradient + colored ring + colored
// drop shadow + inset white highlight for a soft "raised pill" look. Same
// values used in the assignments dashboard (page.tsx in /dash/assignments)
// so the design language matches across both views.
const BADGE_BASE =
    'flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold ring-1 ring-inset whitespace-nowrap';

const BADGE_VIOLET =
    'bg-gradient-to-b from-violet-50 to-violet-100 text-violet-700 ring-violet-300/40 shadow-[0_1px_2px_rgba(139,92,246,0.18),inset_0_1px_0_rgba(255,255,255,0.85)]';
const BADGE_BLUE =
    'bg-gradient-to-b from-blue-50 to-blue-100 text-blue-700 ring-blue-300/40 shadow-[0_1px_2px_rgba(59,130,246,0.18),inset_0_1px_0_rgba(255,255,255,0.85)]';
const BADGE_EMERALD =
    'bg-gradient-to-b from-emerald-50 to-emerald-100 text-emerald-700 ring-emerald-300/40 shadow-[0_1px_2px_rgba(16,185,129,0.18),inset_0_1px_0_rgba(255,255,255,0.85)]';
const BADGE_AMBER =
    'bg-gradient-to-b from-amber-50 to-amber-100 text-amber-700 ring-amber-300/40 shadow-[0_1px_2px_rgba(245,158,11,0.18),inset_0_1px_0_rgba(255,255,255,0.85)]';
const BADGE_ROSE =
    'bg-gradient-to-b from-rose-50 to-rose-100 text-rose-700 ring-rose-300/40 shadow-[0_1px_2px_rgba(244,63,94,0.18),inset_0_1px_0_rgba(255,255,255,0.85)]';
const BADGE_CYAN =
    'bg-gradient-to-b from-cyan-50 to-cyan-100 text-cyan-700 ring-cyan-300/40 shadow-[0_1px_2px_rgba(6,182,212,0.18),inset_0_1px_0_rgba(255,255,255,0.85)]';

const GRADING_TYPE_DISPLAY: Record<string, { icon: React.ReactNode; labelKey: string; color: string }> = {
    ALPHABET: { icon: <ALargeSmall size={13} />, labelKey: 'dashboard.assignments.modals.edit.form.grading_types.alphabet', color: BADGE_VIOLET },
    NUMERIC: { icon: <Hash size={13} />, labelKey: 'dashboard.assignments.modals.edit.form.grading_types.numeric', color: BADGE_BLUE },
    PERCENTAGE: { icon: <Percent size={13} />, labelKey: 'dashboard.assignments.modals.edit.form.grading_types.percentage', color: BADGE_EMERALD },
    PASS_FAIL: { icon: <ThumbsUp size={13} />, labelKey: 'dashboard.assignments.modals.edit.form.grading_types.pass_fail', color: BADGE_AMBER },
    GPA_SCALE: { icon: <GraduationCap size={13} />, labelKey: 'dashboard.assignments.modals.edit.form.grading_types.gpa_scale', color: BADGE_ROSE },
};

function AssignmentInfoBadges() {
    const { t } = useTranslation();
    const assignment = useAssignments() as any;
    const obj = assignment?.assignment_object;
    if (!obj) return null;

    const gradingType = obj.grading_type as string | undefined;
    const gradingDisplay = gradingType ? GRADING_TYPE_DISPLAY[gradingType] : null;

    return (
        <div className="flex items-center gap-1.5 flex-wrap">
            {gradingDisplay && (
                <div className={`${BADGE_BASE} ${gradingDisplay.color}`}>
                    {gradingDisplay.icon}
                    <span>{t(gradingDisplay.labelKey)}</span>
                </div>
            )}
            {obj.auto_grading && (
                <div className={`${BADGE_BASE} ${BADGE_AMBER}`}>
                    <Zap size={13} />
                    <span>{t('dashboard.assignments.detail.header_badges.auto_grading')}</span>
                </div>
            )}
            {obj.anti_copy_paste && (
                <div className={`${BADGE_BASE} ${BADGE_CYAN}`}>
                    <Shield size={13} />
                    <span>{t('dashboard.assignments.detail.header_badges.anti_copy_paste')}</span>
                </div>
            )}
        </div>
    );
}
