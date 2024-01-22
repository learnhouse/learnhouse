'use client';
import { useOrg } from '@components/Contexts/OrgContext';
import { useSession } from '@components/Contexts/SessionContext';
import ToolTip from '@components/StyledElements/Tooltip/Tooltip'
import LearnHouseDashboardLogo from '@public/dashLogo.png';
import { logout } from '@services/auth/auth';
import { ArrowLeft, Book, BookCopy, Home, LogOut, School, Settings, Users } from 'lucide-react'
import Image from 'next/image';
import Link from 'next/link'
import { useRouter } from 'next/navigation';
import React, { use, useEffect } from 'react'
import UserAvatar from '../../Objects/UserAvatar';

function LeftMenu() {
    const org = useOrg() as any;
    const session = useSession() as any;
    const [loading, setLoading] = React.useState(true);
    const route = useRouter();

    function waitForEverythingToLoad() {
        if (org && session) {
            return true;
        }
        return false;
    }

    async function logOutUI() {
        const res = await logout();
        if (res) {
            route.push('/login');
        }

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
            className='flex flex-col w-28 bg-black h-screen  text-white shadow-xl'>
            <div className='flex flex-col h-full'>
                <div className='flex h-20 mt-6'>
                    <Link className='flex flex-col items-center mx-auto space-y-3' href={"/"}>
                        <ToolTip content={'Back to Home'} slateBlack sideOffset={8} side='right'  >
                            <Image alt="Learnhouse logo" width={40} src={LearnHouseDashboardLogo} />
                        </ToolTip>
                        <ToolTip content={'Your Organization'} slateBlack sideOffset={8} side='right'  >
                            <div className='py-1 px-3 bg-black/40 opacity-40 rounded-md text-[10px] justify-center text-center'>{org?.name}</div>
                        </ToolTip>
                    </Link>
                </div>
                <div className='flex grow flex-col justify-center space-y-5 items-center mx-auto'>
                    {/* <ToolTip content={"Back to " + org?.name + "'s Home"} slateBlack sideOffset={8} side='right'  >
                        <Link className='bg-white text-black hover:text-white rounded-lg p-2 hover:bg-white/10 transition-all ease-linear' href={`/`} ><ArrowLeft className='hover:text-white' size={18} /></Link>
                    </ToolTip> */}
                    <ToolTip content={"Home"} slateBlack sideOffset={8} side='right'  >
                        <Link className='bg-white/5 rounded-lg p-2 hover:bg-white/10 transition-all ease-linear' href={`/dash`} ><Home size={18} /></Link>
                    </ToolTip>
                    <ToolTip content={"Courses"} slateBlack sideOffset={8} side='right'  >
                        <Link className='bg-white/5 rounded-lg p-2 hover:bg-white/10 transition-all ease-linear' href={`/dash/courses`} ><BookCopy size={18} /></Link>
                    </ToolTip>
                    <ToolTip content={"Users"} slateBlack sideOffset={8} side='right'  >
                        <Link className='bg-white/5 rounded-lg p-2 hover:bg-white/10 transition-all ease-linear' href={`/dash/users/settings/users`} ><Users size={18} /></Link>
                    </ToolTip>
                    <ToolTip content={"Organization"} slateBlack sideOffset={8} side='right'  >
                        <Link className='bg-white/5 rounded-lg p-2 hover:bg-white/10 transition-all ease-linear' href={`/dash/org/settings/general`} ><School size={18} /></Link>
                    </ToolTip>
                </div>
                <div className='flex flex-col mx-auto pb-7 space-y-2'>

                    <div className="flex items-center flex-col space-y-2">
                        <ToolTip content={'@'+session.user.username} slateBlack sideOffset={8} side='right'  >
                            <div className='mx-auto'>
                                <UserAvatar border='border-4' width={35} />
                                </div>
                        </ToolTip>
                        <div className='flex items-center flex-col space-y-1'>
                            <ToolTip content={session.user.username + "'s Settings"} slateBlack sideOffset={8} side='right'  >
                                <Link href={'/dash/user-account/settings/general'} className='py-3'>
                                    <Settings className='mx-auto text-neutral-400 cursor-pointer' size={18} />
                                </Link>
                            </ToolTip>
                            <ToolTip content={'Logout'} slateBlack sideOffset={8} side='right'  >
                                <LogOut onClick={() => logOutUI()} className='mx-auto text-neutral-400 cursor-pointer' size={14} />
                            </ToolTip>
                        </div>
                    </div>

                </div>
            </div>


        </div>
    )
}

export default LeftMenu

