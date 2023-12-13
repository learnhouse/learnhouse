import { useCourse } from "@components/Dashboard/CourseContext";
import { useEffect } from "react";
import BreadCrumbs from "./BreadCrumbs";
import SaveState from "./SaveState";
import { CourseOverviewParams } from "app/orgs/[orgslug]/dash/courses/course/[courseuuid]/[subpage]/page";

export function CourseOverviewTop({ params }: { params: CourseOverviewParams }) {
    const course = useCourse() as any;

    useEffect(() => { }
        , [course])

    return (
        <>
            <BreadCrumbs type='courses' last_breadcrumb={course.courseStructure.name} ></BreadCrumbs>
            <div className='flex'>
                <div className='flex py-5 grow items-center'>
                    <div className="image rounded-lg shadow-md bg-gray-900 w-28 h-14"></div>
                    <div className="flex flex-col course_metadata justify-center pl-5">
                        <div className='text-gray-400 font-semibold text-sm'>Course</div>
                        <div className='text-black font-bold text-xl -mt-1 first-letter:uppercase'>{course.courseStructure.name}</div>
                    </div>
                </div>
                <div className='flex items-center'>
                    <SaveState orgslug={params.orgslug} />
                </div>
            </div>
        </>
    )

}