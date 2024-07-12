import { useAssignments } from '@components/Contexts/Assignments/AssignmentContext'
import { Plus } from 'lucide-react';
import React, { useEffect } from 'react'

function AssignmentTasks() {
    const assignments = useAssignments() as any;

    useEffect(() => {
        console.log(assignments)
    }, [assignments])


    return (
        <div className='flex w-full'>
            <div className='flex flex-col space-y-3 mx-auto'>
                {assignments && assignments?.assignment_tasks?.map((task: any) => {
                    return (
                        <div key={task.id} className='flex flex-col w-[250px] nice-shadow bg-white shadow-[0px_4px_16px_rgba(0,0,0,0.06)] p-3 rounded-md'>
                            <div className='flex justify-between px-2'>
                                <div className='font-semibold text-sm'>{task.title}</div>
                            </div>
                        </div>
                    )
                })}
                <div className='flex space-x-1.5 px-2 py-2 bg-black text-white text-xs rounded-md antialiased items-center font-semibold cursor-pointer'>
                    <Plus size={17} />
                    <p>Add Task</p>
                </div>
            </div>
            
        </div>
    )
}

export default AssignmentTasks