'use client';
import { useAssignments } from '@components/Contexts/Assignments/AssignmentContext';
import { useAssignmentsTask, useAssignmentsTaskDispatch } from '@components/Contexts/Assignments/AssignmentsTaskContext';
import { useLHSession } from '@components/Contexts/LHSessionContext';
import ConfirmationModal from '@components/Objects/StyledElements/ConfirmationModal/ConfirmationModal';
import { deleteAssignmentTask } from '@services/courses/assignments';
import { ClipboardList, SlidersHorizontal, SquarePen, Trash2, Type } from 'lucide-react'
import React from 'react'
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/keys';
import dynamic from 'next/dynamic';
import { sortTasksByOrder } from '@/lib/assignments/taskOrder'
import { AssignmentTaskGeneralEdit } from './Subs/AssignmentTaskGeneralEdit';
import { TASK_TYPE_META, TaskCreateActions } from '../Tasks';
const AssignmentTaskContentEdit = dynamic(() => import('./Subs/AssignmentTaskContentEdit'))

type EditorTab = 'content' | 'general'

function AssignmentTaskEditor({ page }: { page?: EditorTab }) {
    const { t } = useTranslation()
    const [selectedSubPage, setSelectedSubPage] = React.useState<EditorTab>(page ?? 'content')
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

    // Go back to the content tab whenever a different task is opened
    // (adjusting state during render rather than in an effect).
    const selectedUUID = assignmentTaskState.selectedAssignmentTaskUUID
    const [tabTaskUUID, setTabTaskUUID] = React.useState(selectedUUID)
    if (tabTaskUUID !== selectedUUID) {
        setTabTaskUUID(selectedUUID)
        setSelectedSubPage('content')
    }

    const task = assignmentTaskState.assignmentTask
    const hasTask = task && Object.keys(task).length > 0
    const tasks: any[] = sortTasksByOrder(assignment?.assignment_tasks)
    const taskIndex = hasTask ? tasks.findIndex((x: any) => x.assignment_task_uuid === task.assignment_task_uuid) : -1
    const meta = hasTask ? (TASK_TYPE_META[task.assignment_type] ?? { label: task.assignment_type, Icon: Type }) : null
    const TypeIcon = meta?.Icon

    const tabs: { key: EditorTab; label: string; Icon: React.ComponentType<{ size?: number }> }[] = [
        { key: 'content', label: t('dashboard.assignments.editor.task_tabs.content'), Icon: SquarePen },
        { key: 'general', label: t('dashboard.assignments.editor.task_tabs.general'), Icon: SlidersHorizontal },
    ]

    return (
        <div className='flex flex-col w-full min-w-0 lg:h-full lg:min-h-0'>
            {hasTask && meta && TypeIcon && (
                <div className='flex-1 lg:min-h-0 lg:overflow-y-auto'>
                    <div className='max-w-4xl mx-auto px-3 sm:px-6 lg:px-8 py-4 sm:py-6'>
                        <section className='bg-white rounded-2xl nice-shadow'>
                            {/* Task header */}
                            <div className='flex items-start justify-between gap-3 px-4 sm:px-6 pt-5'>
                                <div className='flex items-start gap-3 min-w-0'>
                                    <span className='w-10 h-10 rounded-xl bg-neutral-900 text-white flex items-center justify-center shrink-0'>
                                        <TypeIcon size={18} />
                                    </span>
                                    <div className='min-w-0'>
                                        <p className='text-xs text-neutral-500 tabular-nums'>
                                            {taskIndex >= 0 && t('dashboard.assignments.editor.task_position', { number: taskIndex + 1, total: tasks.length })}
                                            {taskIndex >= 0 && ' · '}
                                            {meta.labelKey ? t(meta.labelKey) : meta.label}
                                            {typeof task.max_grade_value === 'number' && (
                                                <> · {t('dashboard.assignments.editor.points_short', { points: task.max_grade_value })}</>
                                            )}
                                        </p>
                                        <h2 className='text-lg font-semibold text-neutral-900 leading-snug break-words'>
                                            {task.title || <span className='text-neutral-400 italic font-normal'>{t('dashboard.assignments.editor.untitled_task')}</span>}
                                        </h2>
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
                                            className='inline-flex items-center gap-1.5 h-9 px-2.5 sm:px-3 rounded-xl text-sm font-semibold text-rose-700 hover:bg-rose-50 transition-colors shrink-0'
                                        >
                                            <Trash2 size={16} />
                                            <span className='hidden sm:inline'>{t('dashboard.assignments.editor.delete_task')}</span>
                                        </button>
                                    }
                                />
                            </div>

                            {/* Tabs */}
                            <div className='mt-3 px-4 sm:px-6 flex gap-5 border-b border-neutral-100' role='tablist'>
                                {tabs.map(({ key, label, Icon }) => {
                                    const active = selectedSubPage === key
                                    return (
                                        <button
                                            key={key}
                                            type='button'
                                            role='tab'
                                            aria-selected={active}
                                            onClick={() => setSelectedSubPage(key)}
                                            className={`-mb-px flex items-center gap-1.5 py-2.5 text-sm font-semibold border-b-2 transition-colors ${
                                                active ? 'border-neutral-900 text-neutral-900' : 'border-transparent text-neutral-500 hover:text-neutral-800'
                                            }`}
                                        >
                                            <Icon size={15} />
                                            {label}
                                        </button>
                                    )
                                })}
                            </div>

                            {/* Body */}
                            <div className='px-3 sm:px-6 py-4 sm:py-5'>
                                {selectedSubPage === 'general' && <AssignmentTaskGeneralEdit />}
                                {selectedSubPage === 'content' && <AssignmentTaskContentEdit />}
                            </div>
                        </section>
                    </div>
                </div>
            )}

            {!hasTask && assignment && tasks.length === 0 && (
                <div className='flex flex-1 items-center justify-center px-4 py-10 lg:py-6'>
                    <div className='w-full max-w-md bg-white rounded-2xl nice-shadow px-6 py-8 text-center'>
                        <div className='mx-auto w-12 h-12 rounded-2xl bg-neutral-100 text-neutral-500 flex items-center justify-center'>
                            <ClipboardList size={22} />
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
                <div className='max-w-4xl w-full mx-auto px-3 sm:px-6 lg:px-8 py-4 sm:py-6' aria-busy='true'>
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
