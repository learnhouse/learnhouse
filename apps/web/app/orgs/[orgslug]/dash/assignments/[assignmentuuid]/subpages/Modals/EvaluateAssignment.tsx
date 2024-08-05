import { useAssignments } from '@components/Contexts/Assignments/AssignmentContext';
import { Download, Info, Medal } from 'lucide-react';
import Link from 'next/link';
import React from 'react'
import TaskQuizObject from '../../_components/TaskEditor/Subs/TaskTypes/TaskQuizObject';
import TaskFileObject from '../../_components/TaskEditor/Subs/TaskTypes/TaskFileObject';
import { useOrg } from '@components/Contexts/OrgContext';
import { getTaskRefFileDir } from '@services/media/media';

function EvaluateAssignment({ user_id }: any) {
    const assignments = useAssignments() as any;
    const org = useOrg() as any;

    console.log(assignments);
    return (
        <div className='flex-col space-y-4 px-3 py-3 overflow-y-auto min-h-fit'>
            {assignments && assignments?.assignment_tasks?.sort((a: any, b: any) => a.id - b.id).map((task: any, index: number) => {
                return (
                    <div className='flex flex-col space-y-2' key={task.assignment_task_uuid}>
                        <div className='flex justify-between py-2'>
                            <div className='flex space-x-2 font-semibold text-slate-800'>
                                <p>Task {index + 1} : </p>
                                <p className='text-slate-500'>{task.description}</p>
                            </div>
                            <div className='flex space-x-2'>
                                <div
                                    onClick={() => alert(task.hint)}
                                    className='px-3 py-1 flex items-center nice-shadow bg-amber-50/40 text-amber-900 rounded-full space-x-2 cursor-pointer'>
                                    <Info size={13} />
                                    <p className='text-xs font-semibold'>View Hint</p>
                                </div>
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
                                    className='px-3 py-1 flex items-center nice-shadow bg-cyan-50/40 text-cyan-900 rounded-full space-x-2 cursor-pointer'>
                                    <Download size={13} />
                                    <div className='flex items-center space-x-2'>
                                        {task.reference_file && (
                                            <span className='relative'>
                                                <span className='absolute right-0 top-0 block h-2 w-2 rounded-full ring-2 ring-white bg-green-400'></span>
                                            </span>
                                        )}
                                        <p className='text-xs font-semibold'>Reference Document</p>
                                    </div>
                                </Link>
                            </div>
                        </div>
                        <div>
                            {task.assignment_type === 'QUIZ' && <TaskQuizObject key={task.assignment_task_uuid} view='grading' user_id={user_id} assignmentTaskUUID={task.assignment_task_uuid} />}
                            {task.assignment_type === 'FILE_SUBMISSION' && <TaskFileObject key={task.assignment_task_uuid} view='student' assignmentTaskUUID={task.assignment_task_uuid} />}
                        </div>
                    </div>
                )
            })}
            <div className='flex flex-row-reverse font-semibold items-center'>
                <button className='flex space-x-2 px-4 py-2 bg-teal-600/80 text-white rounded-lg nice-shadow items-center'>
                    <Medal size={18} />
                    <span>Set final grade</span>
                </button>
            </div>
        </div>
    )
}

export default EvaluateAssignment