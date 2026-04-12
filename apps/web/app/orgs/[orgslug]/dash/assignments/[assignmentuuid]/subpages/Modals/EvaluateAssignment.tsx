import { useAssignments } from '@components/Contexts/Assignments/AssignmentContext';
import { BookOpenCheck, Check, Download, Info, X } from 'lucide-react';
import Link from 'next/link';
import React from 'react'
import TaskQuizObject from '../../_components/TaskEditor/Subs/TaskTypes/TaskQuizObject';
import TaskFileObject from '../../_components/TaskEditor/Subs/TaskTypes/TaskFileObject';
import TaskFormObject from '../../_components/TaskEditor/Subs/TaskTypes/TaskFormObject';
import TaskCodeObject from '../../_components/TaskEditor/Subs/TaskTypes/TaskCodeObject';
import { useOrg } from '@components/Contexts/OrgContext';
import { getTaskRefFileDir } from '@services/media/media';
import { deleteUserSubmission, markActivityAsDoneForUser, putFinalGrade } from '@services/courses/assignments';
import { useLHSession } from '@components/Contexts/LHSessionContext';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';

function EvaluateAssignment({ user_id }: any) {
    const { t } = useTranslation()
    const assignments = useAssignments() as any;
    const session = useLHSession() as any;
    const org = useOrg() as any;

    async function gradeAssignment() {
        const res = await putFinalGrade(user_id, assignments?.assignment_object.assignment_uuid, session.data?.tokens?.access_token);
        if (res.success) {
            toast.success(res.data.message)
        }
        else {
            toast.error(res.data.message)
        }
    }

    async function finalizeAndComplete() {
        const gradeRes = await putFinalGrade(user_id, assignments?.assignment_object.assignment_uuid, session.data?.tokens?.access_token);
        if (!gradeRes.success) {
            toast.error(gradeRes.data.message)
            return
        }
        const doneRes = await markActivityAsDoneForUser(user_id, assignments?.assignment_object.assignment_uuid, session.data?.tokens?.access_token)
        if (doneRes.success) {
            toast.success(t('dashboard.assignments.submissions.toasts.finalize_success'))
        } else {
            toast.error(doneRes.data.message)
        }
    }

    async function rejectAssignment() {
        const res = await deleteUserSubmission(user_id, assignments?.assignment_object.assignment_uuid, session.data?.tokens?.access_token)
        toast.success(t('dashboard.assignments.submissions.toasts.reject_success'))
        window.location.reload()
    }

    const sortedTasks = assignments?.assignment_tasks?.slice().sort((a: any, b: any) => a.id - b.id) || [];

    return (
        <div className='flex flex-col min-h-fit'>
            {/* Tasks */}
            <div className='flex flex-col space-y-5 px-1 py-2'>
                {sortedTasks.map((task: any, index: number) => (
                    <div key={task.assignment_task_uuid} className='flex flex-col'>
                        {/* Task header */}
                        <div className='flex items-center justify-between pb-3'>
                            <div className='flex items-center space-x-2'>
                                <div className='bg-gray-900 text-white text-[10px] font-bold px-2 py-0.5 rounded-full'>
                                    {index + 1}
                                </div>
                                <p className='text-sm font-semibold text-gray-800'>{task.description || t('dashboard.assignments.submissions.task_label', { number: index + 1 })}</p>
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
                        </div>
                    </div>
                ))}
            </div>

            {/* Action bar */}
            <div className='flex items-center justify-between pt-4 mt-3 border-t border-gray-100'>
                <button
                    onClick={rejectAssignment}
                    className='flex items-center space-x-1.5 px-3.5 py-2 text-xs font-bold text-rose-700 bg-rose-50 rounded-lg nice-shadow hover:bg-rose-100/80 transition-colors cursor-pointer'
                >
                    <X size={14} />
                    <span>{t('dashboard.assignments.submissions.actions.reject')}</span>
                </button>

                <div className='flex items-center space-x-2'>
                    <button
                        onClick={gradeAssignment}
                        className='flex items-center space-x-1.5 px-3.5 py-2 text-xs font-bold text-gray-700 bg-gray-100 rounded-lg nice-shadow hover:bg-gray-200/80 transition-colors cursor-pointer'
                    >
                        <BookOpenCheck size={14} />
                        <span>{t('dashboard.assignments.submissions.actions.set_final_grade')}</span>
                    </button>
                    <button
                        onClick={finalizeAndComplete}
                        className='flex items-center space-x-1.5 px-3.5 py-2 text-xs font-bold bg-black text-white rounded-lg nice-shadow hover:bg-gray-800 transition-colors cursor-pointer'
                    >
                        <Check size={14} />
                        <span>{t('dashboard.assignments.submissions.actions.finalize')}</span>
                    </button>
                </div>
            </div>
        </div>
    )
}

export default EvaluateAssignment
