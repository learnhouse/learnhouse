'use client';
import EditCourseStructure from '../../../../../../../../components/Dashboard/EditCourseStructure/EditCourseStructure'
import BreadCrumbs from '@components/Dashboard/UI/BreadCrumbs'
import PageLoading from '@components/Objects/Loaders/PageLoading';
import ClientComponentSkeleton from '@components/Utils/ClientComp';
import { getAPIUrl, getUriWithOrg } from '@services/config/config';
import { swrFetcher } from '@services/utils/ts/requests';
import React, { createContext, use, useEffect, useState } from 'react'
import useSWR from 'swr';
import { CourseProvider, useCourse } from '../../../../../../../../components/Dashboard/CourseContext';
import SaveState from '@components/Dashboard/UI/SaveState';
import Link from 'next/link';
import { CourseOverviewTop } from '@components/Dashboard/UI/CourseOverviewTop';

export type CourseOverviewParams = {
    orgslug: string,
    courseuuid: string,
    subpage: string
}

export const CourseStructureContext = createContext({}) as any;


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
                            <div className={`py-2 w-16 text-center border-black transition-all ease-linear ${params.subpage.toString() === 'general' ? 'border-b-4' : 'opacity-50'} cursor-pointer`}>General</div>
                        </Link>
                        <Link href={getUriWithOrg(params.orgslug, "") + `/dash/courses/course/${params.courseuuid}/structure`}>
                            <div className={`py-2 w-16 text-center border-black transition-all ease-linear ${params.subpage.toString() === 'structure' ? 'border-b-4' : 'opacity-50'} cursor-pointer`}>Structure</div>
                        </Link>
                    </div>
                </div>


                <div className='h-6'></div>
                {params.subpage == 'structure' ? <EditCourseStructure orgslug={params.orgslug} /> : ''}
                
            </CourseProvider>
        </div>
    )
}





export default CourseOverviewPage