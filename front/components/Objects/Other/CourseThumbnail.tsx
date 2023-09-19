"use client";
import AuthenticatedClientElement from '@components/Security/AuthenticatedClientElement';
import ConfirmationModal from '@components/StyledElements/ConfirmationModal/ConfirmationModal';
import { getUriWithOrg } from '@services/config/config';
import { deleteCourseFromBackend } from '@services/courses/courses';
import { getCourseThumbnailMediaDirectory } from '@services/media/media';
import { revalidateTags } from '@services/utils/ts/requests';
import { FileEdit, Pencil, X } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import React from 'react'

type PropsType = {
    course: any,
    orgslug: string
}

// function to remove "course_" from the course_id
function removeCoursePrefix(course_id: string) {
    return course_id.replace("course_", "");
}

function CourseThumbnail(props: PropsType) {
    const router = useRouter();

    async function deleteCourses(course_id: any) {
        await deleteCourseFromBackend(course_id);
        await revalidateTags(['courses'], props.orgslug);

        router.refresh();
    }

    return (
        <div className='relative'>
            <AdminEditsArea course={props.course} orgSlug={props.orgslug} courseId={props.course.course_id} deleteCourses={deleteCourses} />
            <Link href={getUriWithOrg(props.orgslug, "/course/" + removeCoursePrefix(props.course.course_id))}>
                <div className="inset-0 ring-1 ring-inset ring-black/10 rounded-xl shadow-xl  w-[249px] h-[131px] bg-cover" style={{ backgroundImage: `url(${getCourseThumbnailMediaDirectory(props.course.org_id, props.course.course_id, props.course.thumbnail)})` }}>

                </div>
            </Link>
            <h2 className="font-bold text-lg w-[250px] py-2">{props.course.name}</h2>
        </div>
    )
}

const AdminEditsArea = (props: { orgSlug: string, courseId: string, course: any, deleteCourses: any }) => {
    return (
        <AuthenticatedClientElement checkMethod='roles' orgId={props.course.org_id}>
            <div className="flex space-x-1 absolute justify-center mx-auto z-20 bottom-14 left-1/2 transform -translate-x-1/2">
                <Link href={getUriWithOrg(props.orgSlug, "/course/" + removeCoursePrefix(props.courseId) + "/edit")}>
                    <div
                        className=" hover:cursor-pointer p-1 px-4 bg-orange-600 rounded-xl items-center justify-center flex shadow-lg"
                        rel="noopener noreferrer">
                        <FileEdit size={14} className="text-orange-200 font-bold" />
                    </div>
                </Link>
                <ConfirmationModal
                    confirmationButtonText='Delete Course'
                    confirmationMessage='Are you sure you want to delete this course?'
                    dialogTitle={'Delete ' + props.course.name + ' ?'}
                    dialogTrigger={
                        <div
                            className=" hover:cursor-pointer p-1 px-4 bg-red-600 rounded-xl items-center justify-center flex shadow-lg"
                            rel="noopener noreferrer">
                            <X size={14} className="text-rose-200 font-bold" />
                        </div>}
                    functionToExecute={() => props.deleteCourses(props.courseId)}
                    status='warning'
                ></ConfirmationModal>

            </div>
        </AuthenticatedClientElement>
    )
}

export default CourseThumbnail