import { useAssignments } from '@components/Contexts/Assignments/AssignmentContext'
import Modal from '@components/Objects/StyledElements/Modal/Modal';
import { Code2, FileUp, GripVertical, Hash, ListTodo, Pencil, Plus, Sparkles, Type } from 'lucide-react';
import React, { useEffect } from 'react'
import { DragDropContext, Draggable, Droppable, type DropResult } from '@hello-pangea/dnd'
import { useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import NewTaskModal from './Modals/NewTaskModal';
import GenerateTasksAIModal from './Modals/GenerateTasksAIModal';
import { useAssignmentsTask, useAssignmentsTaskDispatch } from '@components/Contexts/Assignments/AssignmentsTaskContext';
import { useTranslation } from 'react-i18next';
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { queryKeys } from '@/lib/query/keys'
import { moveTask, sortTasksByOrder } from '@/lib/assignments/taskOrder'
import { reorderAssignmentTasks } from '@services/courses/assignments'
import { BTN_PRIMARY, BTN_SECONDARY } from '../../_components/assignmentUi'

// The API caps an assignment at this many tasks; past it the add actions hide.
export const MAX_TASKS = 10

export const TASK_TYPE_META: Record<string, { label: string; labelKey?: string; Icon: React.ComponentType<{ size?: number; className?: string }> }> = {
    QUIZ: { label: 'Quiz', labelKey: 'dashboard.assignments.editor.task_type_labels.quiz', Icon: ListTodo },
    FILE_SUBMISSION: { label: 'File upload', labelKey: 'dashboard.assignments.editor.task_type_labels.file_submission', Icon: FileUp },
    FORM: { label: 'Form', labelKey: 'dashboard.assignments.editor.task_type_labels.form', Icon: Type },
    CODE: { label: 'Code', labelKey: 'dashboard.assignments.editor.task_type_labels.code', Icon: Code2 },
    SHORT_ANSWER: { label: 'Short answer', labelKey: 'dashboard.assignments.editor.task_type_labels.short_answer', Icon: Pencil },
    NUMBER_ANSWER: { label: 'Number', labelKey: 'dashboard.assignments.editor.task_type_labels.number_answer', Icon: Hash },
}

// "Add task" + "Generate with AI". Each instance owns its modal state, so the
// actions can sit both at the top of the task list and inside the editor's
// empty state.
export function TaskCreateActions({ assignment_uuid, layout = 'stack' }: { assignment_uuid: string; layout?: 'stack' | 'row' }) {
    const { t } = useTranslation()
    const [isNewTaskModalOpen, setIsNewTaskModalOpen] = React.useState(false)
    const [isGenerateAIModalOpen, setIsGenerateAIModalOpen] = React.useState(false)

    return (
        <div className={layout === 'row' ? 'flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-2' : 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-2'}>
            <Modal
                isDialogOpen={isNewTaskModalOpen}
                onOpenChange={setIsNewTaskModalOpen}
                minHeight='no-min'
                minWidth='md'
                dialogContent={
                    <NewTaskModal assignment_uuid={assignment_uuid} closeModal={setIsNewTaskModalOpen} />
                }
                dialogTitle={t('dashboard.assignments.editor.add_task_modal.title')}
                dialogDescription={t('dashboard.assignments.editor.add_task_modal.description')}
                dialogTrigger={
                    <button type='button' className={`${BTN_PRIMARY} w-full ${layout === 'row' ? 'sm:w-auto' : ''}`}>
                        <Plus size={16} />
                        <span className='truncate'>{t('dashboard.assignments.editor.add_task')}</span>
                    </button>
                }
            />
            <Modal
                isDialogOpen={isGenerateAIModalOpen}
                onOpenChange={setIsGenerateAIModalOpen}
                minHeight='no-min'
                minWidth='md'
                dialogContent={
                    <GenerateTasksAIModal
                        assignment_uuid={assignment_uuid}
                        closeModal={setIsGenerateAIModalOpen}
                    />
                }
                dialogTitle={t('dashboard.assignments.editor.generate_ai_modal.title', 'Generate tasks with AI')}
                dialogDescription={t('dashboard.assignments.editor.generate_ai_modal.description', 'Describe what you want and preview tasks grounded on the course content before adding them.')}
                dialogTrigger={
                    <button type='button' className={`${BTN_SECONDARY} w-full ${layout === 'row' ? 'sm:w-auto' : ''}`}>
                        <Sparkles size={16} className='text-violet-500' />
                        <span className='truncate'>{t('dashboard.assignments.editor.generate_ai', 'Generate tasks with AI')}</span>
                    </button>
                }
            />
        </div>
    )
}

function AssignmentTasks({ assignment_uuid }: any) {
    const { t } = useTranslation()
    const assignments = useAssignments() as any;
    const assignmentTask = useAssignmentsTask() as any;
    const assignmentTaskHook = useAssignmentsTaskDispatch() as any;
    const queryClient = useQueryClient()
    const session = useLHSession() as any
    const access_token = session?.data?.tokens?.access_token

    async function setSelectTask(task_uuid: string) {
        assignmentTaskHook({ type: 'setSelectedAssignmentTaskUUID', payload: task_uuid })
    }

    const tasks: any[] = sortTasksByOrder(assignments?.assignment_tasks)
    const selectedUUID = assignmentTask.selectedAssignmentTaskUUID
    const firstTaskUUID = tasks[0]?.assignment_task_uuid

    // Open the first task instead of an empty canvas: on first load, and again
    // after the selected task is deleted (the editor resets the selection).
    useEffect(() => {
        if (!selectedUUID && firstTaskUUID) {
            assignmentTaskHook({ type: 'setSelectedAssignmentTaskUUID', payload: firstTaskUUID })
        }
    }, [selectedUUID, firstTaskUUID, assignmentTaskHook])

    async function handleDragEnd(result: DropResult) {
        if (!result.destination || result.destination.index === result.source.index) return
        const tasksKey = queryKeys.assignments.tasks(assignment_uuid)
        const previous = queryClient.getQueryData(tasksKey)
        const reordered = moveTask(tasks, result.source.index, result.destination.index)
        // Show the new order right away; the API call below confirms it.
        queryClient.setQueryData(tasksKey, reordered)
        const res = await reorderAssignmentTasks(
            reordered.map((task: any) => task.assignment_task_uuid),
            assignment_uuid,
            access_token
        )
        if (!res.success) {
            queryClient.setQueryData(tasksKey, previous)
            toast.error(t('dashboard.assignments.editor.toasts.reorder_failed', 'Could not reorder tasks'))
        }
        queryClient.invalidateQueries({ queryKey: tasksKey })
    }

    const totalPoints = tasks.reduce((sum, task) => sum + (typeof task.max_grade_value === 'number' ? task.max_grade_value : 0), 0)

    return (
        <div className='flex flex-col w-full min-h-0 lg:h-full'>
            {/* Panel header */}
            <div className='flex-none px-4 sm:px-6 lg:px-5 pt-5 pb-4 space-y-3 lg:border-b lg:border-neutral-100'>
                <div className='flex items-baseline justify-between gap-2'>
                    <h2 className='text-base font-semibold text-neutral-900'>
                        {t('dashboard.assignments.editor.tasks_title')}
                        {tasks.length > 0 && (
                            <span className='ms-2 text-sm font-medium text-neutral-400 tabular-nums'>{tasks.length}/{MAX_TASKS}</span>
                        )}
                    </h2>
                    {totalPoints > 0 && (
                        <span className='text-xs text-neutral-500 tabular-nums'>
                            {t('dashboard.assignments.editor.total_points', { points: totalPoints })}
                        </span>
                    )}
                </div>
                {assignments && tasks.length < MAX_TASKS && (
                    <TaskCreateActions assignment_uuid={assignment_uuid} />
                )}
                {assignments && tasks.length >= MAX_TASKS && (
                    <p className='text-xs text-neutral-500'>{t('dashboard.assignments.editor.max_tasks_reached', { max: MAX_TASKS })}</p>
                )}
            </div>

            {/* Task rows */}
            <div className='flex-1 min-h-0 lg:overflow-y-auto px-2 sm:px-4 lg:px-3 pb-4 lg:py-3'>
                <DragDropContext onDragEnd={handleDragEnd}>
                <Droppable droppableId='assignment-tasks'>
                {(droppableProvided) => (
                <ol
                    ref={droppableProvided.innerRef}
                    {...droppableProvided.droppableProps}
                    className='flex flex-col'
                >
                {tasks.map((task: any, index: number) => {
                    const meta = TASK_TYPE_META[task.assignment_type] ?? { label: task.assignment_type, Icon: Type }
                    const Icon = meta.Icon
                    const isSelected = task.assignment_task_uuid === selectedUUID

                    return (
                        <Draggable
                            key={task.assignment_task_uuid}
                            draggableId={task.assignment_task_uuid}
                            index={index}
                            // The whole row is a <button>; let it start a drag
                            // while a plain click still selects the task.
                            disableInteractiveElementBlocking
                        >
                        {(draggableProvided, snapshot) => (
                        <li
                            ref={draggableProvided.innerRef}
                            {...draggableProvided.draggableProps}
                            className='mb-1'
                        >
                        <button
                            type='button'
                            {...draggableProvided.dragHandleProps}
                            onClick={() => setSelectTask(task.assignment_task_uuid)}
                            data-testid='assignment-task-card'
                            aria-current={isSelected ? 'true' : undefined}
                            className={`group relative w-full flex items-center gap-3 rounded-xl px-2.5 py-2.5 text-start transition-colors
                                ${isSelected ? 'bg-neutral-100' : 'hover:bg-neutral-50'}
                                ${snapshot.isDragging ? 'bg-white nice-shadow' : ''}
                            `}
                        >
                            <span
                                className={`relative w-9 h-9 rounded-lg flex items-center justify-center shrink-0 transition-colors
                                    ${isSelected ? 'bg-neutral-900 text-white' : 'bg-white text-neutral-500 ring-1 ring-inset ring-neutral-200'}
                                `}
                            >
                                <Icon size={16} />
                            </span>
                            <span className='min-w-0 flex-1'>
                                <span className={`block text-sm leading-snug truncate ${isSelected ? 'font-semibold text-neutral-900' : 'font-medium text-neutral-800'}`}>
                                    {task.title || <span className='text-neutral-400 italic font-normal'>{t('dashboard.assignments.editor.untitled_task')}</span>}
                                </span>
                                <span className='mt-0.5 block text-xs text-neutral-500 truncate tabular-nums'>
                                    {index + 1}. {meta.labelKey ? t(meta.labelKey) : meta.label}
                                </span>
                            </span>
                            {typeof task.max_grade_value === 'number' && (
                                <span className='shrink-0 text-xs font-medium text-neutral-500 tabular-nums'>
                                    {t('dashboard.assignments.editor.points_short', { points: task.max_grade_value })}
                                </span>
                            )}
                            {tasks.length > 1 && (
                                <GripVertical
                                    size={14}
                                    className='shrink-0 -ms-1 text-neutral-300 opacity-60 lg:opacity-0 lg:group-hover:opacity-100 transition-opacity'
                                    aria-label={t('dashboard.assignments.editor.drag_to_reorder', 'Drag to reorder')}
                                />
                            )}
                        </button>
                        </li>
                        )}
                        </Draggable>
                    )
                })}
                {droppableProvided.placeholder}
                </ol>
                )}
                </Droppable>
                </DragDropContext>

                {tasks.length === 0 && assignments && (
                    <p className='px-3 py-6 text-center text-sm text-neutral-500'>
                        {t('dashboard.assignments.editor.no_tasks')}
                    </p>
                )}
            </div>
        </div>
    )
}

export default AssignmentTasks
