'use client';
import CreateCourseModal from '@components/Modals/Course/Create/CreateCourse';
import Modal from '@components/UI/Modal/Modal';
import { Edit2, Trash } from "lucide-react";
import { getAPIUrl, getBackendUrl, getUriWithOrg } from '@services/config/config';
import CoursesLogo from "public/svg/courses.svg";
import CollectionsLogo from "public/svg/collections.svg";
import { deleteCourseFromBackend } from '@services/courses/courses';
import Link from 'next/link';
import React from 'react'
import Image from 'next/image';
import { AuthContext } from '@components/Security/AuthProvider';
import { revalidateTags } from '@services/utils/ts/requests';

interface CourseProps {
    orgslug: string;
    courses: any;
}

// function to remove "course_" from the course_id
function removeCoursePrefix(course_id: string) {
    return course_id.replace("course_", "");
}

function Courses(props: CourseProps) {
    const orgslug = props.orgslug;
    const courses = props.courses;
    const [newCourseModal, setNewCourseModal] = React.useState(false);

    async function deleteCourses(course_id: any) {
        await deleteCourseFromBackend(course_id);
        revalidateTags(['courses']);
    }

    async function closeNewCourseModal() {
        setNewCourseModal(false);
    }




    return (
        <div>
            <div className='max-w-7xl mx-auto px-4'>
                <div className='flex flex-wrap justify-between'>
                    <Title title="Courses" type="cou" />
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
                </div>



                <div className="flex space-x-5">
                    {courses.map((course: any) => (
                        <div key={course.course_id}>
                            <AdminEditsArea course={course} orgslug={orgslug} course_id={course.course_id} deleteCourses={deleteCourses} />
                            <Link href={getUriWithOrg(orgslug, "/course/" + removeCoursePrefix(course.course_id))}>
                                <div className="inset-0 ring-1 ring-inset ring-black/10 rounded-lg shadow-xl relative w-[249px] h-[131px] bg-cover" style={{ backgroundImage: `url(${getBackendUrl()}content/uploads/img/${course.thumbnail})` }}>

                                </div>
                            </Link>
                            <h2 className="font-bold text-lg w-[250px] py-2">{course.name}</h2>
                        </div>
                    ))}
                </div>

            </div>


        </div>
    )
}

export const Title = (props: any) => {
    return (
        <div className="home_category_title flex my-5">
            <div className="rounded-full ring-1 ring-slate-900/5 shadow-sm p-2 my-auto mr-4">
                <Image className="" src={props.type == "col" ? CollectionsLogo : CoursesLogo} alt="Courses logo" />
            </div>
            <h1 className="font-bold text-lg">{props.title}</h1>
        </div>
    )
}

const AdminEditsArea = (props: any) => {
    const org_roles_values = ["admin", "owner"];
    const user_roles_values = ["role_admin"];

    const auth: any = React.useContext(AuthContext);
    console.log("auth: ", auth);


    // this is amazingly terrible code, but gotta release that MVP
    // TODO: fix this

    function isAuthorized() {
        const org_id = props.course.org_id;
        const org_roles = auth.userInfo.user_object.orgs;
        const user_roles = auth.userInfo.user_object.roles;
        const org_role = org_roles.find((org: any) => org.org_id == org_id);
        const user_role = user_roles.find((role: any) => role.org_id == org_id);

        if (org_role && user_role) {
            if (org_roles_values.includes(org_role.org_role) && user_roles_values.includes(user_role.role_id)) {
                return true;
            }
            else {
                return false;
            }
        } else {
            return false;
        }
    }

    // this is amazingly terrible code, but gotta release that MVP
    // TODO: fix this

    if (auth.isAuthenticated) {
        if (isAuthorized()) {
            return (
                <div className="flex space-x-2 py-2">
                    <button className="rounded-md text-sm px-3 font-bold text-red-800 bg-red-200 w-16 flex justify-center items-center" onClick={() => props.deleteCourses(props.course_id)}>
                        Delete <Trash size={10}></Trash>
                    </button>
                    <Link href={getUriWithOrg(props.orgslug, "/course/" + removeCoursePrefix(props.course_id) + "/edit")}>
                        <button className="rounded-md text-sm px-3 font-bold text-orange-800 bg-orange-200 w-16 flex justify-center items-center">
                            Edit <Edit2 size={10}></Edit2>
                        </button>
                    </Link>
                </div>
            )
        } else {
            return (
                <div></div>
            )
        }
    }
    else {
        return (
            <div></div>
        )
    }
}


export default Courses