import { useAssignments } from '@components/Contexts/Assignments/AssignmentContext'
import Modal from '@components/Objects/StyledElements/Modal/Modal';
import { Clock, Code2, FileUp, Hash, ListTodo, Pencil, Plus, Type } from 'lucide-react';
import React from 'react'
import NewTaskModal from './Modals/NewTaskModal';
import { useAssignmentsTask, useAssignmentsTaskDispatch } from '@components/Contexts/Assignments/AssignmentsTaskContext';
import { useTranslation } from 'react-i18next';
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'

dayjs.extend(relativeTime)

const TASK_TYPE_META: Record<string, { label: string; Icon: React.ComponentType<{ size?: number; className?: string }> }> = {
    QUIZ: { label: 'Quiz', Icon: ListTodo },
    FILE_SUBMISSION: { label: 'File upload', Icon: FileUp },
    FORM: { label: 'Form', Icon: Type },
    CODE: { label: 'Code', Icon: Code2 },
    SHORT_ANSWER: { label: 'Short answer', Icon: Pencil },
    NUMBER_ANSWER: { label: 'Number', Icon: Hash },
}

function stripMarkup(text: string): string {
    if (!text) return ''
    return text
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
}

function AssignmentTasks({ assignment_uuid }: any) {
    const { t } = useTranslation()
    const assignments = useAssignments() as any;
    const assignmentTask = useAssignmentsTask() as any;
    const assignmentTaskHook = useAssignmentsTaskDispatch() as any;
    const [isNewTaskModalOpen, setIsNewTaskModalOpen] = React.useState(false)

    async function setSelectTask(task_uuid: string) {
        assignmentTaskHook({ type: 'setSelectedAssignmentTaskUUID', payload: task_uuid })
    }

    const tasks: any[] = assignments?.assignment_tasks ?? []

    return (
        <div className='flex w-full'>
            <div className='flex flex-col gap-2 w-[272px] mx-auto'>
                {assignments && tasks.length < 10 && (
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
                            <button
                                type='button'
                                className='group flex items-center justify-center gap-1.5 w-full px-3 py-2.5 bg-gray-900 text-white text-xs font-semibold rounded-lg hover:bg-black transition-colors'
                            >
                                <Plus size={14} className='transition-transform group-hover:scale-110' />
                                <span>{t('dashboard.assignments.editor.add_task')}</span>
                            </button>
                        }
                    />
                )}

                {tasks.length > 0 && (
                    <div className='px-1 pt-1 pb-0.5 flex items-center justify-between'>
                        <span className='text-[10px] font-semibold text-gray-400 uppercase tracking-wider'>
                            {tasks.length} {tasks.length === 1 ? 'task' : 'tasks'}
                        </span>
                        <span className='text-[10px] font-medium text-gray-300'>newest first</span>
                    </div>
                )}

                {tasks.map((task: any, index: number) => {
                    const meta = TASK_TYPE_META[task.assignment_type] ?? { label: task.assignment_type, Icon: Type }
                    const Icon = meta.Icon
                    const isSelected = task.assignment_task_uuid === assignmentTask.selectedAssignmentTaskUUID
                    const descriptionPreview = stripMarkup(task.description || '')
                    const createdAt = task.creation_date ? dayjs(task.creation_date) : null
                    const createdLabel = createdAt?.isValid() ? createdAt.fromNow() : null
                    const position = tasks.length - index

                    return (
                        <button
                            type='button'
                            key={task.id}
                            onClick={() => setSelectTask(task.assignment_task_uuid)}
                            className={`group relative text-left rounded-xl border transition-all overflow-hidden
                                ${isSelected
                                    ? 'border-gray-900 bg-white shadow-[0_4px_14px_rgba(15,23,42,0.08)]'
                                    : 'border-gray-100 bg-white hover:border-gray-200 hover:shadow-[0_2px_8px_rgba(15,23,42,0.05)]'}
                            `}
                        >
                            {/* Accent bar when selected */}
                            <span
                                className={`absolute left-0 top-0 bottom-0 w-[3px] transition-colors
                                    ${isSelected ? 'bg-gray-900' : 'bg-transparent'}
                                `}
                                aria-hidden
                            />

                            <div className='p-3 pl-[14px]'>
                                {/* Meta row */}
                                <div className='flex items-center justify-between mb-1.5'>
                                    <div className='flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-gray-400'>
                                        <span className='inline-flex items-center justify-center w-4 h-4 rounded-full bg-gray-100 text-gray-500 font-bold'>
                                            {position}
                                        </span>
                                        <span>{meta.label}</span>
                                    </div>
                                    <Icon size={13} className='text-gray-300' />
                                </div>

                                {/* Title */}
                                <div className='text-sm font-semibold text-gray-800 leading-snug break-words'>
                                    {task.title || <span className='text-gray-300 italic font-normal'>Untitled task</span>}
                                </div>

                                {/* Description */}
                                {descriptionPreview && (
                                    <p className='mt-1.5 text-xs text-gray-500 leading-relaxed line-clamp-2'>
                                        {descriptionPreview}
                                    </p>
                                )}

                                {/* Footer */}
                                <div className='mt-2.5 pt-2 border-t border-gray-50 flex items-center justify-between text-[11px] text-gray-400'>
                                    <div className='flex items-center gap-1'>
                                        <Clock size={10} />
                                        <span>{createdLabel ?? '—'}</span>
                                    </div>
                                    {typeof task.max_grade_value === 'number' && task.max_grade_value !== 100 && (
                                        <span className='font-medium text-gray-500'>out of {task.max_grade_value}</span>
                                    )}
                                </div>
                            </div>
                        </button>
                    )
                })}

                {tasks.length === 0 && assignments && (
                    <div className='rounded-xl border border-dashed border-gray-200 bg-gray-50/50 px-4 py-8 text-center'>
                        <div className='text-xs text-gray-400'>No tasks yet — add one to get started.</div>
                    </div>
                )}
            </div>
        </div>
    )
}

export default AssignmentTasks
