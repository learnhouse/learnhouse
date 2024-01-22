'use client';
import React, { useEffect } from 'react'
import { motion } from 'framer-motion';
import UserEditGeneral from '@components/Dashboard/UserAccount/UserEditGeneral/UserEditGeneral';
import UserEditPassword from '@components/Dashboard/UserAccount/UserEditPassword/UserEditPassword';
import Link from 'next/link';
import { getUriWithOrg } from '@services/config/config';
import { Info, Lock, User, Users } from 'lucide-react';
import BreadCrumbs from '@components/Dashboard/UI/BreadCrumbs';
import { useSession } from '@components/Contexts/SessionContext';
import { useOrg } from '@components/Contexts/OrgContext';
import OrgUsers from '@components/Dashboard/Users/OrgUsers/OrgUsers';

export type SettingsParams = {
    subpage: string
    orgslug: string
}

function UsersSettingsPage({ params }: { params: SettingsParams }) {
    const session = useSession() as any;
    const org = useOrg() as any;


    useEffect(() => {
    }
        , [session, org])

    return (
        <div className='h-screen w-full bg-[#f8f8f8] grid grid-rows-[auto,1fr]'>
            <div className='pl-10 pr-10  tracking-tight bg-[#fcfbfc] z-10 shadow-[0px_4px_16px_rgba(0,0,0,0.06)]'>
                <BreadCrumbs type='org' last_breadcrumb='User settings' ></BreadCrumbs>
                <div className='my-2 tracking-tighter'>
                    <div className='w-100 flex justify-between'>
                        <div className='pt-3 flex font-bold text-4xl'>Organization Users Settings</div>
                    </div>
                </div>
                <div className='flex space-x-5 font-black text-sm'>
                    <Link href={getUriWithOrg(params.orgslug, "") + `/dash/users/settings/users`}>
                        <div className={`py-2 w-fit text-center border-black transition-all ease-linear ${params.subpage.toString() === 'users' ? 'border-b-4' : 'opacity-50'} cursor-pointer`}>

                            <div className='flex items-center space-x-2.5 mx-2'>
                                <Users size={16} />
                                <div>Users</div>
                            </div>
                        </div>
                    </Link>

                </div>
            </div>
            <motion.div
                initial={{ opacity: 0, }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.10, type: "spring", stiffness: 80 }}
                className='h-full overflow-y-auto'
            >
                {params.subpage == 'users' ? <OrgUsers /> : ''}
            </motion.div>
        </div>
    )
}

export default UsersSettingsPage