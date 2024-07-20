import { useAssignmentSubmission } from '@components/Contexts/Assignments/AssignmentSubmissionContext'
import { BookUser, EllipsisVertical, FileUp, Forward, Info, InfoIcon, ListTodo, Save } from 'lucide-react'
import React, { use, useEffect } from 'react'

type AssignmentBoxProps = {
    type: 'quiz' | 'file'
    view?: 'teacher' | 'student'
    saveFC?: () => void
    submitFC?: () => void
    showSavingDisclaimer?: boolean
    children: React.ReactNode

}

function AssignmentBoxUI({ type, view, saveFC, submitFC, showSavingDisclaimer, children }: AssignmentBoxProps) {
    const submission = useAssignmentSubmission() as any
    useEffect(() => {
    }
    , [submission])
    return (
        <div className='flex flex-col px-6 py-4 nice-shadow rounded-md bg-slate-100/30'>
            <div className='flex justify-between space-x-2 pb-2 text-slate-400 items-center'>
                <div className='flex space-x-1 items-center'>
                    <div className='text-lg font-semibold'>
                        {type === 'quiz' &&
                            <div className='flex space-x-1.5 items-center'>
                                <ListTodo size={17} />
                                <p>Quiz</p>
                            </div>}
                        {type === 'file' &&
                            <div className='flex space-x-1.5 items-center'>
                                <FileUp size={17} />
                                <p>File Submission</p>
                            </div>}
                    </div>


                    <div className='flex items-center space-x-1'>
                        <EllipsisVertical size={15} />
                    </div>
                    {view === 'teacher' &&
                        <div className='flex bg-amber-200/20 text-xs rounded-full space-x-1 px-2 py-0.5 mx-auto font-bold outline items-center text-amber-600 outline-1 outline-amber-300/40'>
                            <BookUser size={12} />
                            <p>Teacher view</p>
                        </div>
                    }
                </div>
                <div className='flex px-1 py-1 rounded-md items-center'>
                    {showSavingDisclaimer && 
                    <div className='flex space-x-2 items-center font-semibold px-3 py-1 outline-dashed outline-red-200 text-red-400 mr-5 rounded-full'>
                        <InfoIcon size={14} />
                        <p className='text-xs'>Don't forget to save your progress</p>
                    </div>
                    }

                    {/* Save button */}
                    {view === 'teacher' &&
                        <div
                            onClick={() => saveFC && saveFC()}
                            className='flex px-2 py-1 cursor-pointer rounded-md space-x-2 items-center bg-gradient-to-bl text-emerald-700  bg-emerald-300/20 hover:bg-emerald-300/10 hover:outline-offset-4 active:outline-offset-1 linear transition-all outline-offset-2 outline-dashed outline-emerald-500/60'>
                            <Save size={14} />
                            <p className='text-xs font-semibold'>Save</p>
                        </div>
                    }
                    {view === 'student' && submission.length <= 0 &&
                        <div
                            onClick={() => submitFC && submitFC()}
                            className='flex px-2 py-1 cursor-pointer rounded-md space-x-2 items-center bg-gradient-to-bl text-emerald-700  bg-emerald-300/20 hover:bg-emerald-300/10 hover:outline-offset-4 active:outline-offset-1 linear transition-all outline-offset-2 outline-dashed outline-emerald-500/60'>
                            <Forward size={14} />
                            <p className='text-xs font-semibold'>Save your progress</p>
                        </div>
                    }

                </div>
            </div>
            {children}
        </div>
    )
}

export default AssignmentBoxUI