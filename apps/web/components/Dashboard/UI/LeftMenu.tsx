'use client';
import { useOrg } from '@components/Contexts/OrgContext';
import { useAuth } from '@components/Security/AuthContext';
import ToolTip from '@components/StyledElements/Tooltip/Tooltip'
import LearnHouseDashboardLogo from '@public/dashLogo.png';
import Avvvatars from 'avvvatars-react';
import { ArrowLeft, Book, Home, Settings } from 'lucide-react'
import Image from 'next/image';
import Link from 'next/link'
import React, { use, useEffect } from 'react'

function LeftMenu() {
    const org = useOrg() as any;
    const auth = useAuth() as any;
    const [loading, setLoading] = React.useState(true);

    function waitForEverythingToLoad() {
        if (org && auth) {
            return true;
        }
        return false;
    }

    useEffect(() => {
        if (waitForEverythingToLoad()) {
            setLoading(false);
        }
    }
        , [loading])


    return (
        <div
            style={{ background: "linear-gradient(0deg, rgba(0, 0, 0, 0.20) 0%, rgba(0, 0, 0, 0.20) 100%), radial-gradient(271.56% 105.16% at 50% -5.16%, rgba(255, 255, 255, 0.18) 0%, rgba(0, 0, 0, 0.00) 100%), #2E2D2D" }}
            className='flex flex-col w-24 bg-black h-screen  text-white shadow-xl'>
            <div className='flex flex-col h-full'>
                <div className='flex h-20 mt-6'>
                    <Link className='mx-auto' href={"/dash"}>
                        <Image alt="Learnhouse logo" width={40} src={LearnHouseDashboardLogo} />
                    </Link>
                </div>
                <div className='flex grow flex-col justify-center space-y-5 items-center mx-auto'>
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
                <div className='flex flex-col mx-auto pb-7 space-y-2'>
                    <Link href={'/dash/user/settings'} className='py-3'>
                        <Settings className='mx-auto text-neutral-400 cursor-pointer' size={18} />
                    </Link>
                    <div className="flex items-center">
                        <div className="mx-auto shadow-lg">
                            <Avvvatars radius={3} border borderColor='white' borderSize={3} size={35} value={auth.user.user_uuid} style="shape" />
                        </div>
                    </div>
                    <div className="text-xs px-4 text-gray-200 ">{auth.user.username}</div>

                </div>
            </div>


        </div>
    )
}

export default LeftMenu

