import { useAssignments } from '@components/Contexts/Assignments/AssignmentContext';
import { BookOpenCheck, Check, ClipboardCheck, Download, Info, MessageSquare, RotateCcw, UserCheck, X } from 'lucide-react';
import Link from 'next/link';
import React, { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/keys';
import ConfirmationModal from '@components/Objects/StyledElements/ConfirmationModal/ConfirmationModal';
import UserAvatar from '@components/Objects/UserAvatar';
import { getUserAvatarMediaDirectory } from '@services/media/media';
import TaskQuizObject from '../../_components/TaskEditor/Subs/TaskTypes/TaskQuizObject';
import TaskFileObject from '../../_components/TaskEditor/Subs/TaskTypes/TaskFileObject';
import TaskFormObject from '../../_components/TaskEditor/Subs/TaskTypes/TaskFormObject';
import TaskCodeObject from '../../_components/TaskEditor/Subs/TaskTypes/TaskCodeObject';
import TaskShortAnswerObject from '../../_components/TaskEditor/Subs/TaskTypes/TaskShortAnswerObject';
import TaskNumberAnswerObject from '../../_components/TaskEditor/Subs/TaskTypes/TaskNumberAnswerObject';
import { useOrg } from '@components/Contexts/OrgContext';
import { getTaskRefFileDir } from '@services/media/media';
import { deleteUserSubmission, getFinalGrade, markActivityAsDoneForUser, putFinalGrade } from '@services/courses/assignments';
import { useLHSession } from '@components/Contexts/LHSessionContext';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { useLHAnalytics, AnalyticsEvent } from '@services/analytics';
import { sortTasksByOrder } from '@/lib/assignments/taskOrder'
import { BTN_PRIMARY, BTN_SECONDARY, Chip, formatShortDate, formatShortTime } from '../../../_components/assignmentUi'
import { TASK_TYPE_META } from '../../_components/Tasks'

function pctToLetterGrade(pct: number): string {
    if (pct >= 90) return 'A';
    if (pct >= 80) return 'B';
    if (pct >= 70) return 'C';
    if (pct >= 60) return 'D';
    return 'F';
}

function pctToGpa(pct: number): string {
    if (pct >= 93) return '4.0';
    if (pct >= 90) return '3.7';
    if (pct >= 87) return '3.3';
    if (pct >= 83) return '3.0';
    if (pct >= 80) return '2.7';
    if (pct >= 77) return '2.3';
    if (pct >= 73) return '2.0';
    if (pct >= 70) return '1.7';
    if (pct >= 67) return '1.3';
    if (pct >= 63) return '1.0';
    if (pct >= 60) return '0.7';
    return '0.0';
}

// The GET /grade response mixes two sources of truth: `display_grade`,
// `points_summary`, `percentage_display` and `passed` are derived from the
// PERSISTED aggregate, while `tasks` is rebuilt live from the current task
// submissions. Inline grading a task writes only the task row, so the header
// banner kept reading e.g. "40/100 pts · 40.00% · Not passing" while the chip
// directly below it flipped to 100%: one response contradicting itself.
// Recompute the banner from the live task rows, mirroring the backend's
// compute_assignment_grade() so both halves always agree.
function buildLiveGrade(gradePreview: any) {
    const tasks = Array.isArray(gradePreview?.tasks) ? gradePreview.tasks : null;
    if (!tasks || tasks.length === 0) return gradePreview;

    const max = tasks.reduce((acc: number, tb: any) => acc + (Number(tb.max_grade) || 0), 0);
    const rawSum = tasks.reduce((acc: number, tb: any) => acc + (Number(tb.grade) || 0), 0);
    // Same clamp the backend applies, so a buggy task sum can't report 120/100.
    const raw = Math.max(Math.min(rawSum, max), 0);
    const percentage = max > 0 ? Math.round((raw / max) * 10000) / 100 : 0;

    const gradingType = gradePreview.grading_type || 'NUMERIC';
    // Prefer the server's threshold (it honours a per-assignment override);
    // only fall back to the grading-type defaults when it isn't present.
    const threshold = typeof gradePreview.passing_threshold === 'number'
        ? gradePreview.passing_threshold
        : (gradingType === 'ALPHABET' || gradingType === 'GPA_SCALE' ? 60 : 50);
    const passed = percentage >= threshold;
    const percentage_display = `${percentage.toFixed(2)}%`;

    let display_grade: string;
    if (gradingType === 'ALPHABET') {
        const letter = pctToLetterGrade(percentage);
        display_grade = !passed ? 'F' : letter === 'F' ? 'D' : letter;
    } else if (gradingType === 'PERCENTAGE') {
        display_grade = percentage_display;
    } else if (gradingType === 'PASS_FAIL') {
        display_grade = passed ? 'Pass' : 'Fail';
    } else if (gradingType === 'GPA_SCALE') {
        const gpa = pctToGpa(percentage);
        display_grade = !passed ? '0.0' : gpa === '0.0' ? '1.0' : gpa;
    } else {
        display_grade = `${Math.round(percentage)}/100`;
    }

    return {
        ...gradePreview,
        grade: raw,
        max_grade: max,
        percentage,
        passed,
        display_grade,
        points_summary: `${raw}/${max} pts`,
        percentage_display,
    };
}

function EvaluateAssignment({
    user_id,
    user,
    submission,
    statusChip,
}: {
    user_id: any
    user?: any
    submission?: any
    statusChip?: React.ReactNode
}) {
    const { t, i18n } = useTranslation()
    const assignments = useAssignments() as any;
    const session = useLHSession() as any;
    const org = useOrg() as any;
    const access_token = session?.data?.tokens?.access_token;
    const queryClient = useQueryClient();
    const { track } = useLHAnalytics('dashboard');

    // Overall feedback the teacher types. `undefined` means "not touched yet"
    // so we don't clobber existing server-side feedback with an empty string.
    const [feedback, setFeedback] = useState<string | undefined>(undefined);
    // Grade preview shown at the top of the modal so the teacher can see what
    // the current per-task scores translate to before finalizing.
    const [gradePreview, setGradePreview] = useState<any>(null);

    const assignmentUuid = assignments?.assignment_object?.assignment_uuid;
    // Formative assignment: the API refuses to grade it, so the grade banner,
    // the per-task score chips and the two grading actions are all replaced by
    // a plain "handed in" review of the learner's work.
    const isUngraded = !!assignments?.assignment_object?.ungraded;

    // Re-pull the aggregate grade + per-task breakdown. Called on open and after
    // a child task is inline-graded, so the header banner and per-task badges
    // reflect the new score immediately instead of staying stale until the
    // teacher clicks "Set final grade".
    const refreshGradePreview = React.useCallback(async (seedFeedback = false) => {
        if (!assignmentUuid || !user_id || !access_token || isUngraded) return;
        const res = await getFinalGrade(user_id, assignmentUuid, access_token);
        if (res.success) {
            setGradePreview(res.data);
            if (seedFeedback && res.data.overall_feedback) {
                setFeedback(res.data.overall_feedback);
            }
        }
    }, [assignmentUuid, user_id, access_token, isUngraded]);

    // Load any existing grade + feedback when the modal opens so the teacher
    // can edit them instead of starting from scratch.
    useEffect(() => {
        if (!assignmentUuid || !user_id || !access_token || isUngraded) return;
        let cancelled = false;
        (async () => {
            const res = await getFinalGrade(user_id, assignmentUuid, access_token);
            if (cancelled) return;
            if (res.success) {
                setGradePreview(res.data);
                if (res.data.overall_feedback) {
                    setFeedback(res.data.overall_feedback);
                }
            }
        })();
        return () => { cancelled = true; };
    }, [assignmentUuid, user_id, access_token, isUngraded]);

    async function gradeAssignment() {
        const res = await putFinalGrade(user_id, assignmentUuid, access_token, feedback ?? null);
        if (res.success) {
            setGradePreview(res.data);
            toast.success(res.data.message)
            track(AnalyticsEvent.SubmissionGraded, {
                has_feedback: !!(feedback && feedback.trim()),
                passed: res.data.passed,
                display_grade: res.data.display_grade,
            })
            const rawUuid = assignmentUuid?.replace('assignment_', '') ?? ''
            queryClient.invalidateQueries({ queryKey: queryKeys.assignments.allSubmissions(rawUuid) })
            queryClient.invalidateQueries({ queryKey: queryKeys.assignments.analytics(rawUuid) })
        }
        else {
            // FastAPI error bodies carry `detail`, never `message`; reading
            // `.message` rendered a wordless red toast for 404/403/500 alike.
            toast.error(res.data?.detail || t('common.something_went_wrong'))
        }
    }

    async function finalizeAndComplete() {
        const gradeRes = await putFinalGrade(user_id, assignmentUuid, access_token, feedback ?? null);
        if (!gradeRes.success) {
            toast.error(gradeRes.data?.detail || t('common.something_went_wrong'))
            return
        }
        setGradePreview(gradeRes.data);
        const doneRes = await markActivityAsDoneForUser(user_id, assignmentUuid, access_token)
        if (doneRes.success) {
            toast.success(t('dashboard.assignments.submissions.toasts.finalize_success'))
            track(AnalyticsEvent.SubmissionFinalized, {
                passed: gradeRes.data.passed,
                display_grade: gradeRes.data.display_grade,
            })
            const rawUuid = assignmentUuid?.replace('assignment_', '') ?? ''
            queryClient.invalidateQueries({ queryKey: queryKeys.assignments.allSubmissions(rawUuid) })
            queryClient.invalidateQueries({ queryKey: queryKeys.assignments.analytics(rawUuid) })
            queryClient.invalidateQueries({ queryKey: queryKeys.assignments.submission(rawUuid) })
        } else {
            toast.error(doneRes.data?.detail || t('common.something_went_wrong'))
        }
    }

    async function rejectAssignment() {
        const res = await deleteUserSubmission(user_id, assignmentUuid, access_token)
        if (!res.success) {
            // Fall back to a generic error, not the *success* string this used
            // to reuse; an error toast that reads "rejected successfully" is
            // worse than no message at all.
            toast.error(res.data?.detail || t('common.something_went_wrong'))
            return
        }
        toast.success(t('dashboard.assignments.submissions.toasts.reject_success'))
        // Revalidate the submissions list + this user's submission caches
        // so the modal can close cleanly and the list reflects the rollback.
        const rawUuid = assignmentUuid?.replace('assignment_', '') ?? ''
        queryClient.invalidateQueries({ queryKey: queryKeys.assignments.allSubmissions(rawUuid) })
        queryClient.invalidateQueries({ queryKey: queryKeys.assignments.submission(rawUuid) })
        setGradePreview(null)
    }

    const sortedTasks = sortTasksByOrder(assignments?.assignment_tasks);

    // Banner numbers derived from the live per-task rows in the same response
    // (see buildLiveGrade) so the header can't contradict the chips below it.
    const liveGrade = gradePreview ? buildLiveGrade(gradePreview) : null;

    // Build a uuid → per-task breakdown map from the backend's `tasks` array
    // so we can render "85%" badges next to each task header. Memoizing with
    // useMemo would be overkill here; the array is tiny.
    const taskBreakdownByUuid: Record<string, any> = {};
    if (gradePreview?.tasks) {
        for (const tb of gradePreview.tasks) {
            taskBreakdownByUuid[tb.assignment_task_uuid] = tb;
        }
    }

    const displayName = user?.first_name && user?.last_name
        ? `${user.first_name} ${user.last_name}`
        : user?.username ? `@${user.username}` : null
    const attempt = submission?.attempt_number || 1
    const submittedDate = formatShortDate(submission?.creation_date, i18n.language)
    const submittedTime = formatShortTime(submission?.creation_date, i18n.language)

    return (
        <div className='flex flex-col min-h-fit gap-5'>
            {/* Learner strip */}
            {(user || submission) && (
                <div className='flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-2xl bg-neutral-50 px-4 py-3'>
                    <div className='flex items-center gap-3 min-w-0'>
                        <UserAvatar
                            avatar_url={getUserAvatarMediaDirectory(user?.user_uuid, user?.avatar_image)}
                            predefined_avatar={user?.avatar_image ? undefined : 'empty'}
                            width={40}
                            rounded='rounded-full'
                        />
                        <div className='min-w-0'>
                            <p className='text-sm font-semibold text-neutral-900 truncate'>{displayName ?? '...'}</p>
                            {user?.email && <p className='text-xs text-neutral-500 truncate'>{user.email}</p>}
                        </div>
                    </div>
                    <div className='flex flex-wrap items-center gap-2 sm:justify-end'>
                        {submittedDate && (
                            <span className='text-xs text-neutral-500 tabular-nums'>
                                {t('dashboard.assignments.submissions.evaluate_modal.submitted_at', { date: `${submittedDate}${submittedTime ? ` · ${submittedTime}` : ''}` })}
                            </span>
                        )}
                        <Chip tone={attempt > 1 ? 'sky' : 'neutral'} icon={<RotateCcw size={12} />} className='tabular-nums'>
                            {t('assignments.attempt_count', { current: attempt })}
                        </Chip>
                        {statusChip}
                    </div>
                </div>
            )}

            <div className='grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_300px] gap-6 items-start'>
                {/* Tasks */}
                <div className='flex flex-col min-w-0'>
                    {sortedTasks.map((task: any, index: number) => {
                        const tb = taskBreakdownByUuid[task.assignment_task_uuid];
                        // Use the server's passed flag so the per-task chip uses
                        // the same grading-type-aware threshold as the overall
                        // grade (50% for numeric/pass-fail, 60% for alphabet/GPA).
                        const taskPassed = tb && tb.submitted && tb.passed;
                        const taskSubmitted = tb && tb.submitted;
                        const meta = TASK_TYPE_META[task.assignment_type]
                        const TypeIcon = meta?.Icon
                        return (
                        <section key={task.assignment_task_uuid} className={`flex flex-col ${index > 0 ? 'border-t border-neutral-100 pt-5 mt-5' : ''}`}>
                            {/* Task header */}
                            <div className='flex flex-col sm:flex-row sm:items-start justify-between gap-2 pb-3'>
                                <div className='flex items-start gap-3 min-w-0'>
                                    <span className='w-8 h-8 rounded-lg bg-neutral-900 text-white text-xs font-bold flex items-center justify-center shrink-0 tabular-nums'>
                                        {index + 1}
                                    </span>
                                    <div className='min-w-0'>
                                        <p className='text-sm font-semibold text-neutral-900 break-words'>
                                            {task.title || task.description || t('dashboard.assignments.submissions.task_label', { number: index + 1 })}
                                        </p>
                                        <div className='mt-1 flex flex-wrap items-center gap-1.5'>
                                            {meta && TypeIcon && (
                                                <span className='inline-flex items-center gap-1 text-xs text-neutral-500 me-1'>
                                                    <TypeIcon size={12} />
                                                    {meta.labelKey ? t(meta.labelKey) : meta.label}
                                                </span>
                                            )}
                                            {tb && !isUngraded && (
                                                <Chip tone={!taskSubmitted ? 'neutral' : taskPassed ? 'emerald' : 'rose'} className='tabular-nums'>
                                                    {taskSubmitted
                                                        ? tb.percentage_display
                                                        : t('dashboard.assignments.submissions.preview.not_submitted')}
                                                </Chip>
                                            )}
                                            {tb?.manually_graded && (
                                                <Chip tone='sky' icon={<UserCheck size={12} />}>
                                                    {t('dashboard.assignments.submissions.preview.manually_graded', { defaultValue: 'Manually graded' })}
                                                </Chip>
                                            )}
                                        </div>
                                    </div>
                                </div>
                                <div className='flex items-center gap-1.5 ps-11 sm:ps-0 shrink-0'>
                                    {task.hint && (
                                        <button
                                            type='button'
                                            onClick={() => toast(task.hint, { icon: 'ℹ️' })}
                                            className='inline-flex items-center gap-1 h-8 px-2.5 rounded-lg text-xs font-semibold text-neutral-700 bg-neutral-100 hover:bg-neutral-200 transition-colors'
                                        >
                                            <Info size={13} />
                                            <span>{t('dashboard.assignments.submissions.hint')}</span>
                                        </button>
                                    )}
                                    {task.reference_file && (
                                        <Link
                                            href={getTaskRefFileDir(
                                                org?.org_uuid,
                                                assignments?.course_object.course_uuid,
                                                assignments?.activity_object.activity_uuid,
                                                assignments?.assignment_object.assignment_uuid,
                                                task.assignment_task_uuid,
                                                task.reference_file
                                            )}
                                            target='_blank'
                                            download={true}
                                            className='inline-flex items-center gap-1 h-8 px-2.5 rounded-lg text-xs font-semibold text-neutral-700 bg-neutral-100 hover:bg-neutral-200 transition-colors'
                                        >
                                            <Download size={13} />
                                            <span>{t('dashboard.assignments.submissions.reference_document')}</span>
                                        </Link>
                                    )}
                                </div>
                            </div>

                            {/* Task content (rendered by the task type component) */}
                            <div className='rounded-xl min-w-0'>
                                {task.assignment_type === 'QUIZ' && <TaskQuizObject key={task.assignment_task_uuid} view='grading' user_id={user_id} assignmentTaskUUID={task.assignment_task_uuid} onGraded={refreshGradePreview} />}
                                {task.assignment_type === 'FILE_SUBMISSION' && <TaskFileObject key={task.assignment_task_uuid} view='custom-grading' user_id={user_id} assignmentTaskUUID={task.assignment_task_uuid} onGraded={refreshGradePreview} />}
                                {task.assignment_type === 'FORM' && <TaskFormObject key={task.assignment_task_uuid} view='grading' user_id={user_id} assignmentTaskUUID={task.assignment_task_uuid} onGraded={refreshGradePreview} />}
                                {task.assignment_type === 'CODE' && <TaskCodeObject key={task.assignment_task_uuid} view='grading' user_id={user_id} assignmentTaskUUID={task.assignment_task_uuid} onGraded={refreshGradePreview} />}
                                {task.assignment_type === 'SHORT_ANSWER' && <TaskShortAnswerObject key={task.assignment_task_uuid} view='grading' user_id={user_id} assignmentTaskUUID={task.assignment_task_uuid} onGraded={refreshGradePreview} />}
                                {task.assignment_type === 'NUMBER_ANSWER' && <TaskNumberAnswerObject key={task.assignment_task_uuid} view='grading' user_id={user_id} assignmentTaskUUID={task.assignment_task_uuid} onGraded={refreshGradePreview} />}
                            </div>
                        </section>
                        );
                    })}
                </div>

                {/* Grade panel: sticks beside the tasks on desktop, follows them on phones */}
                <aside className='lg:sticky lg:top-0 flex flex-col gap-4 rounded-2xl border border-neutral-200/80 bg-white p-4'>
                    {isUngraded ? (
                        <div className='flex items-start gap-3'>
                            <span className='w-9 h-9 rounded-xl bg-sky-50 text-sky-700 flex items-center justify-center shrink-0'>
                                <ClipboardCheck size={18} />
                            </span>
                            <div className='min-w-0'>
                                <p className='text-sm font-semibold text-neutral-900'>
                                    {t('dashboard.assignments.submissions.ungraded_title', { defaultValue: 'Formative (not graded)' })}
                                </p>
                                <p className='mt-0.5 text-xs text-neutral-500'>
                                    {t('dashboard.assignments.submissions.ungraded_description', { defaultValue: 'This assignment is handed in for review only. No score is recorded.' })}
                                </p>
                            </div>
                        </div>
                    ) : (
                        <div>
                            <p className='text-xs text-neutral-500'>{t('dashboard.assignments.submissions.preview.current_grade')}</p>
                            {liveGrade ? (
                                <>
                                    <div className='mt-1.5 flex items-center gap-3'>
                                        <span className={`inline-flex items-center justify-center min-w-[3rem] h-12 px-3 rounded-xl text-2xl font-bold tabular-nums ${liveGrade.passed ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>
                                            {liveGrade.display_grade}
                                        </span>
                                        <div className='min-w-0'>
                                            <p className='text-sm font-semibold text-neutral-900 tabular-nums'>{liveGrade.points_summary}</p>
                                            <p className='text-xs text-neutral-500 tabular-nums'>{liveGrade.percentage_display}</p>
                                        </div>
                                    </div>
                                    <div className='mt-2.5'>
                                        <Chip tone={liveGrade.passed ? 'emerald' : 'rose'}>
                                            {liveGrade.passed
                                                ? t('dashboard.assignments.submissions.preview.passing')
                                                : t('dashboard.assignments.submissions.preview.not_passing')}
                                        </Chip>
                                    </div>
                                </>
                            ) : (
                                <div className='mt-1.5 h-12 w-32 rounded-xl bg-neutral-100 animate-pulse' />
                            )}
                        </div>
                    )}

                    {/* Overall feedback. Only the grading endpoint persists it, and that
                        endpoint refuses a formative assignment, so on one, this box
                        could never deliver anything to the learner. */}
                    {!isUngraded && (
                        <div className='flex flex-col gap-1.5 border-t border-neutral-100 pt-4'>
                            <label htmlFor={`overall-feedback-${user_id}`} className='flex items-center gap-1.5 text-sm font-semibold text-neutral-900'>
                                <MessageSquare size={14} className='text-neutral-400' />
                                {t('dashboard.assignments.submissions.feedback.label')}
                                <span className='text-xs font-normal text-neutral-400'>
                                    ({t('dashboard.assignments.submissions.feedback.optional')})
                                </span>
                            </label>
                            <textarea
                                id={`overall-feedback-${user_id}`}
                                value={feedback ?? ''}
                                onChange={(e) => setFeedback(e.target.value)}
                                placeholder={t('dashboard.assignments.submissions.feedback.placeholder')}
                                rows={4}
                                className='w-full px-3 py-2 text-sm bg-white rounded-xl border border-neutral-200 focus:outline-none focus:ring-2 focus:ring-neutral-900/10 focus:border-neutral-300 placeholder:text-neutral-400 resize-y'
                            />
                            <p className='text-xs text-neutral-400 leading-snug'>
                                {t('dashboard.assignments.submissions.feedback.hint')}
                            </p>
                        </div>
                    )}

                    {/* Actions */}
                    <div className='flex flex-col gap-2 border-t border-neutral-100 pt-4'>
                        {!isUngraded && (
                            <>
                                <button type='button' onClick={finalizeAndComplete} className={`${BTN_PRIMARY} w-full`}>
                                    <Check size={16} />
                                    {t('dashboard.assignments.submissions.actions.finalize')}
                                </button>
                                <p className='text-xs text-neutral-500 leading-snug -mt-0.5 mb-1'>
                                    {t('dashboard.assignments.submissions.actions.finalize_description')}
                                </p>
                                <button type='button' onClick={gradeAssignment} className={`${BTN_SECONDARY} w-full`}>
                                    <BookOpenCheck size={16} />
                                    {t('dashboard.assignments.submissions.actions.set_final_grade')}
                                </button>
                                <p className='text-xs text-neutral-500 leading-snug -mt-0.5 mb-1'>
                                    {t('dashboard.assignments.submissions.actions.set_final_grade_description')}
                                </p>
                            </>
                        )}
                        <ConfirmationModal
                            confirmationButtonText={t('dashboard.assignments.submissions.actions.reject')}
                            confirmationMessage={t('dashboard.assignments.submissions.actions.reject_description')}
                            dialogTitle={t('dashboard.assignments.submissions.actions.reject')}
                            functionToExecute={rejectAssignment}
                            status='warning'
                            dialogTrigger={
                                <button
                                    type='button'
                                    title={t('dashboard.assignments.submissions.actions.reject_description')}
                                    className='inline-flex items-center justify-center gap-1.5 w-full h-10 px-4 rounded-xl text-sm font-semibold text-rose-700 hover:bg-rose-50 transition-colors'
                                >
                                    <X size={16} />
                                    {t('dashboard.assignments.submissions.actions.reject')}
                                </button>
                            }
                        />
                    </div>
                </aside>
            </div>
        </div>
    )
}

export default EvaluateAssignment
