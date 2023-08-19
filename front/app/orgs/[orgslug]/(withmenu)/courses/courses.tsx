'use client';
import CreateCourseModal from '@components/Objects/Modals/Course/Create/CreateCourse';
import Modal from '@components/StyledElements/Modal/Modal';
import { getBackendUrl, getUriWithOrg } from '@services/config/config';
import CoursesLogo from "public/svg/courses.svg";
import CollectionsLogo from "public/svg/collections.svg";
import { deleteCourseFromBackend } from '@services/courses/courses';
import Link from 'next/link';
import React from 'react'
import Image from 'next/image';
import { AuthContext } from '@components/Security/AuthProvider';
import { revalidateTags } from '@services/utils/ts/requests';
import { useRouter } from 'next/navigation';
import GeneralWrapperStyled from '@components/StyledElements/Wrappers/GeneralWrapper';
import TypeOfContentTitle from '@components/StyledElements/Titles/TypeOfContentTitle';
import AuthenticatedClientElement from '@components/Security/AuthenticatedClientElement';
import { getCourseThumbnailMediaDirectory } from '@services/media/media';
import ConfirmationModal from '@components/StyledElements/ConfirmationModal/ConfirmationModal';

interface CourseProps {
    orgslug: string;
    courses: any;
    org_id: string;
}

// function to remove "course_" from the course_id
function removeCoursePrefix(course_id: string) {
    return course_id.replace("course_", "");
}

function Courses(props: CourseProps) {
    const orgslug = props.orgslug;
    const courses = props.courses;
    const [newCourseModal, setNewCourseModal] = React.useState(false);
    const router = useRouter();

    async function deleteCourses(course_id: any) {
        await deleteCourseFromBackend(course_id);
        revalidateTags(['courses'], orgslug);

        router.refresh();
    }

    async function closeNewCourseModal() {
        setNewCourseModal(false);
    }

    return (
        <div>
            <GeneralWrapperStyled>

                <div className='flex flex-wrap justify-between'>
                    <TypeOfContentTitle title="Courses" type="cou" />
                    <AuthenticatedClientElement checkMethod='roles' orgId={props.org_id}>
                        <Modal
                            isDialogOpen={newCourseModal}
                            onOpenChange={setNewCourseModal}
                            minHeight="md"
                            dialogContent={<CreateCourseModal
                                closeModal={closeNewCourseModal}
                                orgslug={orgslug}
                            ></CreateCourseModal>}
                            dialogTitle="Create Course"
                            dialogDescription="Create a new course"
                            dialogTrigger={
                                <button className="rounded-md bg-black antialiased ring-offset-purple-800 p-2 px-5 my-auto font text-sm font-bold text-white drop-shadow-lg">Add Course + </button>
                            }
                        />
                    </AuthenticatedClientElement>
                </div>



                <div className="flex flex-wrap">
                    {courses.map((course: any) => (
                        <div className="px-3" key={course.course_id}>
                            <AdminEditsArea course={course} orgSlug={orgslug} courseId={course.course_id} deleteCourses={deleteCourses} />
                            <Link href={getUriWithOrg(orgslug, "/course/" + removeCoursePrefix(course.course_id))}>
                                <div className="inset-0 ring-1 ring-inset ring-black/10 rounded-lg shadow-xl relative w-[249px] h-[131px] bg-cover" style={{ backgroundImage: `url(${getCourseThumbnailMediaDirectory(course.org_id, course.course_id, course.thumbnail)})` }}>

                                </div>
                            </Link>
                            <h2 className="font-bold text-lg w-[250px] py-2">{course.name}</h2>
                        </div>
                    ))}
                </div>
            </GeneralWrapperStyled>
        </div>
    )
}

const AdminEditsArea = (props: { orgSlug: string, courseId: string, course: any, deleteCourses: any }) => {
    return (
        <AuthenticatedClientElement checkMethod='roles' orgId={props.course.org_id}><div className="flex space-x-2 py-2">
            <ConfirmationModal
                confirmationButtonText='Delete Course'
                confirmationMessage='Are you sure you want to delete this course?'
                dialogTitle={'Delete ' + props.course.name + ' ?'}
                dialogTrigger={
                    <button className="rounded-md text-sm px-3 font-bold text-red-800 bg-red-200 w-16 flex justify-center items-center" >
                        Delete
                    </button>}
                functionToExecute={() => props.deleteCourses(props.courseId)}
                status='warning'
            ></ConfirmationModal>
            <Link href={getUriWithOrg(props.orgSlug, "/course/" + removeCoursePrefix(props.courseId) + "/edit")}>
                <button className="rounded-md text-sm px-3 font-bold text-orange-800 bg-orange-200 w-16 flex justify-center items-center">
                    Edit
                </button>
            </Link>
        </div>
        </AuthenticatedClientElement>
    )
}


export default Courses