'use client';
import { getAPIUrl, getBackendUrl, getUriWithOrg } from '@services/config/config';
import { removeCourse } from '@services/courses/activity';
import { getCourseThumbnailMediaDirectory } from '@services/media/media';
import { revalidateTags } from '@services/utils/ts/requests';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { mutate } from 'swr';

interface TrailCourseElementProps {
    course: any
    orgslug: string
}

function TrailCourseElement(props: TrailCourseElementProps) {
    const courseid = props.course.course_id.replace("course_", "")
    const course = props.course
    const router = useRouter();

    async function quitCourse(course_id: string) {
        // Close activity
        let activity = await removeCourse(course_id, props.orgslug);
        // Mutate course
        revalidateTags(['courses'], props.orgslug);
        router.refresh();

        // Mutate 
        mutate(`${getAPIUrl()}trail/org_slug/${props.orgslug}/trail`);
    }

    return (
        <div className='trailcoursebox flex p-3 bg-white rounded-xl' style={{ boxShadow: '0px 4px 7px 0px rgba(0, 0, 0, 0.03)' }}>

            <Link href={getUriWithOrg(props.orgslug, "/course/" + courseid)}>
                <div className="course_tumbnail inset-0 ring-1 ring-inset ring-black/10 rounded-lg relative h-[50px] w-[72px] bg-cover bg-center" style={{ backgroundImage: `url(${getCourseThumbnailMediaDirectory(props.course.course_object.org_id, props.course.course_object.course_id, props.course.course_object.thumbnail)})`, boxShadow: '0px 4px 7px 0px rgba(0, 0, 0, 0.03)' }}></div>
            </Link>
            <div className="course_meta pl-5 flex-grow space-y-1">
                <div className="course_top">
                    <div className="course_info flex">
                        <div className="course_basic flex flex-col flex-end -space-y-2">
                            <p className='p-0 font-bold text-sm text-gray-700'>Course</p>
                            <div className="course_progress flex items-center space-x-2">
                                <h2 className='font-bold text-xl'>{course.course_object.name}</h2>
                                <div className='bg-slate-300 rounded-full w-[10px] h-[5px]'></div>
                                <h2>{course.progress}%</h2>
                            </div>
                        </div>
                        <div className="course_actions flex-grow flex flex-row-reverse">
                        <button onClick={() => quitCourse(course.course_id)} className="bg-red-200 text-red-700 hover:bg-red-300  rounded-full text-xs h-5 px-2 font-bold">Quit Course</button>
                        </div>
                    </div>
                </div>
                <div className="course_progress indicator w-full">
                    <div className="w-full bg-gray-200 rounded-full h-1.5 ">
                        <div className={`bg-teal-600 h-1.5 rounded-full`} style={{ width: `${course.progress}%` }} ></div>
                    </div>

                </div>
            </div>
        </div>
    )
}

export default TrailCourseElement