import { useAssignments } from '@components/Contexts/Assignments/AssignmentContext';
import { CaretDown, ChatCircleText, Check, ClipboardText, DownloadSimple, FloppyDisk, Lightbulb, UserCheck, X } from '@phosphor-icons/react';
import Link from 'next/link';
import React, { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/keys';
import { ConfirmDialog } from '@components/Dashboard/Shared/DashKit/DashKit';
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
import { BTN_PRIMARY, BTN_SECONDARY, Chip } from '../../../_components/assignmentUi'
import { TEXTAREA, buttonClass } from '@components/Dashboard/Shared/DashKit/DashKit'
import { TASK_TYPE_META } from '../../_components/Tasks'
import { AIGradePanel, aiGradingEnabled } from '../../_components/AIGrading'
import { AIChip } from '@components/Objects/AI/AIBrand'

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

// The learner, attempt and status now live in the modal header (see
// AssignmentSubmissionsSubPage), so `user`, `submission` and `statusChip`
// are accepted for compatibility but not rendered here.
function EvaluateAssignment({
    user_id,
    submission,
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

    const scrollRef = React.useRef<HTMLDivElement>(null);
    // Bumped after an AI grade is applied so every task view reloads the
    // score and feedback it fetched for this learner.
    const [taskReloadKey, setTaskReloadKey] = useState(0);
    const aiScored = new Set<string>(Array.isArray(gradePreview?.ai_scored_task_uuids) ? gradePreview.ai_scored_task_uuids : []);
    const onAIApplied = () => {
        setTaskReloadKey((k) => k + 1);
        refreshGradePreview(true);
    };
    const [openHints, setOpenHints] = useState<Record<string, boolean>>({});
    const [rejectOpen, setRejectOpen] = useState(false);
    const [busy, setBusy] = useState<'finalize' | 'grade' | null>(null);

    const run = async (kind: 'finalize' | 'grade', fn: () => Promise<void>) => {
        setBusy(kind);
        try { await fn(); } finally { setBusy(null); }
    };

    const jumpTo = (uuid: string) => {
        const el = scrollRef.current?.querySelector<HTMLElement>(`[data-task="${uuid}"]`);
        el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };

    const taskTone = (tb: any) =>
        !tb || isUngraded ? 'neutral' : !tb.submitted ? 'neutral' : tb.passed ? 'emerald' : 'rose';
    const TONE_DOT: Record<string, string> = {
        neutral: 'bg-neutral-300',
        emerald: 'bg-emerald-500',
        rose: 'bg-rose-500',
    };

    const percentage = typeof liveGrade?.percentage === 'number' ? Math.max(0, Math.min(100, liveGrade.percentage)) : 0;

    return (
        <div className='grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_340px] lg:h-full lg:min-h-0'>
            {/* Tasks */}
            <div ref={scrollRef} className='min-w-0 bg-neutral-50/70 lg:overflow-y-auto lg:min-h-0'>
                {sortedTasks.length > 1 && (
                    <nav
                        aria-label={t('dashboard.assignments.submissions.evaluate_modal.tasks_nav')}
                        className='sticky top-0 z-10 flex gap-1.5 overflow-x-auto px-5 py-3 bg-neutral-50/90 backdrop-blur border-b border-neutral-100'
                    >
                        {sortedTasks.map((task: any, index: number) => {
                            const tb = taskBreakdownByUuid[task.assignment_task_uuid];
                            return (
                                <button
                                    key={task.assignment_task_uuid}
                                    type='button'
                                    onClick={() => jumpTo(task.assignment_task_uuid)}
                                    className='inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-white ring-1 ring-inset ring-neutral-200 text-xs font-semibold text-neutral-700 hover:ring-neutral-300 whitespace-nowrap transition-colors'
                                >
                                    <span className={`w-1.5 h-1.5 rounded-full ${TONE_DOT[taskTone(tb)]}`} />
                                    <span className='tabular-nums'>{index + 1}</span>
                                    <span className='max-w-[140px] truncate font-medium text-neutral-500'>
                                        {task.title || t('dashboard.assignments.submissions.task_label', { number: index + 1 })}
                                    </span>
                                    {tb?.submitted && !isUngraded && (
                                        <span className='tabular-nums text-neutral-400'>{tb.percentage_display}</span>
                                    )}
                                </button>
                            );
                        })}
                    </nav>
                )}

                <div className='flex flex-col gap-4 p-2.5 sm:p-5'>
                    {sortedTasks.map((task: any, index: number) => {
                        const tb = taskBreakdownByUuid[task.assignment_task_uuid];
                        const meta = TASK_TYPE_META[task.assignment_type]
                        const TypeIcon = meta?.Icon
                        const hintOpen = !!openHints[task.assignment_task_uuid]
                        return (
                            <section
                                key={task.assignment_task_uuid}
                                data-task={task.assignment_task_uuid}
                                className='scroll-mt-16 rounded-2xl bg-white nice-shadow overflow-hidden'
                            >
                                <header className='flex flex-wrap items-start justify-between gap-3 px-3.5 sm:px-5 pt-4 pb-3 border-b border-neutral-100'>
                                    <div className='flex items-start gap-3 min-w-0'>
                                        <span className='w-7 h-7 rounded-lg bg-neutral-900 text-white text-xs font-bold flex items-center justify-center shrink-0 tabular-nums'>
                                            {index + 1}
                                        </span>
                                        <div className='min-w-0'>
                                            <p className='text-sm font-semibold text-neutral-900 break-words leading-7'>
                                                {task.title || task.description || t('dashboard.assignments.submissions.task_label', { number: index + 1 })}
                                            </p>
                                            {meta && TypeIcon && (
                                                <span className='inline-flex items-center gap-1 text-xs text-neutral-500'>
                                                    <TypeIcon size={12} />
                                                    {meta.labelKey ? t(meta.labelKey) : meta.label}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                    <div className='flex flex-wrap items-center gap-1.5'>
                                        {tb?.manually_graded && aiScored.has(task.assignment_task_uuid) && (
                                            <AIChip tone='soft'>{t('dashboard.assignments.ai_grading.task_chip')}</AIChip>
                                        )}
                                        {tb?.manually_graded && !aiScored.has(task.assignment_task_uuid) && (
                                            <Chip tone='sky' icon={<UserCheck size={12} weight='bold' />}>
                                                {t('dashboard.assignments.submissions.preview.manually_graded', { defaultValue: 'Manually graded' })}
                                            </Chip>
                                        )}
                                        {tb && !isUngraded && (
                                            <Chip tone={taskTone(tb) as any} className='tabular-nums'>
                                                {tb.submitted ? tb.percentage_display : t('dashboard.assignments.submissions.preview.not_submitted')}
                                            </Chip>
                                        )}
                                        {task.hint && (
                                            <button
                                                type='button'
                                                aria-expanded={hintOpen}
                                                onClick={() => setOpenHints((prev) => ({ ...prev, [task.assignment_task_uuid]: !hintOpen }))}
                                                className={`inline-flex items-center gap-1 h-7 px-2.5 rounded-lg text-xs font-semibold transition-colors ${hintOpen ? 'bg-amber-50 text-amber-700' : 'text-neutral-600 hover:bg-neutral-100'}`}
                                            >
                                                <Lightbulb size={13} />
                                                {t('dashboard.assignments.submissions.hint')}
                                                <CaretDown size={11} className={`transition-transform ${hintOpen ? 'rotate-180' : ''}`} />
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
                                                className='inline-flex items-center gap-1 h-7 px-2.5 rounded-lg text-xs font-semibold text-neutral-600 hover:bg-neutral-100 transition-colors'
                                            >
                                                <DownloadSimple size={13} />
                                                {t('dashboard.assignments.submissions.reference_document')}
                                            </Link>
                                        )}
                                    </div>
                                    {hintOpen && (
                                        <p className='basis-full rounded-xl bg-amber-50/70 px-3 py-2 text-xs text-amber-900 leading-relaxed'>{task.hint}</p>
                                    )}
                                </header>

                                {/* Task content (rendered by the task type component) */}
                                <div className='p-2 sm:p-5 min-w-0'>
                                    {task.assignment_type === 'QUIZ' && <TaskQuizObject key={`${task.assignment_task_uuid}-${taskReloadKey}`} view='grading' user_id={user_id} assignmentTaskUUID={task.assignment_task_uuid} onGraded={refreshGradePreview} />}
                                    {task.assignment_type === 'FILE_SUBMISSION' && <TaskFileObject key={`${task.assignment_task_uuid}-${taskReloadKey}`} view='custom-grading' user_id={user_id} assignmentTaskUUID={task.assignment_task_uuid} onGraded={refreshGradePreview} />}
                                    {task.assignment_type === 'FORM' && <TaskFormObject key={`${task.assignment_task_uuid}-${taskReloadKey}`} view='grading' user_id={user_id} assignmentTaskUUID={task.assignment_task_uuid} onGraded={refreshGradePreview} />}
                                    {task.assignment_type === 'CODE' && <TaskCodeObject key={`${task.assignment_task_uuid}-${taskReloadKey}`} view='grading' user_id={user_id} assignmentTaskUUID={task.assignment_task_uuid} onGraded={refreshGradePreview} />}
                                    {task.assignment_type === 'SHORT_ANSWER' && <TaskShortAnswerObject key={`${task.assignment_task_uuid}-${taskReloadKey}`} view='grading' user_id={user_id} assignmentTaskUUID={task.assignment_task_uuid} onGraded={refreshGradePreview} />}
                                    {task.assignment_type === 'NUMBER_ANSWER' && <TaskNumberAnswerObject key={`${task.assignment_task_uuid}-${taskReloadKey}`} view='grading' user_id={user_id} assignmentTaskUUID={task.assignment_task_uuid} onGraded={refreshGradePreview} />}
                                </div>
                            </section>
                        );
                    })}
                </div>
            </div>

            {/* Grading rail: its own column on desktop, follows the tasks on phones */}
            <aside className='flex flex-col border-t lg:border-t-0 lg:border-s border-neutral-100 bg-white lg:min-h-0'>
                <div className='flex-1 lg:overflow-y-auto p-5 flex flex-col gap-5'>
                    {isUngraded ? (
                        <div className='flex items-start gap-3 rounded-2xl bg-sky-50/60 p-4'>
                            <span className='w-9 h-9 rounded-xl bg-white text-sky-700 flex items-center justify-center shrink-0 shadow-sm'>
                                <ClipboardText size={18} />
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
                        <div className='rounded-2xl bg-neutral-50 p-4'>
                            <p className='text-xs font-medium text-neutral-500'>{t('dashboard.assignments.submissions.preview.current_grade')}</p>
                            {liveGrade ? (
                                <>
                                    <div className='mt-2 flex items-end justify-between gap-3'>
                                        <span className={`text-4xl font-bold tracking-tight tabular-nums leading-none ${liveGrade.passed ? 'text-emerald-600' : 'text-rose-600'}`}>
                                            {liveGrade.display_grade}
                                        </span>
                                        <Chip tone={liveGrade.passed ? 'emerald' : 'rose'}>
                                            {liveGrade.passed
                                                ? t('dashboard.assignments.submissions.preview.passing')
                                                : t('dashboard.assignments.submissions.preview.not_passing')}
                                        </Chip>
                                    </div>
                                    <div className='mt-3 h-2 rounded-full bg-neutral-200/70 overflow-hidden'>
                                        <div
                                            className={`h-full rounded-full transition-[width] duration-500 ${liveGrade.passed ? 'bg-emerald-500' : 'bg-rose-500'}`}
                                            style={{ width: `${percentage}%` }}
                                        />
                                    </div>
                                    <div className='mt-2 flex items-center justify-between text-xs text-neutral-500 tabular-nums'>
                                        <span>{liveGrade.points_summary}</span>
                                        <span>{liveGrade.percentage_display}</span>
                                    </div>
                                </>
                            ) : (
                                <div className='mt-2 space-y-2'>
                                    <div className='h-9 w-24 rounded-lg bg-neutral-200/60 animate-pulse' />
                                    <div className='h-2 w-full rounded-full bg-neutral-200/60 animate-pulse' />
                                </div>
                            )}
                        </div>
                    )}

                    {!isUngraded && aiGradingEnabled(assignments?.assignment_object) && access_token && (
                        <AIGradePanel
                            key={`ai-${user_id}`}
                            userId={user_id}
                            assignment={assignments.assignment_object}
                            accessToken={access_token}
                            submissionStatus={submission?.submission_status}
                            onApplied={onAIApplied}
                        />
                    )}

                    {/* Per-task breakdown, so the score above is never a mystery */}
                    {!isUngraded && gradePreview?.tasks?.length > 0 && (
                        <ul className='flex flex-col gap-1'>
                            {sortedTasks.map((task: any, index: number) => {
                                const tb = taskBreakdownByUuid[task.assignment_task_uuid];
                                if (!tb) return null;
                                return (
                                    <li key={task.assignment_task_uuid}>
                                        <button
                                            type='button'
                                            onClick={() => jumpTo(task.assignment_task_uuid)}
                                            className='w-full flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-start hover:bg-neutral-50 transition-colors'
                                        >
                                            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${TONE_DOT[taskTone(tb)]}`} />
                                            <span className='flex-1 min-w-0 truncate text-xs text-neutral-600'>
                                                {task.title || t('dashboard.assignments.submissions.task_label', { number: index + 1 })}
                                            </span>
                                            <span className='text-xs font-semibold text-neutral-900 tabular-nums'>
                                                {tb.submitted ? `${tb.grade ?? 0}/${tb.max_grade ?? 0}` : '—'}
                                            </span>
                                        </button>
                                    </li>
                                );
                            })}
                        </ul>
                    )}

                    {/* Overall feedback. Only the grading endpoint persists it, and that
                        endpoint refuses a formative assignment, so on one, this box
                        could never deliver anything to the learner. */}
                    {!isUngraded && (
                        <div className='flex flex-col gap-1.5'>
                            <label htmlFor={`overall-feedback-${user_id}`} className='flex items-center gap-1.5 text-sm font-semibold text-neutral-900'>
                                <ChatCircleText size={15} className='text-neutral-400' />
                                {t('dashboard.assignments.submissions.feedback.label')}
                                <span className='text-xs font-normal text-neutral-400'>
                                    {t('dashboard.assignments.submissions.feedback.optional')}
                                </span>
                            </label>
                            <textarea
                                id={`overall-feedback-${user_id}`}
                                value={feedback ?? ''}
                                onChange={(e) => setFeedback(e.target.value)}
                                placeholder={t('dashboard.assignments.submissions.feedback.placeholder')}
                                rows={5}
                                className={`${TEXTAREA} resize-y`}
                            />
                            <p className='text-xs text-neutral-400 leading-snug'>
                                {t('dashboard.assignments.submissions.feedback.hint')}
                            </p>
                        </div>
                    )}
                </div>

                {/* Actions, pinned to the bottom of the rail */}
                <div className='shrink-0 flex flex-col gap-2 p-4 border-t border-neutral-100 bg-neutral-50/60'>
                    {!isUngraded && (
                        <>
                            <button
                                type='button'
                                onClick={() => run('finalize', finalizeAndComplete)}
                                disabled={!!busy}
                                title={t('dashboard.assignments.submissions.actions.finalize_description')}
                                className={`${BTN_PRIMARY} w-full`}
                            >
                                <Check size={14} weight='bold' />
                                {t('dashboard.assignments.submissions.actions.finalize')}
                            </button>
                            <button
                                type='button'
                                onClick={() => run('grade', gradeAssignment)}
                                disabled={!!busy}
                                title={t('dashboard.assignments.submissions.actions.set_final_grade_description')}
                                className={`${BTN_SECONDARY} w-full`}
                            >
                                <FloppyDisk size={14} />
                                {t('dashboard.assignments.submissions.actions.set_final_grade')}
                            </button>
                        </>
                    )}
                    <button
                        type='button'
                        onClick={() => setRejectOpen(true)}
                        disabled={!!busy}
                        title={t('dashboard.assignments.submissions.actions.reject_description')}
                        className={buttonClass('danger-ghost', 'md', 'w-full')}
                    >
                        <X size={15} weight='bold' />
                        {t('dashboard.assignments.submissions.actions.reject')}
                    </button>
                </div>
            </aside>

            <ConfirmDialog
                open={rejectOpen}
                onOpenChange={setRejectOpen}
                title={t('dashboard.assignments.submissions.actions.reject')}
                message={t('dashboard.assignments.submissions.actions.reject_description')}
                confirmLabel={t('dashboard.assignments.submissions.actions.reject')}
                onConfirm={rejectAssignment}
            />
        </div>
    )
}

export default EvaluateAssignment
