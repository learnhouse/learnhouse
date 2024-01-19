"use client";
import { useOrg } from '@components/Contexts/OrgContext';
import AuthenticatedClientElement from '@components/Security/AuthenticatedClientElement';
import ConfirmationModal from '@components/StyledElements/ConfirmationModal/ConfirmationModal';
import { DotsHorizontalIcon } from '@radix-ui/react-icons';
import { getUriWithOrg } from '@services/config/config';
import { deleteCourseFromBackend } from '@services/courses/courses';
import { getCourseThumbnailMediaDirectory } from '@services/media/media';
import { revalidateTags } from '@services/utils/ts/requests';
import { FileEdit, MoreHorizontal, Settings, X } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import React, { use, useEffect } from 'react'

type PropsType = {
    course: any,
    orgslug: string
}

// function to remove "course_" from the course_uuid
function removeCoursePrefix(course_uuid: string) {
    return course_uuid.replace("course_", "");
}

function CourseThumbnail(props: PropsType) {
    const router = useRouter();
    const org = useOrg() as any;

    async function deleteCourses(course_uuid: any) {
        await deleteCourseFromBackend(course_uuid);
        await revalidateTags(['courses'], props.orgslug);

        router.refresh();
    }

    useEffect(() => {

    }, [org]);

    return (
        <div className='relative'>
            <AdminEditsArea course={props.course} orgSlug={props.orgslug} courseId={props.course.course_uuid} deleteCourses={deleteCourses} />
            <Link href={getUriWithOrg(props.orgslug, "/course/" + removeCoursePrefix(props.course.course_uuid))}>

                {props.course.thumbnail_image ? <div className="inset-0 ring-1 ring-inset ring-black/10 rounded-xl shadow-xl w-[249px] h-[131px] bg-cover" style={{ backgroundImage: `url(${getCourseThumbnailMediaDirectory(org?.org_uuid, props.course.course_uuid, props.course.thumbnail_image)})` }} />
                    : <div className="inset-0 ring-1 ring-inset ring-black/10 rounded-xl shadow-xl w-[249px] h-[131px] bg-cover" style={{ backgroundImage: `url('../empty_thumbnail.png')` , backgroundSize:'contain' }} />}

            </Link>
            <h2 className="font-bold text-lg w-[250px] py-2">{props.course.name}</h2>
        </div>
    )
}

const AdminEditsArea = (props: { orgSlug: string, courseId: string, course: any, deleteCourses: any }) => {
    return (
        <AuthenticatedClientElement
            action="update"
            ressourceType="courses"
            checkMethod='roles' orgId={props.course.org_id}>
            <div className="flex space-x-2 absolute z-20 bottom-14 right-[15px] transform">
                <Link href={getUriWithOrg(props.orgSlug, "/dash/courses/course/" + removeCoursePrefix(props.courseId) + "/general")}>
                    <div
                        className=" hover:cursor-pointer p-1 px-4 bg-slate-700 rounded-xl items-center  flex shadow-xl"
                        rel="noopener noreferrer">
                        <Settings size={14} className="text-slate-200 font-bold" />
                    </div>
                </Link>
                <ConfirmationModal
                    confirmationButtonText='Delete Course'
                    confirmationMessage='Are you sure you want to delete this course?'
                    dialogTitle={'Delete ' + props.course.name + ' ?'}
                    dialogTrigger={
                        <div
                            className=" hover:cursor-pointer p-1 px-4 bg-red-600 rounded-xl items-center justify-center flex shadow-xl"
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