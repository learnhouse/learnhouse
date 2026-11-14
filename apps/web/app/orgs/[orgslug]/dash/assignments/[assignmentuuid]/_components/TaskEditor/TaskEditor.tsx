'use client';
import { useAssignments } from '@components/Contexts/Assignments/AssignmentContext';
import { buttonClass } from '@components/Dashboard/Shared/DashKit/DashKit'
import { useAssignmentsTask, useAssignmentsTaskDispatch } from '@components/Contexts/Assignments/AssignmentsTaskContext';
import { useLHSession } from '@components/Contexts/LHSessionContext';
import ConfirmationModal from '@components/Objects/StyledElements/ConfirmationModal/ConfirmationModal';
import { deleteAssignmentTask } from '@services/courses/assignments';
import { ClipboardText, TextT, Trash } from '@phosphor-icons/react'
import React from 'react'
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/keys';
import dynamic from 'next/dynamic';
import { sortTasksByOrder } from '@/lib/assignments/taskOrder'
import { TaskDetailsRow, TaskTitleAndDescription } from './Subs/TaskInlineDetails';
import { TASK_TYPE_META, TaskCreateActions } from '../Tasks';
const AssignmentTaskContentEdit = dynamic(() => import('./Subs/AssignmentTaskContentEdit'))

