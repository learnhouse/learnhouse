'use client';
import { useOrg } from '@components/Contexts/OrgContext';
import ToolTip from '@components/StyledElements/Tooltip/Tooltip'
import { ArrowLeft, Book, Home } from 'lucide-react'
import Link from 'next/link'
import React, { use, useEffect } from 'react'

function LeftMenu() {
    const org = useOrg() as any;

    useEffect(() => {

    }
        , [org])


    return (
        <div
            style={{ background: "linear-gradient(0deg, rgba(0, 0, 0, 0.20) 0%, rgba(0, 0, 0, 0.20) 100%), radial-gradient(271.56% 105.16% at 50% -5.16%, rgba(255, 255, 255, 0.18) 0%, rgba(0, 0, 0, 0.00) 100%), #2E2D2D" }}
            className='flex flex-col w-20 justifiy-center bg-black h-screen justify-center text-white'>
            <div className='flex flex-col space-y-5 items-center mx-auto'>
                <ToolTip content={"Back to " + org?.name} slateBlack sideOffset={8} side='right'  >
                    <Link className='bg-white text-black hover:text-white rounded-lg p-2 hover:bg-white/10 transition-all ease-linear' href={`/`} ><ArrowLeft className='hover:text-white' size={18} /></Link>
                </ToolTip>
                <ToolTip content={"Home"} slateBlack sideOffset={8} side='right'  >
                    <Link className='bg-white/5 rounded-lg p-2 hover:bg-white/10 transition-all ease-linear' href={`/dash`} ><Home size={18} /></Link>
                </ToolTip>
                <ToolTip content={"Courses"} slateBlack sideOffset={8} side='right'  >
                    <Link className='bg-white/5 rounded-lg p-2 hover:bg-white/10 transition-all ease-linear' href={`/dash/courses`} ><Book size={18} /></Link>
                </ToolTip>
            </div>


        </div>
    )
}

export default LeftMenu

