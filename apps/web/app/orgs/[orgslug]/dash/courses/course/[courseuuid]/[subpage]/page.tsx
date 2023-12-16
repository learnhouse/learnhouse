'use client';
import EditCourseStructure from '../../../../../../../../components/Dashboard/Course/EditCourseStructure/EditCourseStructure'
import BreadCrumbs from '@components/Dashboard/UI/BreadCrumbs'
import PageLoading from '@components/Objects/Loaders/PageLoading';
import ClientComponentSkeleton from '@components/Utils/ClientComp';
import { getAPIUrl, getUriWithOrg } from '@services/config/config';
import { swrFetcher } from '@services/utils/ts/requests';
import React, { createContext, use, useEffect, useState } from 'react'
import useSWR from 'swr';
import { CourseProvider, useCourse } from '../../../../../../../../components/Contexts/CourseContext';
import SaveState from '@components/Dashboard/UI/SaveState';
import Link from 'next/link';
import { CourseOverviewTop } from '@components/Dashboard/UI/CourseOverviewTop';
import { CSSTransition } from 'react-transition-group';
import { motion } from 'framer-motion';
import EditCourseGeneral from '@components/Dashboard/Course/EditCourseGeneral/EditCourseGeneral';
import { GalleryVertical, GalleryVerticalEnd, Info } from 'lucide-react';

export type CourseOverviewParams = {
    orgslug: string,
    courseuuid: string,
    subpage: string
}



function CourseOverviewPage({ params }: { params: CourseOverviewParams }) {

    function getEntireCourseUUID(courseuuid: string) {
        // add course_ to uuid 
        return `course_${courseuuid}`
    }

    return (
        <div className='h-full w-full bg-[#f8f8f8]'>
            <CourseProvider courseuuid={getEntireCourseUUID(params.courseuuid)}>
                <div className='pl-10 pr-10  tracking-tight bg-[#fcfbfc] shadow-[0px_4px_16px_rgba(0,0,0,0.02)]'>
                    <CourseOverviewTop params={params} />
                    <div className='flex space-x-5 font-black text-sm'>
                        <Link href={getUriWithOrg(params.orgslug, "") + `/dash/courses/course/${params.courseuuid}/general`}>
                            <div className={`py-2 w-fit text-center border-black transition-all ease-linear ${params.subpage.toString() === 'general' ? 'border-b-4' : 'opacity-50'} cursor-pointer`}>

                                <div className='flex items-center space-x-2.5 mx-2'>
                                    <Info size={16} />
                                    <div>General</div>
                                </div>
                            </div>
                        </Link>
                        <Link href={getUriWithOrg(params.orgslug, "") + `/dash/courses/course/${params.courseuuid}/content`}>
                            <div className={`flex space-x-4 py-2 w-fit text-center border-black transition-all ease-linear ${params.subpage.toString() === 'content' ? 'border-b-4' : 'opacity-50'} cursor-pointer`}>
                                <div className='flex items-center space-x-2.5 mx-2'>
                                    <GalleryVerticalEnd size={16} />
                                    <div>Content</div>
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
                    {params.subpage == 'content' ? <EditCourseStructure orgslug={params.orgslug} /> : ''}
                    {params.subpage == 'general' ? <EditCourseGeneral orgslug={params.orgslug} /> : ''}
                </motion.div>
            </CourseProvider>
        </div>
    )
}





export default CourseOverviewPage