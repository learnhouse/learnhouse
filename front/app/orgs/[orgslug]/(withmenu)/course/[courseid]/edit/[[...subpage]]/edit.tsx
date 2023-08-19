"use client";
import React, { FC, use, useEffect, useReducer } from 'react'
import { swrFetcher } from "@services/utils/ts/requests";
import { getAPIUrl, getUriWithOrg } from '@services/config/config';
import useSWR from 'swr';
import { getCourseThumbnailMediaDirectory } from '@services/media/media';
import Link from 'next/link';
import CourseEdition from '../subpages/CourseEdition';
import CourseContentEdition from '../subpages/CourseContentEdition';
import ErrorUI from '@components/StyledElements/Error/Error';
import { updateChaptersMetadata } from '@services/courses/chapters';
import { Check, SaveAllIcon, Timer } from 'lucide-react';

function CourseEditClient({ courseid, subpage, params }: { courseid: string, subpage: string, params: any }) {
    const { data: chapters_meta, error: chapters_meta_error, isLoading: chapters_meta_isloading } = useSWR(`${getAPIUrl()}chapters/meta/course_${courseid}`, swrFetcher);
    const { data: course_meta, error: course_meta_error, isLoading: course_meta_isloading } = useSWR(`${getAPIUrl()}courses/meta/course_${courseid}`, swrFetcher);
    const [courseChaptersMetadata, dispatchCourseChaptersMetadata] = useReducer(courseChaptersReducer, {});
    const [savedContent, dispatchSavedContent] = useReducer(savedContentReducer, true);


    function courseChaptersReducer(state: any, action: any) {
        switch (action.type) {
            case 'updated_chapter':
                // action will contain the entire state, just update the entire state 
                return action.payload;
            default:
                throw new Error();
        }
    }

    function savedContentReducer(state: any, action: any) {
        switch (action.type) {
            case 'saved_content':
                return true;
            case 'unsaved_content':
                return false;
            default:
                throw new Error();
        }
    }

    function saveCourse() {
        if (subpage.toString() === 'content') {
            updateChaptersMetadata(courseid, courseChaptersMetadata)
            dispatchSavedContent({ type: 'saved_content' })
        }
        else if (subpage.toString() === 'general') {
            console.log('general')
        }
    }

    useEffect(() => {
        if (chapters_meta) {
            dispatchCourseChaptersMetadata({ type: 'updated_chapter', payload: chapters_meta })
            dispatchSavedContent({ type: 'saved_content' })
        }
    }, [chapters_meta])

    return (
        <>
            <div className='bg-white shadow-[0px_4px_16px_rgba(0,0,0,0.02)]'>
                <div className='max-w-screen-2xl mx-auto px-16 pt-5 tracking-tight'>
                    {course_meta_isloading && <div className='text-sm text-gray-500'>Loading...</div>}
                    {course_meta && <>
                        <div className='flex items-center'><div className='info flex space-x-5 items-center grow'>
                            <div className='flex'>
                                <Link href={getUriWithOrg(course_meta.course.orgslug, "") + `/course/${courseid}`}>
                                    <img className="w-[100px] h-[57px] rounded-md drop-shadow-md" src={`${getCourseThumbnailMediaDirectory(course_meta.course.org_id, course_meta.course.course_id, course_meta.course.thumbnail)}`} alt="" />
                                </Link>
                            </div>
                            <div className="flex flex-col ">
                                <div className='text-sm text-gray-500'>Edit Course</div>
                                <div className='text-2xl font-bold first-letter:uppercase'>{course_meta.course.name}</div>
                            </div>
                        </div>
                            <div className='flex space-x-5 items-center'>
                                {savedContent ? <></> : <div className='text-gray-600 flex space-x-2 items-center antialiased'>
                                    <Timer size={15} />
                                    <div>
                                        Unsaved changes
                                    </div>

                                </div>}
                                <div className={`' px-4 py-2 rounded-lg drop-shadow-md cursor-pointer flex space-x-2 items-center font-bold antialiased transition-all ease-linear ` + (savedContent ? 'bg-gray-600 text-white' : 'bg-black text-white border hover:bg-gray-900 ')
                                } onClick={saveCourse}>

                                    {savedContent ? <Check size={20} /> : <SaveAllIcon size={20} />}
                                    {savedContent ? <div className=''>Saved</div> : <div className=''>Save</div>}
                                </div>
                            </div>
                        </div>
                    </>}
                    <div className='flex space-x-5 pt-3 font-black text-sm'>
                        <Link href={getUriWithOrg(params.params.orgslug, "") + `/course/${courseid}/edit/general`}>
                            <div className={`py-2 w-16 text-center border-black transition-all ease-linear ${subpage.toString() === 'general' ? 'border-b-4' : 'opacity-50'} cursor-pointer`}>General</div>
                        </Link>
                        <Link href={getUriWithOrg(params.params.orgslug, "") + `/course/${courseid}/edit/content`}>
                            <div className={`py-2 w-16 text-center border-black transition-all ease-linear ${subpage.toString() === 'content' ? 'border-b-4' : 'opacity-50'} cursor-pointer`}>Content</div>
                        </Link>
                    </div>
                </div>
            </div>
            <CoursePageViewer dispatchSavedContent={dispatchSavedContent} courseChaptersMetadata={courseChaptersMetadata} dispatchCourseChaptersMetadata={dispatchCourseChaptersMetadata} subpage={subpage} courseid={courseid} orgslug={params.params.orgslug} />
        </>

    )
}

const CoursePageViewer = ({ subpage, courseid, orgslug, dispatchCourseChaptersMetadata, courseChaptersMetadata, dispatchSavedContent }: { subpage: string, courseid: string, orgslug: string, dispatchCourseChaptersMetadata: React.Dispatch<any>, dispatchSavedContent: React.Dispatch<any>, courseChaptersMetadata: any }) => {
    if (subpage.toString() === 'general') {
        return <CourseEdition />
    }
    else if (subpage.toString() === 'content') {
        return <CourseContentEdition data={courseChaptersMetadata} dispatchSavedContent={dispatchSavedContent} dispatchCourseChaptersMetadata={dispatchCourseChaptersMetadata} courseid={courseid} orgslug={orgslug} />
    }
    else {
        return <ErrorUI />
    }

}

export default CourseEditClient