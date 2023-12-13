import { useCourse } from '@components/Contexts/CourseContext'
import { Book, ChevronRight, User } from 'lucide-react'
import Link from 'next/link'
import React, { use, useEffect } from 'react'

type BreadCrumbsProps = {
    type: 'courses' | 'user' | 'users',
    last_breadcrumb?: string
}

function BreadCrumbs(props: BreadCrumbsProps) {
    const course = useCourse() as any;

    return (
        <div>
            <div className='h-7'></div>
            <div className='text-gray-400 tracking-tight font-medium text-sm flex space-x-1'>
                <div className='flex items-center space-x-1'>
                    {props.type == 'courses' ? <div className='flex space-x-2 items-center'> <Book className='text-gray' size={14}></Book><Link href='/dash/courses'>Courses</Link></div> : ''}
                    {props.type == 'user' ? <div className='flex space-x-2 items-center'> <User className='text-gray' size={14}></User><Link href='/dash/user/settings/general'>Account Settings</Link></div> : ''}
                   
                    <div className='flex items-center space-x-1 first-letter:uppercase'>
                        {props.last_breadcrumb ? <ChevronRight size={17} /> : ''}
                        <div className='first-letter:uppercase'>  {props.last_breadcrumb}</div>
                    </div></div></div>

        </div>
    )
}

export default BreadCrumbs