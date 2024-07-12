'use client';
import { Info, Link } from 'lucide-react'
import React from 'react'

function AssignmentTaskEditor({ task_uuid, page }: any) {
    const [selectedSubPage, setSelectedSubPage] = React.useState(page)
    return (
        <div className="flex flex-col font-black text-sm w-full z-20">

            <div className='flex flex-col bg-white pl-10 pr-10 text-sm tracking-tight  z-10 shadow-[0px_4px_16px_rgba(0,0,0,0.06)] pt-5'>
                <div className='font-semibold text-lg py-1'>
                    Assignment Test #1
                </div>
                <div className='flex space-x-2 '>
                    <div
                        className={`flex space-x-4 py-2 w-fit text-center border-black transition-all ease-linear ${selectedSubPage === 'overview'
                            ? 'border-b-4'
                            : 'opacity-50'
                            } cursor-pointer`}
                    >
                        <div className="flex items-center space-x-2.5 mx-2">
                            <Info size={16} />
                            <div>Overview</div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}

export default AssignmentTaskEditor