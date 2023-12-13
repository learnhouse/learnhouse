'use client';
import React, { useEffect } from 'react'
import { motion } from 'framer-motion';
import UserEditGeneral from '@components/Dashboard/User/UserEditGeneral/UserEditGeneral';
import UserEditPassword from '@components/Dashboard/User/UserEditPassword/UserEditPassword';
import Link from 'next/link';
import { getUriWithOrg } from '@services/config/config';
import { Info, Lock } from 'lucide-react';
import BreadCrumbs from '@components/Dashboard/UI/BreadCrumbs';
import { useAuth } from '@components/Security/AuthContext';

export type SettingsParams = {
    subpage: string
    orgslug: string
}

function SettingsPage({ params }: { params: SettingsParams }) {
    const auth = useAuth() as any;


    useEffect(() => {
    }
        , [auth])

    return (
        <div className='h-full w-full bg-[#f8f8f8]'>
            <div className='pl-10 pr-10  tracking-tight bg-[#fcfbfc] shadow-[0px_4px_16px_rgba(0,0,0,0.02)]'>
                <BreadCrumbs type='user' last_breadcrumb={auth?.user?.username} ></BreadCrumbs>
                <div className='my-2 tracking-tighter'>
                    <div className='w-100 flex justify-between'>
                        <div className='pt-3 flex font-bold text-4xl'>Account Settings</div>
                    </div>
                </div>
                <div className='flex space-x-5 font-black text-sm'>
                    <Link href={getUriWithOrg(params.orgslug, "") + `/dash/user/settings/general`}>
                        <div className={`py-2 w-fit text-center border-black transition-all ease-linear ${params.subpage.toString() === 'general' ? 'border-b-4' : 'opacity-50'} cursor-pointer`}>

                            <div className='flex items-center space-x-2.5 mx-2'>
                                <Info size={16} />
                                <div>General</div>
                            </div>
                        </div>
                    </Link>
                    <Link href={getUriWithOrg(params.orgslug, "") + `/dash/user/settings/security`}>
                        <div className={`flex space-x-4 py-2 w-fit text-center border-black transition-all ease-linear ${params.subpage.toString() === 'security' ? 'border-b-4' : 'opacity-50'} cursor-pointer`}>
                            <div className='flex items-center space-x-2.5 mx-2'>
                                <Lock size={16} />
                                <div>Password</div>
                            </div>

                        </div>
                    </Link>
                </div>
            </div>
            <div className='h-6'></div>
            <motion.div
                initial={{ opacity: 0, }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.10, type: "spring", stiffness: 80 }}
            >
                {params.subpage == 'general' ? <UserEditGeneral /> : ''}
                {params.subpage == 'security' ? <UserEditPassword /> : ''}
            </motion.div>
        </div>
    )
}

export default SettingsPage