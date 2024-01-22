import Image from 'next/image'
import React from 'react'
import learnhousetextlogo from '../../../../public/learnhouse_logo.png'
import learnhouseiconlogo from '../../../../public/learnhouse_bigicon.png'
import { BookCopy, School, Settings, Users } from 'lucide-react'
import Link from 'next/link'

function DashboardHome() {
    return (
        <div className="flex items-center justify-center mx-auto min-h-screen flex-col space-x-3">
            <div className='mx-auto pb-10'>
                <Image alt='learnhouse logo' width={230} src={learnhousetextlogo}></Image>
            </div>
            <div className='flex space-x-10'>
                <Link href={`/dash/courses`} className='flex bg-white shadow-lg p-[35px] w-[250px] rounded-lg items-center mx-auto hover:scale-105 transition-all ease-linear cursor-pointer'>
                    <div className='flex flex-col mx-auto space-y-2'>
                        <BookCopy className='mx-auto text-gray-500' size={50}></BookCopy>
                        <div className='text-center font-bold text-gray-500'>Courses</div>
                        <p className='text-center text-sm text-gray-400'>Create and manage courses, chapters and ativities </p>
                    </div>
                </Link>
                <Link href={`/dash/org/settings/general`} className='flex bg-white shadow-lg p-[35px] w-[250px] rounded-lg  items-center mx-auto hover:scale-105 transition-all ease-linear cursor-pointer'>
                    <div className='flex flex-col mx-auto space-y-2'>
                        <School className='mx-auto text-gray-500' size={50}></School>
                        <div className='text-center font-bold text-gray-500'>Organization</div>
                        <p className='text-center text-sm text-gray-400'>Configure your Organization general settings </p>
                    </div>
                </Link>
                <Link href={`/dash/users/settings/users`} className='flex bg-white shadow-lg p-[35px] w-[250px] rounded-lg  items-center mx-auto hover:scale-105 transition-all ease-linear cursor-pointer'>
                    <div className='flex flex-col mx-auto space-y-2'>
                        <Users className='mx-auto text-gray-500' size={50}></Users>
                        <div className='text-center font-bold text-gray-500'>Users</div>
                        <p className='text-center text-sm text-gray-400'>Manage your Organization's users, roles </p>
                    </div>
                </Link>

            </div>
            <div className='flex flex-col space-y-10 '>
                <div className='h-1 w-[100px] bg-neutral-200 rounded-full mx-auto'></div>
                <div className="flex justify-center items-center">
                    <Link href={'https://learn.learnhouse.io/'} className='flex mt-[40px]  bg-black space-x-2 items-center py-3 px-7 rounded-lg shadow-lg hover:scale-105 transition-all ease-linear cursor-pointer'>
                        <BookCopy className=' text-gray-100' size={20}></BookCopy>
                        <div className=' text-sm font-bold text-gray-100'>Learn LearnHouse</div>
                    </Link>
                </div>
                <div className='mx-auto mt-[40px] w-28 h-1 bg-neutral-200 rounded-full'></div>
                <Link href={'/dash/user-account/settings/general'} className='flex bg-white shadow-lg p-[15px] items-center rounded-lg  items-center mx-auto hover:scale-105 transition-all ease-linear cursor-pointer'>
                    <div className='flex flex-row mx-auto space-x-3 items-center'>
                        <Settings className=' text-gray-500' size={20}></Settings>
                        <div className=' font-bold text-gray-500'>Account Settings</div>
                        <p className=' text-sm text-gray-400'>Configure your personal settings, passwords, email</p>
                    </div>
                </Link>
            </div>
        </div>
    )
}

export default DashboardHome