'use client';
import BreadCrumbs from '@components/Dashboard/UI/BreadCrumbs'
import Link from 'next/link'
import React from 'react'

function CoursesHome() {
    return (
        <div>
            <div className='h-full w-fullbg-white'>
            <div className='pl-10 tracking-tighter'>
            <BreadCrumbs type='courses'  />
                <div className='flex pt-2'>
                    <div className='font-bold text-4xl'>Courses</div>
                </div>
            </div>

        </div>
        </div>
    )
}

export default CoursesHome