'use client';
import { Breadcrumbs } from '@components/Objects/Breadcrumbs/Breadcrumbs'
import { ChartBar, BookOpen, Book, CalendarBlank, CheckCircle, Eye, EyeSlash, StackSimple, ShieldCheck, UserGear, Backpack, Lightning, Link as LinkIcon, GearSix } from '@phosphor-icons/react'
import React, { useEffect } from 'react'
import { AssignmentProvider, useAssignments } from '@components/Contexts/Assignments/AssignmentContext';
import ToolTip from '@components/Objects/StyledElements/Tooltip/Tooltip';
import { updateAssignment } from '@services/courses/assignments';
import { useLHSession } from '@components/Contexts/LHSessionContext';
import { useOrg } from '@components/Contexts/OrgContext';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/keys';
import toast from 'react-hot-toast';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { updateActivity } from '@services/courses/activities';
import { getAllOrgCourses } from '@services/courses/courses';
import { getUriWithOrg } from '@services/config/config';
// Lazy Loading
import dynamic from 'next/dynamic';
import AssignmentEditorSubPage from './subpages/AssignmentEditorSubPage';
import { useTranslation } from 'react-i18next';
import { useLHAnalytics, AnalyticsEvent } from '@services/analytics';
import { useRegisterAtlasPageContext } from '@ee/components/Atlas/AtlasMiniContext';
import { Chip, formatShortDate, gradingMetaFor, isPastDate } from '../_components/assignmentUi';
import { Button, buttonClass } from '@components/Dashboard/Shared/DashKit/DashKit';
import { copyAssignmentLink } from '../_components/assignmentLinks';
import { AIMarkIcon } from '@components/Objects/AI/AIBrand';
const AssignmentSubmissionsSubPage = dynamic(() => import('./subpages/AssignmentSubmissionsSubPage'))
const AssignmentAnalyticsSubPage = dynamic(() => import('./subpages/AssignmentAnalyticsSubPage'))
const AssignmentGeneralSubPage = dynamic(() => import('./subpages/AssignmentGeneralSubPage'))

type SubPage = 'general' | 'editor' | 'submissions' | 'analytics'
const SUBPAGES: SubPage[] = ['general', 'editor', 'submissions', 'analytics']

