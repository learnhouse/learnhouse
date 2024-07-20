'use client';
import BreadCrumbs from '@components/Dashboard/UI/BreadCrumbs'
import { BookOpen, BookX, EllipsisVertical, Eye, LayoutList } from 'lucide-react'
import React, { useEffect } from 'react'
import { AssignmentProvider, useAssignments } from '@components/Contexts/Assignments/AssignmentContext';
import AssignmentTasks from './_components/Tasks';
import { AssignmentsTaskProvider } from '@components/Contexts/Assignments/AssignmentsTaskContext';
import ToolTip from '@components/StyledElements/Tooltip/Tooltip';
import AssignmentTaskEditor from './_components/TaskEditor/TaskEditor';
import { updateAssignment } from '@services/courses/assignments';
import { useLHSession } from '@components/Contexts/LHSessionContext';
import { mutate } from 'swr';
import { getAPIUrl } from '@services/config/config';
import toast from 'react-hot-toast';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { updateActivity } from '@services/courses/activities';

function AssignmentEdit() {
    const params = useParams<{ assignmentuuid: string; }>()
    return (
        <div className='flex w-full flex-col'>
            <AssignmentProvider assignment_uuid={'assignment_' + params.assignmentuuid}>
                <div className='pb-5  bg-white z-50 shadow-[0px_4px_16px_rgba(0,0,0,0.06)] nice-shadow'>
                    <div className='flex justify-between mr-10 h-full'>
                        <div className="pl-10 mr-10 tracking-tighter">
                            <BrdCmpx />
                            <div className="w-100 flex justify-between">
                                <div className="flex font-bold text-2xl">Assignment Editor</div>
                            </div>
                        </div>
                        <div className='flex flex-col justify-center antialiased'>
                            <PublishingState />
                        </div>
                    </div>
                </div>
                <div className="flex h-full w-full">
                    <AssignmentsTaskProvider>
                        <div className='flex w-[400px] flex-col h-full custom-dots-bg'>
                            <div className='flex mx-auto px-3.5 py-1 bg-neutral-600/80 space-x-2 my-5 items-center text-sm font-bold text-white rounded-full'>
                                <LayoutList size={18} />
                                <p>Tasks</p>
                            </div>
                            <AssignmentTasks assignment_uuid={'assignment_' + params.assignmentuuid} />
                        </div>
                        <div className='flex flex-grow bg-[#fefcfe] nice-shadow h-full w-full'>
                            <AssignmentProvider assignment_uuid={'assignment_' + params.assignmentuuid}>
                                <AssignmentTaskEditor page='general' />
                            </AssignmentProvider>
                        </div>
                    </AssignmentsTaskProvider>
                </div>
            </AssignmentProvider>
        </div>
    )
}

export default AssignmentEdit

function BrdCmpx() {
    const assignment = useAssignments() as any

    useEffect(() => {
    }, [assignment])

    return (
        <BreadCrumbs type="assignments" last_breadcrumb={assignment?.assignment_object?.title} />
    )
}

function PublishingState() {
    const assignment = useAssignments() as any;
    const session = useLHSession() as any;
    const access_token = session?.data?.tokens?.access_token;

    async function updateAssignmentPublishState(assignmentUUID: string) {
        const res = await updateAssignment({ published: !assignment?.assignment_object?.published }, assignmentUUID, access_token)
        const res2 = await updateActivity({ published: !assignment?.assignment_object?.published }, assignment?.activity_object?.activity_uuid, access_token)
        if (res.success && res2) {
            mutate(`${getAPIUrl()}assignments/${assignmentUUID}`)
            toast.success('The assignment has been updated successfully')
        }
        else {
            toast.error('Error updating assignment, please retry later.')
        }
    }

    useEffect(() => {
    }, [assignment])

    return (
        <div className='flex mx-auto mt-5 items-center space-x-4'>
            <div className={`flex text-xs rounded-full px-3.5 py-2 mx-auto font-bold outline outline-1 ${!assignment?.assignment_object?.published ? 'outline-gray-300 bg-gray-200/60' : 'outline-green-300 bg-green-200/60'}`}>
                {assignment?.assignment_object?.published ? 'Published' : 'Unpublished'}
            </div>
            <div><EllipsisVertical className='text-gray-500' size={13} /></div>

            <ToolTip
                side='left'
                slateBlack
                sideOffset={10}
                content="Preview the Assignment as a student" >
                <Link
                    target='_blank'
                    href={`/course/${assignment?.course_object?.course_uuid.replace('course_', '')}/activity/${assignment?.activity_object?.activity_uuid.replace('activity_', '')}`}
                    className='flex px-3 py-2 cursor-pointer rounded-md space-x-2 items-center bg-gradient-to-bl text-cyan-800 font-medium from-sky-400/50 to-cyan-200/80  border border-cyan-600/10 shadow-cyan-900/10 shadow-lg'>
                    <Eye size={18} />
                    <p className=' text-sm font-bold'>Preview</p>
                </Link>
            </ToolTip>
            {assignment?.assignment_object?.published && <ToolTip
                side='left'
                slateBlack
                sideOffset={10}
                content="Make your Assignment unavailable for students" >
                <div
                    onClick={() => updateAssignmentPublishState(assignment?.assignment_object?.assignment_uuid)}
                    className='flex px-3 py-2 cursor-pointer rounded-md space-x-2 items-center bg-gradient-to-bl text-gray-800 font-medium from-gray-400/50 to-gray-200/80 border border-gray-600/10 shadow-gray-900/10 shadow-lg'>
                    <BookX size={18} />
                    <p className='text-sm font-bold'>Unpublish</p>
                </div>
            </ToolTip>}
            {!assignment?.assignment_object?.published &&
                <ToolTip
                    side='left'
                    slateBlack
                    sideOffset={10}
                    content="Make your Assignment public and available for students" >
                    <div
                        onClick={() => updateAssignmentPublishState(assignment?.assignment_object?.assignment_uuid)}
                        className='flex px-3 py-2 cursor-pointer rounded-md space-x-2 items-center bg-gradient-to-bl text-green-800 font-medium from-green-400/50 to-lime-200/80  border border-green-600/10 shadow-green-900/10 shadow-lg'>
                        <BookOpen size={18} />
                        <p className=' text-sm font-bold'>Publish</p>
                    </div>
                </ToolTip>}
        </div>
    )
}
