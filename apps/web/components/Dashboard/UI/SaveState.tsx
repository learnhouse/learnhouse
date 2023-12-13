'use client';
import { getAPIUrl } from '@services/config/config';
import { updateCourseOrderStructure } from '@services/courses/chapters';
import { revalidateTags } from '@services/utils/ts/requests';
import { useCourse, useCourseDispatch } from '@components/Dashboard/CourseContext'
import { Check, SaveAllIcon, Timer } from 'lucide-react'
import { useRouter } from 'next/navigation';
import React, { useEffect } from 'react'
import { mutate } from 'swr';

function SaveState(props: { orgslug: string }) {
    const course = useCourse() as any;
    const router = useRouter();
    const saved = course ? course.isSaved : true;
    const dispatchCourse = useCourseDispatch() as any;
    const course_structure = course.courseStructure;

    const saveCourseState = async () => {
        // Course structure & order 
        if (saved) return;
        await changeOrderBackend();
        mutate(`${getAPIUrl()}courses/${course.courseStructure.course_uuid}/meta`);
        dispatchCourse({ type: 'setIsSaved' })
    }


    // 
    // Course Order 
    const changeOrderBackend = async () => {
        mutate(`${getAPIUrl()}courses/${course.courseStructure.course_uuid}/meta`);
        await updateCourseOrderStructure(course.courseStructure.course_uuid, course.courseOrder);
        await revalidateTags(['courses'], props.orgslug)
        router.refresh();
        dispatchCourse({ type: 'setIsSaved' })
    }



    const handleCourseOrder = (course_structure: any) => {
        const chapters = course_structure.chapters;
        const chapter_order_by_ids = chapters.map((chapter: any) => {
            return {
                chapter_id: chapter.id,
                activities_order_by_ids: chapter.activities.map((activity: any) => {
                    return {
                        activity_id: activity.id
                    }
                })
            }
        })
        dispatchCourse({ type: 'setCourseOrder', payload: { chapter_order_by_ids: chapter_order_by_ids } })
        dispatchCourse({ type: 'setIsNotSaved' })
    }

    const initOrderPayload = () => {
        if (course_structure && course_structure.chapters) {
            handleCourseOrder(course_structure);
            dispatchCourse({ type: 'setIsSaved' })

        }
    }

    const changeOrderPayload = () => {
        if (course_structure && course_structure.chapters) {
            handleCourseOrder(course_structure);
            dispatchCourse({ type: 'setIsNotSaved' })

        }
    }

    useEffect(() => {
        if (course_structure?.chapters) {
            initOrderPayload();
        }
        if (course_structure?.chapters && !saved) {
            changeOrderPayload();
        }
    }, [course_structure]); // This effect depends on the `course_structure` variable

    return (
        <div className='flex space-x-4'>
            {saved ? <></> : <div className='text-gray-600 flex space-x-2 items-center antialiased'>
                <Timer size={15} />
                <div>
                    Unsaved changes
                </div>

            </div>}
            <div className={`px-4 py-2 rounded-lg drop-shadow-md cursor-pointer flex space-x-2 items-center font-bold antialiased transition-all ease-linear ` + (saved ? 'bg-gray-600 text-white' : 'bg-black text-white border hover:bg-gray-900 ')
            } onClick={saveCourseState}>

                {saved ? <Check size={20} /> : <SaveAllIcon size={20} />}
                {saved ? <div className=''>Saved</div> : <div className=''>Save</div>}
            </div>
        </div>

    )
}

export default SaveState