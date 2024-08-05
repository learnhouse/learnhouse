import { useAssignmentSubmission } from '@components/Contexts/Assignments/AssignmentSubmissionContext'
import { BookPlus, BookUser, EllipsisVertical, FileUp, Forward, InfoIcon, ListTodo, Save } from 'lucide-react'
import React, { useEffect } from 'react'

type AssignmentBoxProps = {
    type: 'quiz' | 'file'
    view?: 'teacher' | 'student' | 'grading'
    maxPoints?: number
    currentPoints?: number
    saveFC?: () => void
    submitFC?: () => void
    gradeFC?: () => void
    showSavingDisclaimer?: boolean
    children: React.ReactNode

}

function AssignmentBoxUI({ type, view, currentPoints, maxPoints, saveFC, submitFC, gradeFC, showSavingDisclaimer, children }: AssignmentBoxProps) {
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
                    {maxPoints &&
                        <div className='flex bg-emerald-200/20 text-xs rounded-full space-x-1 px-2 py-0.5 mx-auto font-bold outline items-center text-emerald-600 outline-1 outline-emerald-300/40'>
                            <BookPlus size={12} />
                            <p>{maxPoints} points</p>
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

                    {/* Teacher button */}
                    {view === 'teacher' &&
                        <div
                            onClick={() => saveFC && saveFC()}
                            className='flex px-2 py-1 cursor-pointer rounded-md space-x-2 items-center bg-gradient-to-bl text-emerald-700  bg-emerald-300/20 hover:bg-emerald-300/10 hover:outline-offset-4 active:outline-offset-1 linear transition-all outline-offset-2 outline-dashed outline-emerald-500/60'>
                            <Save size={14} />
                            <p className='text-xs font-semibold'>Save</p>
                        </div>
                    }

                    {/* Student button */}
                    {view === 'student' && submission && submission.length <= 0 &&
                        <div
                            onClick={() => submitFC && submitFC()}
                            className='flex px-2 py-1 cursor-pointer rounded-md space-x-2 items-center bg-gradient-to-bl text-emerald-700  bg-emerald-300/20 hover:bg-emerald-300/10 hover:outline-offset-4 active:outline-offset-1 linear transition-all outline-offset-2 outline-dashed outline-emerald-500/60'>
                            <Forward size={14} />
                            <p className='text-xs font-semibold'>Save your progress</p>
                        </div>
                    }

                    {/* Grading button */}
                    {view === 'grading' &&
                        <div
                            onClick={() => gradeFC && gradeFC()}
                            className='flex px-0.5 py-0.5 cursor-pointer rounded-md space-x-2 items-center bg-gradient-to-bl hover:outline-offset-4 active:outline-offset-1 linear transition-all outline-offset-2 outline-dashed outline-orange-500/60'>
                            <p className='font-semibold px-2 text-xs text-orange-700'>Current points : {currentPoints}</p>
                            <div className='bg-gradient-to-bl text-orange-700  bg-orange-300/20 hover:bg-orange-300/10 items-center flex rounded-md px-2 py-1 space-x-2'>
                             <BookPlus size={14} />
                                <p className='text-xs font-semibold'>Grade</p>
                            </div>
                        </div>
                    }
                </div>
            </div>
            {children}
        </div>
    )
}

export default AssignmentBoxUI