function AssignmentEdit() {
    const { t } = useTranslation()
    const params = useParams<{ assignmentuuid: string; }>()
    const searchParams = useSearchParams()
    const initialSubPage = searchParams.get('subpage') as SubPage | null
    const [selectedSubPage, setSelectedSubPageState] = React.useState<SubPage>(
        initialSubPage && SUBPAGES.includes(initialSubPage) ? initialSubPage : 'editor'
    )
    // Mirror the tab into ?subpage= so a reload or a shared link lands on the
    // same tab. replaceState, not router.replace: no navigation, no flash.
    const setSelectedSubPage = (key: SubPage) => {
        setSelectedSubPageState(key)
        try {
            const url = new URL(window.location.href)
            url.searchParams.set('subpage', key)
            window.history.replaceState(window.history.state, '', url.toString())
        } catch {
            // ignore
        }
    }
    const { track } = useLHAnalytics('dashboard')

    useEffect(() => {
        if (selectedSubPage === 'submissions') {
            track(AnalyticsEvent.AssignmentSubmissionsViewed, {})
        }
        // Fire one impression each time the submissions subpage is selected.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedSubPage])

    const tabs: { key: SubPage; label: string; Icon: React.ComponentType<{ size?: number }> }[] = [
        { key: 'general', label: t('dashboard.assignments.detail.tabs.general'), Icon: GearSix },
        { key: 'editor', label: t('dashboard.assignments.detail.tabs.editor'), Icon: StackSimple },
        { key: 'submissions', label: t('dashboard.assignments.detail.tabs.submissions'), Icon: UserGear },
        { key: 'analytics', label: t('dashboard.assignments.detail.tabs.analytics'), Icon: ChartBar },
    ]

    return (
        // Desktop: the page is exactly one screen tall and each panel scrolls on
        // its own. Below lg the dashboard has a bottom tab bar, so the page
        // flows and scrolls as a whole instead.
        <div className='flex w-full flex-col lg:h-screen'>
            <AssignmentProvider assignment_uuid={'assignment_' + params.assignmentuuid}>
                <AtlasContextBridge />
                <header className='flex-none bg-white nice-shadow relative z-10'>
                    <div className='px-4 sm:px-6 lg:px-10 pt-4 sm:pt-6'>
                        <BrdCmpx />
                        <div className='mt-4 flex flex-col xl:flex-row xl:items-start justify-between gap-4'>
                            <AssignmentTitle />
                            <PublishingState />
                        </div>
                        <nav
                            className='mt-2 sm:mt-3 -mb-px flex gap-1 sm:gap-6 overflow-x-auto scrollbar-hide'
                            role='tablist'
                            aria-label={t('dashboard.assignments.detail.title')}
                        >
                            {tabs.map(({ key, label, Icon }) => {
                                const active = selectedSubPage === key
                                return (
                                    <button
                                        key={key}
                                        type='button'
                                        role='tab'
                                        aria-selected={active}
                                        onClick={() => setSelectedSubPage(key)}
                                        className={`flex items-center gap-2 px-2 sm:px-0.5 py-3 text-sm font-semibold border-b-2 transition-colors whitespace-nowrap ${
                                            active
                                                ? 'border-neutral-900 text-neutral-900'
                                                : 'border-transparent text-neutral-500 hover:text-neutral-800'
                                        }`}
                                    >
                                        <Icon size={16} />
                                        {label}
                                    </button>
                                )
                            })}
                        </nav>
                    </div>
                </header>
                <div className='flex flex-col lg:flex-row lg:flex-1 lg:min-h-0 w-full min-w-0'>
                    {selectedSubPage === 'general' && <AssignmentGeneralSubPage />}
                    {selectedSubPage === 'editor' && <AssignmentEditorSubPage assignmentuuid={params.assignmentuuid} />}
                    {selectedSubPage === 'submissions' && <AssignmentSubmissionsSubPage assignment_uuid={params.assignmentuuid} />}
                    {selectedSubPage === 'analytics' && <AssignmentAnalyticsSubPage assignment_uuid={params.assignmentuuid} />}
                </div>
            </AssignmentProvider>
        </div>
    )
}

export default AssignmentEdit

// Surfaces the active assignment's course + activity to the Atlas mini panel
// so terse follow-ups like "grade this" or "rewrite the prompt" resolve to
// the assignment the user is looking at without a round trip. Must live
// inside <AssignmentProvider> so it can read the loaded context.
function AtlasContextBridge() {
    const assignment = useAssignments() as any
    const courseUuid = assignment?.course_object?.course_uuid
    const activityUuid = assignment?.activity_object?.activity_uuid
    const activityName = assignment?.assignment_object?.title

    useRegisterAtlasPageContext(
        courseUuid && activityUuid
            ? {
                  course_uuid: courseUuid,
                  activity_uuid: activityUuid,
                  activity_name: activityName,
              }
            : null,
    )
    return null
}

function BrdCmpx() {
    const { t } = useTranslation()
    const assignment = useAssignments() as any

    return (
        <Breadcrumbs items={[
            { label: t('common.assignments'), href: '/dash/assignments', icon: <Backpack size={14} /> },
            ...(assignment?.assignment_object?.title ? [{ label: assignment.assignment_object.title }] : [])
        ]} />
    )
}

function PublishingState() {
    const { t } = useTranslation()
    const assignment = useAssignments() as any;
    const session = useLHSession() as any;
    const access_token = session?.data?.tokens?.access_token;
    const queryClient = useQueryClient();
    const { track } = useLHAnalytics('dashboard');
    const isPublished = !!assignment?.assignment_object?.published

    async function updateAssignmentPublishState(assignmentUUID: string) {
        const nextPublished = !assignment?.assignment_object?.published
        const toast_loading = toast.loading(t('dashboard.assignments.detail.publishing.toasts.updating'))
        try {
            const res = await updateAssignment({ published: nextPublished }, assignmentUUID, access_token)
            const res2 = await updateActivity({ published: nextPublished }, assignment?.activity_object?.activity_uuid, access_token)
            // `res2` is a response-metadata envelope, always an object, so the
            // old `res.success && res2` guard degenerated to `res.success` and
            // reported success even when the activity leg 404'd/5xx'd, leaving
            // the badge on "Published" while learners still couldn't see it.
            if (res.success && res2.success) {
                queryClient.invalidateQueries({ queryKey: queryKeys.assignments.detail(assignmentUUID) })
                queryClient.invalidateQueries({ queryKey: ['assignments-all'] })
                toast.success(t('dashboard.assignments.detail.publishing.toasts.update_success'))
                track(AnalyticsEvent.AssignmentPublishToggled, {
                    published: nextPublished,
                    task_count: assignment?.assignment_tasks?.length ?? 0,
                })
            }
            else {
                toast.error(t('dashboard.assignments.detail.publishing.toasts.update_error'))
            }
        } catch (_e) {
            toast.error(t('dashboard.assignments.detail.publishing.toasts.update_error'))
        } finally {
            // Dismiss in `finally`: it used to live in the success branch only,
            // so any failure left a spinner toast on screen forever.
            toast.dismiss(toast_loading)
        }
    }

    const previewHref = assignment?.course_object && assignment?.activity_object
        ? `/course/${assignment.course_object.course_uuid.replace('course_', '')}/activity/${assignment.activity_object.activity_uuid.replace('activity_', '')}`
        : null
    const [toggling, setToggling] = React.useState(false)
    const togglePublished = async () => {
        setToggling(true)
        try {
            await updateAssignmentPublishState(assignment?.assignment_object?.assignment_uuid)
        } finally {
            setToggling(false)
        }
    }

    return (
        <div className='flex flex-wrap items-center gap-2 shrink-0'>
            {previewHref && (
                <ToolTip side='bottom' slateBlack sideOffset={8} content={t('dashboard.assignments.list.copy_link_tooltip')}>
                    <Button
                        icon={<LinkIcon size={14} />}
                        onClick={() => copyAssignmentLink(previewHref, t)}
                        aria-label={t('dashboard.assignments.list.copy_link')}
                    >
                        <span className='max-sm:hidden'>{t('dashboard.assignments.list.copy_link')}</span>
                    </Button>
                </ToolTip>
            )}

            {previewHref && (
                <ToolTip side='bottom' slateBlack sideOffset={8} content={t('dashboard.assignments.detail.publishing.preview_tooltip')}>
                    <Link target='_blank' href={previewHref} className={buttonClass('secondary', 'md')}>
                        <Eye size={14} />
                        {t('dashboard.assignments.detail.publishing.preview')}
                    </Link>
                </ToolTip>
            )}

            {isPublished ? (
                <ToolTip side='bottom' slateBlack sideOffset={8} content={t('dashboard.assignments.detail.publishing.unpublish_tooltip')}>
                    <Button icon={<Book size={14} />} loading={toggling} onClick={togglePublished}>
                        {t('dashboard.assignments.detail.publishing.unpublish')}
                    </Button>
                </ToolTip>
            ) : (
                <ToolTip side='bottom' slateBlack sideOffset={8} content={t('dashboard.assignments.detail.publishing.publish_tooltip')}>
                    <Button variant='primary' icon={<BookOpen size={14} />} loading={toggling} onClick={togglePublished}>
                        {t('dashboard.assignments.detail.publishing.publish')}
                    </Button>
                </ToolTip>
            )}
        </div>
    )
}

function AssignmentTitle() {
    const { t, i18n } = useTranslation()
    const assignment = useAssignments() as any;
    const org = useOrg() as any;
    const session = useLHSession() as any;
    const access_token = session?.data?.tokens?.access_token;
    const obj = assignment?.assignment_object;
    const courseUuid: string | undefined = assignment?.course_object?.course_uuid

    // Same query (and cache entry) the assignments list uses, so coming from
    // there this is free; it only provides the course's display name.
    const { data: courses } = useQuery({
        queryKey: queryKeys.courses.dashAll(org?.slug ?? ''),
        queryFn: () => getAllOrgCourses(org.slug, access_token),
        enabled: !!(org?.slug && access_token),
        staleTime: 60_000,
    })
    const course = Array.isArray(courses) ? courses.find((c: any) => c.course_uuid === courseUuid) : null

    const grading = gradingMetaFor(obj)
    const GradingIcon = grading?.Icon
    const dueDate = formatShortDate(obj?.due_date, i18n.language)
    const isPastDue = isPastDate(obj?.due_date)

    return (
        <div className='min-w-0 flex-1'>
            <div className='flex flex-wrap items-center gap-x-3 gap-y-2'>
                <h1 className='text-2xl sm:text-3xl font-bold tracking-tight text-neutral-900 break-words min-w-0'>
                    {obj?.title || '...'}
                </h1>
                {obj && (obj.published ? (
                    <Chip tone='emerald' icon={<CheckCircle size={12} />}>{t('dashboard.assignments.detail.publishing.published')}</Chip>
                ) : (
                    <Chip tone='neutral' icon={<EyeSlash size={12} />}>{t('dashboard.assignments.home.status_draft')}</Chip>
                ))}
            </div>
            {obj && (
                <div className='mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-neutral-500'>
                    {courseUuid && (
                        <Link
                            href={{
                                pathname: getUriWithOrg(org?.slug, `/dash/courses/course/${courseUuid.replace('course_', '')}/content`),
                                query: { subpage: 'editor' },
                            }}
                            className='inline-flex items-center gap-1.5 min-w-0 max-w-full text-neutral-700 hover:text-neutral-900 hover:underline underline-offset-2'
                        >
                            <StackSimple size={14} className='shrink-0 text-neutral-400' />
                            <span className='truncate'>{course?.name || t('dashboard.assignments.home.course_editor')}</span>
                        </Link>
                    )}
                    {grading && GradingIcon && (
                        <span className='inline-flex items-center gap-1.5'>
                            <GradingIcon size={14} className='text-neutral-400' />
                            {t(grading.labelKey)}
                        </span>
                    )}
                    {dueDate && (
                        <span className={`inline-flex items-center gap-1.5 tabular-nums ${isPastDue ? 'text-rose-600' : ''}`}>
                            <CalendarBlank size={14} className={isPastDue ? '' : 'text-neutral-400'} />
                            {t('dashboard.assignments.detail.due_on', { date: dueDate })}
                        </span>
                    )}
                    {obj.auto_grading && (
                        <span className='inline-flex items-center gap-1.5'>
                            <Lightning size={14} className='text-amber-500' />
                            {t('dashboard.assignments.detail.header_badges.auto_grading')}
                        </span>
                    )}
                    {obj.ai_grading_mode === 'AUTO' && !obj.ungraded && (
                        <span className='inline-flex items-center gap-1.5'>
                            <AIMarkIcon size={14} />
                            {t('dashboard.assignments.detail.header_badges.ai_auto')}
                        </span>
                    )}
                    {obj.anti_copy_paste && (
                        <span className='inline-flex items-center gap-1.5'>
                            <ShieldCheck size={14} className='text-sky-500' />
                            {t('dashboard.assignments.detail.header_badges.anti_copy_paste')}
                        </span>
                    )}
                </div>
            )}
        </div>
    );
}
