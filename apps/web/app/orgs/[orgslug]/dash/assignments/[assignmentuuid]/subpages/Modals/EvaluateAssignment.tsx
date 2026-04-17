import { useAssignments } from '@components/Contexts/Assignments/AssignmentContext';
import { BookOpenCheck, Check, CircleHelp, Download, Info, MessageSquare, X } from 'lucide-react';
import Link from 'next/link';
import React, { useEffect, useState } from 'react'
import { mutate } from 'swr';
import { getAPIUrl } from '@services/config/config';
import ConfirmationModal from '@components/Objects/StyledElements/ConfirmationModal/ConfirmationModal';
import ToolTip from '@components/Objects/StyledElements/Tooltip/Tooltip';
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

function EvaluateAssignment({ user_id }: any) {
    const { t } = useTranslation()
    const assignments = useAssignments() as any;
    const session = useLHSession() as any;
    const org = useOrg() as any;
    const access_token = session?.data?.tokens?.access_token;

    // Overall feedback the teacher types. `undefined` means "not touched yet"
    // so we don't clobber existing server-side feedback with an empty string.
    const [feedback, setFeedback] = useState<string | undefined>(undefined);
    // Grade preview shown at the top of the modal so the teacher can see what
    // the current per-task scores translate to before finalizing.
    const [gradePreview, setGradePreview] = useState<any>(null);

    const assignmentUuid = assignments?.assignment_object?.assignment_uuid;

    // Load any existing grade + feedback when the modal opens so the teacher
    // can edit them instead of starting from scratch.
    useEffect(() => {
        if (!assignmentUuid || !user_id || !access_token) return;
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
    }, [assignmentUuid, user_id, access_token]);

    async function gradeAssignment() {
        const res = await putFinalGrade(user_id, assignmentUuid, access_token, feedback ?? null);
        if (res.success) {
            setGradePreview(res.data);
            toast.success(res.data.message)
        }
        else {
            toast.error(res.data.message)
        }
    }

    async function finalizeAndComplete() {
        const gradeRes = await putFinalGrade(user_id, assignmentUuid, access_token, feedback ?? null);
        if (!gradeRes.success) {
            toast.error(gradeRes.data.message)
            return
        }
        setGradePreview(gradeRes.data);
        const doneRes = await markActivityAsDoneForUser(user_id, assignmentUuid, access_token)
        if (doneRes.success) {
            toast.success(t('dashboard.assignments.submissions.toasts.finalize_success'))
        } else {
            toast.error(doneRes.data.message)
        }
    }

    async function rejectAssignment() {
        const res = await deleteUserSubmission(user_id, assignmentUuid, access_token)
        if (!res.success) {
            toast.error(res.data?.detail || t('dashboard.assignments.submissions.toasts.reject_success'))
            return
        }
        toast.success(t('dashboard.assignments.submissions.toasts.reject_success'))
        // Revalidate the submissions list + this user's submission + grade
        // caches instead of a hard reload, so the modal can close cleanly and
        // the list below reflects the rollback (status gone, activity marked
        // incomplete, certificate revoked) without a page refresh.
        mutate(
            (key: any) =>
                typeof key === 'string' &&
                (
                    key.includes(`assignments/${assignmentUuid}/submissions`) ||
                    key.includes(`assignments/${assignmentUuid}/tasks/submissions`)
                ),
            undefined,
            { revalidate: true }
        )
        setGradePreview(null)
    }

    const sortedTasks = assignments?.assignment_tasks?.slice().sort((a: any, b: any) => a.id - b.id) || [];

    // Build a uuid → per-task breakdown map from the backend's `tasks` array
    // so we can render "85%" badges next to each task header. Memoizing with
    // useMemo would be overkill here — the array is tiny.
    const taskBreakdownByUuid: Record<string, any> = {};
    if (gradePreview?.tasks) {
        for (const tb of gradePreview.tasks) {
            taskBreakdownByUuid[tb.assignment_task_uuid] = tb;
        }
    }

    return (
        <div className='flex flex-col min-h-fit'>
            {/* Grade preview */}
            {gradePreview && (
                <div className='flex items-center justify-between bg-white nice-shadow rounded-xl px-5 py-3 mb-4'>
                    <div className='flex items-center space-x-3'>
                        <div className={`rounded-lg px-3 py-1.5 text-lg font-bold ${gradePreview.passed ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>
                            {gradePreview.display_grade}
                        </div>
                        <div className='flex flex-col'>
                            <p className='text-[10px] uppercase tracking-wider font-semibold text-gray-400'>
                                {t('dashboard.assignments.submissions.preview.current_grade')}
                            </p>
                            <p className='text-xs text-gray-600 font-medium'>
                                {gradePreview.points_summary} · {gradePreview.percentage_display}
                            </p>
                        </div>
                    </div>
                    <div className={`text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded-full ${gradePreview.passed ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
                        {gradePreview.passed
                            ? t('dashboard.assignments.submissions.preview.passing')
                            : t('dashboard.assignments.submissions.preview.not_passing')}
                    </div>
                </div>
            )}

            {/* Tasks */}
            <div className='flex flex-col space-y-5 px-1 py-2'>
                {sortedTasks.map((task: any, index: number) => {
                    const tb = taskBreakdownByUuid[task.assignment_task_uuid];
                    // Use the server's passed flag so the per-task chip uses
                    // the same grading-type-aware threshold as the overall
                    // grade (50% for numeric/pass-fail, 60% for alphabet/GPA).
                    const taskPassed = tb && tb.submitted && tb.passed;
                    const taskSubmitted = tb && tb.submitted;
                    return (
                    <div key={task.assignment_task_uuid} className='flex flex-col'>
                        {/* Task header */}
                        <div className='flex items-center justify-between pb-3'>
                            <div className='flex items-center space-x-2'>
                                <div className='bg-gray-900 text-white text-[10px] font-bold px-2 py-0.5 rounded-full'>
                                    {index + 1}
                                </div>
                                <p className='text-sm font-semibold text-gray-800'>{task.description || t('dashboard.assignments.submissions.task_label', { number: index + 1 })}</p>
                                {tb && (
                                    <div className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                                        !taskSubmitted
                                            ? 'bg-gray-100 text-gray-500'
                                            : taskPassed
                                                ? 'bg-emerald-50 text-emerald-700'
                                                : 'bg-rose-50 text-rose-700'
                                    }`}>
                                        {taskSubmitted
                                            ? tb.percentage_display
                                            : t('dashboard.assignments.submissions.preview.not_submitted')}
                                    </div>
                                )}
                            </div>
                            <div className='flex items-center space-x-2'>
                                {task.hint && (
                                    <button
                                        onClick={() => toast(task.hint, { icon: 'ℹ️' })}
                                        className='flex items-center space-x-1 px-2.5 py-1 text-xs font-semibold text-amber-700 bg-amber-50 rounded-full nice-shadow hover:bg-amber-100/80 transition-colors cursor-pointer'
                                    >
                                        <Info size={11} />
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
                                        className='flex items-center space-x-1 px-2.5 py-1 text-xs font-semibold text-cyan-700 bg-cyan-50 rounded-full nice-shadow hover:bg-cyan-100/80 transition-colors'
                                    >
                                        <Download size={11} />
                                        <span>{t('dashboard.assignments.submissions.reference_document')}</span>
                                    </Link>
                                )}
                            </div>
                        </div>

                        {/* Task content */}
                        <div className='rounded-xl overflow-hidden'>
                            {task.assignment_type === 'QUIZ' && <TaskQuizObject key={task.assignment_task_uuid} view='grading' user_id={user_id} assignmentTaskUUID={task.assignment_task_uuid} />}
                            {task.assignment_type === 'FILE_SUBMISSION' && <TaskFileObject key={task.assignment_task_uuid} view='custom-grading' user_id={user_id} assignmentTaskUUID={task.assignment_task_uuid} />}
                            {task.assignment_type === 'FORM' && <TaskFormObject key={task.assignment_task_uuid} view='grading' user_id={user_id} assignmentTaskUUID={task.assignment_task_uuid} />}
                            {task.assignment_type === 'CODE' && <TaskCodeObject key={task.assignment_task_uuid} view='grading' user_id={user_id} assignmentTaskUUID={task.assignment_task_uuid} />}
                            {task.assignment_type === 'SHORT_ANSWER' && <TaskShortAnswerObject key={task.assignment_task_uuid} view='grading' user_id={user_id} assignmentTaskUUID={task.assignment_task_uuid} />}
                            {task.assignment_type === 'NUMBER_ANSWER' && <TaskNumberAnswerObject key={task.assignment_task_uuid} view='grading' user_id={user_id} assignmentTaskUUID={task.assignment_task_uuid} />}
                        </div>
                    </div>
                    );
                })}
            </div>

            {/* Overall feedback */}
            <div className='flex flex-col space-y-2 pt-5 mt-3 border-t border-gray-100'>
                <div className='flex items-center space-x-1.5 text-gray-700'>
                    <MessageSquare size={14} />
                    <p className='text-sm font-bold'>{t('dashboard.assignments.submissions.feedback.label')}</p>
                    <span className='text-[10px] text-gray-400 font-medium'>
                        ({t('dashboard.assignments.submissions.feedback.optional')})
                    </span>
                </div>
                <textarea
                    value={feedback ?? ''}
                    onChange={(e) => setFeedback(e.target.value)}
                    placeholder={t('dashboard.assignments.submissions.feedback.placeholder')}
                    rows={3}
                    className='w-full px-3 py-2 text-sm bg-white nice-shadow rounded-lg focus:outline-none focus:ring-2 focus:ring-black/5 placeholder:text-gray-400 resize-none'
                />
                <p className='text-[10px] text-gray-400 leading-tight'>
                    {t('dashboard.assignments.submissions.feedback.hint')}
                </p>
            </div>

            {/* Action bar */}
            <div className='flex items-center justify-between pt-4 mt-3 border-t border-gray-100'>
                <div className='flex items-center space-x-1.5'>
                    <ConfirmationModal
                        confirmationButtonText={t('dashboard.assignments.submissions.actions.reject')}
                        confirmationMessage={t('dashboard.assignments.submissions.actions.reject_description')}
                        dialogTitle={t('dashboard.assignments.submissions.actions.reject')}
                        functionToExecute={rejectAssignment}
                        status='warning'
                        dialogTrigger={
                            <button
                                className='flex items-center space-x-1.5 px-3.5 py-2 text-xs font-bold text-rose-700 bg-rose-50 rounded-lg nice-shadow hover:bg-rose-100/80 transition-colors cursor-pointer'
                            >
                                <X size={14} />
                                <span>{t('dashboard.assignments.submissions.actions.reject')}</span>
                            </button>
                        }
                    />
                    <ToolTip side='top' slateBlack sideOffset={6} content={t('dashboard.assignments.submissions.actions.reject_description')}>
                        <div className='text-rose-300 hover:text-rose-500 transition-colors cursor-help'>
                            <CircleHelp size={14} />
                        </div>
                    </ToolTip>
                </div>

                <div className='flex items-center space-x-3'>
                    <div className='flex items-center space-x-1.5'>
                        <button
                            onClick={gradeAssignment}
                            className='flex items-center space-x-1.5 px-3.5 py-2 text-xs font-bold text-gray-700 bg-gray-100 rounded-lg nice-shadow hover:bg-gray-200/80 transition-colors cursor-pointer'
                        >
                            <BookOpenCheck size={14} />
                            <span>{t('dashboard.assignments.submissions.actions.set_final_grade')}</span>
                        </button>
                        <ToolTip side='top' slateBlack sideOffset={6} content={t('dashboard.assignments.submissions.actions.set_final_grade_description')}>
                            <div className='text-gray-300 hover:text-gray-500 transition-colors cursor-help'>
                                <CircleHelp size={14} />
                            </div>
                        </ToolTip>
                    </div>
                    <div className='flex items-center space-x-1.5'>
                        <button
                            onClick={finalizeAndComplete}
                            className='flex items-center space-x-1.5 px-3.5 py-2 text-xs font-bold bg-black text-white rounded-lg nice-shadow hover:bg-gray-800 transition-colors cursor-pointer'
                        >
                            <Check size={14} />
                            <span>{t('dashboard.assignments.submissions.actions.finalize')}</span>
                        </button>
                        <ToolTip side='top' slateBlack sideOffset={6} content={t('dashboard.assignments.submissions.actions.finalize_description')}>
                            <div className='text-gray-300 hover:text-gray-500 transition-colors cursor-help'>
                                <CircleHelp size={14} />
                            </div>
                        </ToolTip>
                    </div>
                </div>
            </div>
        </div>
    )
}

export default EvaluateAssignment