// The task's title, instructions, hint and reference file are edited inline
// in the header, so the editor is a single view with no tabs. `page` is
// accepted for old callers and ignored.
function AssignmentTaskEditor(_props: { page?: string }) {
    const { t } = useTranslation()
    const assignment = useAssignments() as any
    const assignmentTaskState = useAssignmentsTask() as any
    const assignmentTaskStateHook = useAssignmentsTaskDispatch() as any
    const session = useLHSession() as any;
    const access_token = session?.data?.tokens?.access_token;
    const queryClient = useQueryClient();

    async function deleteTaskUI() {
        const res = await deleteAssignmentTask(assignmentTaskState.assignmentTask.assignment_task_uuid, assignment.assignment_object.assignment_uuid, access_token)
        if (res) {
            assignmentTaskStateHook({
                type: 'SET_MULTIPLE_STATES',
                payload: {
                    selectedAssignmentTaskUUID: null,
                    assignmentTask: {},
                },
            });
            queryClient.invalidateQueries({ queryKey: queryKeys.assignments.tasks(assignment.assignment_object.assignment_uuid) })
            queryClient.invalidateQueries({ queryKey: queryKeys.assignments.detail(assignment.assignment_object.assignment_uuid) })
            toast.success(t('dashboard.assignments.editor.toasts.task_deleted'))
        } else {
            toast.error(t('dashboard.assignments.editor.toasts.task_delete_error'))
        }
    }

    const task = assignmentTaskState.assignmentTask
    const hasTask = task && Object.keys(task).length > 0
    const tasks: any[] = sortTasksByOrder(assignment?.assignment_tasks)
    const taskIndex = hasTask ? tasks.findIndex((x: any) => x.assignment_task_uuid === task.assignment_task_uuid) : -1
    const meta = hasTask ? (TASK_TYPE_META[task.assignment_type] ?? { label: task.assignment_type, Icon: TextT }) : null
    const TypeIcon = meta?.Icon

    return (
        <div className='flex flex-col w-full min-w-0 lg:h-full lg:min-h-0'>
            {hasTask && meta && TypeIcon && (
                <div className='flex-1 lg:min-h-0 lg:overflow-y-auto'>
                    <div className='w-full px-4 sm:px-6 lg:px-10 pt-5 sm:pt-6 pb-10'>
                        <section className='bg-white rounded-2xl nice-shadow'>
                            {/* Task header: everything here is editable in place */}
                            <div className='flex items-start justify-between gap-3 px-4 sm:px-6 pt-5'>
                                <div className='flex items-start gap-3 min-w-0 flex-1'>
                                    <span className='w-10 h-10 rounded-xl bg-neutral-900 text-white flex items-center justify-center shrink-0'>
                                        <TypeIcon size={18} />
                                    </span>
                                    <div className='min-w-0 flex-1'>
                                        <p className='text-xs text-neutral-500 tabular-nums'>
                                            {taskIndex >= 0 && t('dashboard.assignments.editor.task_position', { number: taskIndex + 1, total: tasks.length })}
                                            {taskIndex >= 0 && ' · '}
                                            {meta.labelKey ? t(meta.labelKey) : meta.label}
                                            {typeof task.max_grade_value === 'number' && (
                                                <> · {t('dashboard.assignments.editor.points_short', { points: task.max_grade_value })}</>
                                            )}
                                        </p>
                                        <TaskTitleAndDescription />
                                    </div>
                                </div>
                                <ConfirmationModal
                                    confirmationButtonText={t('dashboard.assignments.editor.delete_task')}
                                    confirmationMessage={t('dashboard.assignments.editor.delete_task_confirm')}
                                    dialogTitle={t('dashboard.assignments.editor.delete_task')}
                                    functionToExecute={deleteTaskUI}
                                    status='warning'
                                    dialogTrigger={
                                        <button
                                            type='button'
                                            aria-label={t('dashboard.assignments.editor.delete_task')}
                                            className={buttonClass('danger-ghost', 'md', 'shrink-0')}
                                        >
                                            <Trash size={14} />
                                            <span className='hidden sm:inline'>{t('dashboard.assignments.editor.delete_task')}</span>
                                        </button>
                                    }
                                />
                            </div>
                            <div className='px-4 sm:px-6 pt-3 pb-4 sm:ps-[76px] border-b border-neutral-100'>
                                <TaskDetailsRow />
                            </div>

                            {/* Body */}
                            <div className='px-3 sm:px-6 py-4 sm:py-5'>
                                <AssignmentTaskContentEdit />
                            </div>
                        </section>
                    </div>
                </div>
            )}

            {!hasTask && assignment && tasks.length === 0 && (
                <div className='w-full px-4 sm:px-6 lg:px-10 pt-5 sm:pt-6 pb-10'>
                    <div className='w-full bg-white rounded-2xl nice-shadow px-6 py-12 text-center'>
                        <div className='mx-auto w-12 h-12 rounded-2xl bg-neutral-100 text-neutral-500 flex items-center justify-center'>
                            <ClipboardText size={22} />
                        </div>
                        <h2 className='mt-4 text-base font-semibold text-neutral-900'>{t('dashboard.assignments.editor.empty_title')}</h2>
                        <p className='mt-1 text-sm text-neutral-500'>{t('dashboard.assignments.editor.empty_description')}</p>
                        <div className='mt-5'>
                            <TaskCreateActions assignment_uuid={assignment.assignment_object.assignment_uuid} layout='row' />
                        </div>
                    </div>
                </div>
            )}

            {/* A task is being opened (first one is selected automatically). */}
            {!hasTask && tasks.length > 0 && (
                <div className='w-full px-4 sm:px-6 lg:px-10 pt-5 sm:pt-6 pb-10' aria-busy='true'>
                    <div className='bg-white rounded-2xl nice-shadow p-6 animate-pulse space-y-4'>
                        <div className='flex items-center gap-3'>
                            <div className='w-10 h-10 rounded-xl bg-neutral-100' />
                            <div className='space-y-2 flex-1'>
                                <div className='h-3 w-32 bg-neutral-100 rounded' />
                                <div className='h-4 w-56 bg-neutral-100 rounded' />
                            </div>
                        </div>
                        <div className='h-px bg-neutral-100' />
                        <div className='h-24 bg-neutral-50 rounded-xl' />
                        <div className='h-24 bg-neutral-50 rounded-xl' />
                    </div>
                </div>
            )}
        </div>
    )
}

export default AssignmentTaskEditor
