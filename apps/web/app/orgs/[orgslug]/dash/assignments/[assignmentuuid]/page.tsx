'use client';
import BreadCrumbs from '@components/Dashboard/UI/BreadCrumbs'
import AuthenticatedClientElement from '@components/Security/AuthenticatedClientElement'
import { BookOpen, BookOpenCheck, BookX, Check, Ellipsis, EllipsisVertical, GalleryVerticalEnd, Info, LayoutList, UserRoundCog } from 'lucide-react'
import React from 'react'
import AssignmentTaskEditor from './_components/TaskEditor';
import { AssignmentProvider } from '@components/Contexts/Assignments/AssignmentContext';
import AssignmentTasks from './_components/Tasks';
import { useParams } from 'next/navigation';

function AssignmentEdit() {
    const params = useParams<{ assignmentuuid: string; }>()
    return (
        <div className='flex w-full flex-col'>
            <div className='pb-5  bg-white z-50 shadow-[0px_4px_16px_rgba(0,0,0,0.06)] nice-shadow'>
                <div className='flex justify-between mr-10 h-full'>
                    <div className="pl-10 mr-10 tracking-tighter">
                        <BreadCrumbs type="assignments" last_breadcrumb='UUID' />
                        <div className="w-100 flex justify-between">
                            <div className="flex font-bold text-2xl">Assignment Editor</div>
                        </div>
                    </div>
                    <div className='flex flex-col justify-center antialiased'>
                        <div className='flex mx-auto mt-5 items-center space-x-4'>
                            <div className='flex bg-green-200/60 text-xs rounded-full px-3.5 py-2 mx-auto font-bold outline outline-1 outline-green-300'>Published</div>
                            <div><EllipsisVertical className='text-gray-500' size={13} /></div>
                            <div className='flex px-3 py-2 cursor-pointer rounded-md space-x-2 items-center bg-gradient-to-bl text-green-800 font-medium from-green-400/50 to-lime-200/80  border border-green-600/10 shadow-green-900/10 shadow-lg'>
                                <BookOpen size={18} />
                                <p className=' text-sm font-bold'>Publish</p>
                            </div>
                            <div className='flex px-3 py-2 cursor-pointer rounded-md space-x-2 items-center bg-gradient-to-bl text-gray-800 font-medium from-gray-400/50 to-gray-200/80 border border-gray-600/10 shadow-gray-900/10 shadow-lg'>
                                <BookX size={18} />
                                <p className='text-sm font-bold'>Unpublish</p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            <div className="flex w-full">
                <div className='flex w-[400px] flex-col h-screen custom-dots-bg'>
                    <div className='flex mx-auto px-3.5 py-1 bg-neutral-600/80 space-x-2 my-5 items-center text-sm font-bold text-white rounded-full'>
                        <LayoutList size={18} />
                        <p>Tasks</p>
                    </div>
                    <AssignmentProvider assignment_uuid='assignment_a35fdbb9-11bd-40cf-a781-f6bdd5d87165'>
                        <AssignmentTasks />
                    </AssignmentProvider>
                </div>
                <div className='flex flex-grow bg-[#fefcfe] nice-shadow h-screen w-full'>
                    <AssignmentProvider assignment_uuid={'assignment_' + params.assignmentuuid}>
                        <AssignmentTaskEditor task_uuid='UUID' page='overview' />
                    </AssignmentProvider>
                </div>
            </div>
        </div>
    )
}

export default AssignmentEdit