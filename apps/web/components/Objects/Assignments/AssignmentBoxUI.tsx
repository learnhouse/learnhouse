import { BookUser, EllipsisVertical, File, FileUp, ListTodo, Save } from 'lucide-react'
import React from 'react'

type AssignmentBoxProps = {
    type: 'quiz' | 'file'
    view?: 'teacher' | 'student'
    saveFC?: () => void
    children: React.ReactNode

}

function AssignmentBoxUI({ type, view, saveFC, children }: AssignmentBoxProps) {
    return (
        <div className='flex flex-col px-4 py-2 nice-shadow rounded-md bg-slate-100/30'>
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

                    {/* Save button */}
                    <div
                        onClick={() => saveFC && saveFC()}
                        className='flex px-2 py-1 cursor-pointer rounded-md space-x-2 items-center bg-gradient-to-bl text-slate-500  bg-white/60 hover:bg-white/80 linear transition-all nice-shadow  '>
                        <Save size={14} />
                        <p className='text-xs font-semibold'>Save</p>
                    </div>

                </div>
            </div>
            {children}
        </div>
    )
}

export default AssignmentBoxUI