"use client";
import React, { FC, useEffect, useReducer } from 'react'
import { revalidateTags, swrFetcher } from "@services/utils/ts/requests";
import { getAPIUrl, getUriWithOrg } from '@services/config/config';
import useSWR, { mutate } from 'swr';
import { getCourseThumbnailMediaDirectory } from '@services/media/media';
import Link from 'next/link';
import CourseEdition from '../subpages/CourseEdition';
import CourseContentEdition from '../subpages/CourseContentEdition';
import ErrorUI from '@components/StyledElements/Error/Error';
import { updateChaptersMetadata } from '@services/courses/chapters';
import { Check, SaveAllIcon, Timer } from 'lucide-react';
import Loading from '../../loading';
import { updateCourse } from '@services/courses/courses';
import { useRouter } from 'next/navigation';

function CourseEditClient({ courseuuid, courseid, subpage, params }: { courseid: any, courseuuid: string, subpage: string, params: any }) {
    const { data: chapters_meta, error: chapters_meta_error, isLoading: chapters_meta_isloading } = useSWR(`${getAPIUrl()}chapters/course/course_${courseuuid}/meta`, swrFetcher);
    const { data: course, error: course_error, isLoading: course_isloading } = useSWR(`${getAPIUrl()}courses/course_${courseuuid}/meta`, swrFetcher);
    const [courseChaptersMetadata, dispatchCourseChaptersMetadata] = useReducer(courseChaptersReducer, {});
    const [courseState, dispatchCourseMetadata] = useReducer(courseReducer, {});
    const [savedContent, dispatchSavedContent] = useReducer(savedContentReducer, true);
    const router = useRouter();


    // This function is a quick fix to transform the payload object from what was used before to the new and improved format
    // The entire course edition frontend code will be remade in the future in a proper way.
    const ConvertToNewAPIOrderUpdatePayload = (courseChaptersMetadata: any) => {
        const old_format = courseChaptersMetadata
        console.log()

        // Convert originalObject to the desired format
        const convertedObject = {
            "chapter_order_by_ids": old_format.chapterOrder.map((chapterId: string | number, chapterIndex: any) => {
                const chapter = old_format.chapters[chapterId];
                return {
                    "chapter_id": chapter.id,
                    "activities_order_by_ids": chapter.activityIds.map((activityId: any, activityIndex: any) => {
                        return {
                            "activity_id": activityIndex
                        };
                    })
                };
            })
        };

        return convertedObject
    }



    function courseChaptersReducer(state: any, action: any) {
        switch (action.type) {
            case 'updated_chapter':
                // action will contain the entire state, just update the entire state 
                return action.payload;
            default:
                throw new Error();
        }
    }

    function courseReducer(state: any, action: any) {
        switch (action.type) {
            case 'updated_course':
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

    async function saveCourse() {
        if (subpage.toString() === 'content') {
            let payload = ConvertToNewAPIOrderUpdatePayload(courseChaptersMetadata)
            await updateChaptersMetadata(courseuuid, payload)
            dispatchSavedContent({ type: 'saved_content' })
            await mutate(`${getAPIUrl()}chapters/course/course_${courseuuid}/meta`)
            await revalidateTags(['courses'], params.params.orgslug)
            router.refresh()
        }
        else if (subpage.toString() === 'general') {
            await updateCourse(courseuuid, courseState)
            dispatchSavedContent({ type: 'saved_content' })
            await mutate(`${getAPIUrl()}courses/course_${courseuuid}`)
            await mutate(`${getAPIUrl()}chapters/course/course_${courseuuid}/meta`)
            await revalidateTags(['courses'], params.params.orgslug)
            router.refresh()
        }
    }

    useEffect(() => {

        if (chapters_meta) {
            dispatchCourseChaptersMetadata({ type: 'updated_chapter', payload: chapters_meta })
            dispatchSavedContent({ type: 'saved_content' })
        }
        if (course) {
            dispatchCourseMetadata({ type: 'updated_course', payload: course })
            dispatchSavedContent({ type: 'saved_content' })
        }
    }, [chapters_meta, course])

    return (
        <>
            <div className='bg-white shadow-[0px_4px_16px_rgba(0,0,0,0.02)]'>
                <div className='max-w-screen-2xl mx-auto px-16 pt-5 tracking-tight'>
                    {course_isloading && <div className='text-sm text-gray-500'>Loading...</div>}
                    {course && <>
                        <div className='flex items-center'><div className='info flex space-x-5 items-center grow'>
                            <div className='flex'>
                                <Link href={getUriWithOrg(params.params.orgslug, "") + `/course/${courseuuid}`}>
                                    <img className="w-[100px] h-[57px] rounded-md drop-shadow-md" src={`${getCourseThumbnailMediaDirectory(course.org_id, "course_" + courseuuid, course.thumbnail)}`} alt="" />
                                </Link>
                            </div>
                            <div className="flex flex-col ">
                                <div className='text-sm text-gray-500'>Edit Course</div>
                                <div className='text-2xl font-bold first-letter:uppercase'>{course.name}</div>
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
                        <Link href={getUriWithOrg(params.params.orgslug, "") + `/course/${courseuuid}/edit/general`}>
                            <div className={`py-2 w-16 text-center border-black transition-all ease-linear ${subpage.toString() === 'general' ? 'border-b-4' : 'opacity-50'} cursor-pointer`}>General</div>
                        </Link>
                        <Link href={getUriWithOrg(params.params.orgslug, "") + `/course/${courseuuid}/edit/content`}>
                            <div className={`py-2 w-16 text-center border-black transition-all ease-linear ${subpage.toString() === 'content' ? 'border-b-4' : 'opacity-50'} cursor-pointer`}>Content</div>
                        </Link>
                    </div>
                </div>
            </div>
            <CoursePageViewer course={course} dispatchSavedContent={dispatchSavedContent} courseState={courseState} courseChaptersMetadata={courseChaptersMetadata} dispatchCourseMetadata={dispatchCourseMetadata} dispatchCourseChaptersMetadata={dispatchCourseChaptersMetadata} subpage={subpage} courseuuid={courseuuid} orgslug={params.params.orgslug} />
        </>

    )
}

const CoursePageViewer = ({ subpage, course, orgslug, dispatchCourseMetadata, dispatchCourseChaptersMetadata, courseChaptersMetadata, dispatchSavedContent, courseState }: { subpage: string, courseuuid: string, orgslug: string, dispatchCourseChaptersMetadata: React.Dispatch<any>, dispatchCourseMetadata: React.Dispatch<any>, dispatchSavedContent: React.Dispatch<any>, courseChaptersMetadata: any, courseState: any, course: any }) => {

    if (subpage.toString() === 'general' && Object.keys(courseState).length !== 0 && course) {
        return <CourseEdition course={course} orgslug={orgslug} course_chapters_with_orders_and_activities={courseState} dispatchCourseMetadata={dispatchCourseMetadata} dispatchSavedContent={dispatchSavedContent} />
    }
    else if (subpage.toString() === 'content' && Object.keys(courseChaptersMetadata).length !== 0 && course) {
        return <CourseContentEdition course={course} orgslug={orgslug} course_chapters_with_orders_and_activities={courseChaptersMetadata} dispatchSavedContent={dispatchSavedContent} dispatchCourseChaptersMetadata={dispatchCourseChaptersMetadata} />
    }
    else if (subpage.toString() === 'content' || subpage.toString() === 'general') {
        return <Loading />
    }
    else {
        return <ErrorUI />
    }

}

export default CourseEditClient