import { useCourse, useCourseDispatch } from '@components/Contexts/CourseContext'
import LinkToUserGroup from '@components/Objects/Modals/Dash/EditCourseAccess/LinkToUserGroup'
import ConfirmationModal from '@components/StyledElements/ConfirmationModal/ConfirmationModal'
import Modal from '@components/StyledElements/Modal/Modal'
import { getAPIUrl } from '@services/config/config'
import { unLinkResourcesToUserGroup } from '@services/usergroups/usergroups'
import { swrFetcher } from '@services/utils/ts/requests'
import { Globe, SquareUserRound, Users, UsersRound, X } from 'lucide-react'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import React from 'react'
import toast from 'react-hot-toast'
import useSWR, { mutate } from 'swr'

type EditCourseAccessProps = {
    orgslug: string
    course_uuid?: string
}

function EditCourseAccess(props: EditCourseAccessProps) {
    const [error, setError] = React.useState('')
    const session = useLHSession() as any;
    const access_token = session?.data?.tokens?.access_token;

    const course = useCourse() as any
    const dispatchCourse = useCourseDispatch() as any
    const courseStructure = course.courseStructure
    const { data: usergroups } = useSWR(
        courseStructure ? `${getAPIUrl()}usergroups/resource/${courseStructure.course_uuid}` : null,
        (url) => swrFetcher(url, access_token)
    )
    const [isPublic, setIsPublic] = React.useState(courseStructure.public)


    React.useEffect(() => {
        // This code will run whenever form values are updated
        if (isPublic !== courseStructure.public) {
            dispatchCourse({ type: 'setIsNotSaved' })
            const updatedCourse = {
                ...courseStructure,
                public: isPublic,
            }
            dispatchCourse({ type: 'setCourseStructure', payload: updatedCourse })
        }
    }, [course, isPublic])
    return (
        <div>
            {' '}
            <div className="h-6"></div>
            <div className="ml-10 mr-10 mx-auto bg-white rounded-xl shadow-sm px-4 py-4">
                <div className="flex flex-col bg-gray-50 -space-y-1  px-5 py-3 rounded-md mb-3 ">
                    <h1 className="font-bold text-xl text-gray-800">Access to the course</h1>
                    <h2 className="text-gray-500 text-sm">
                        {' '}
                        Choose if want your course to be publicly available on the internet or only accessible to signed in users{' '}
                    </h2>
                </div>
                <div className="flex space-x-2 mx-auto mb-3">
                    <ConfirmationModal
                        confirmationButtonText="Change to Public"
                        confirmationMessage="Are you sure you want this course to be publicly available on the internet ?"
                        dialogTitle={'Change to Public ?'}
                        dialogTrigger={
                            <div className="w-full h-[200px] bg-slate-100 rounded-lg cursor-pointer hover:bg-slate-200 ease-linear transition-all">
                                {isPublic ? (
                                    <div className="bg-green-200 text-green-600 font-bold w-fit my-3 mx-3 absolute text-sm px-3 py-1 rounded-lg">
                                        Active
                                    </div>
                                ) : null}
                                <div className="flex flex-col space-y-1 justify-center items-center h-full">
                                    <Globe className="text-slate-400" size={40}></Globe>
                                    <div className="text-2xl text-slate-700 font-bold">
                                        Public
                                    </div>
                                    <div className="text-gray-400 text-md tracking-tight w-[500px] leading-5 text-center">
                                        The Course is publicly available on the internet, it is indexed by search engines and can be accessed by anyone
                                    </div>
                                </div>

                            </div>
                        }
                        functionToExecute={() => {
                            setIsPublic(true)
                        }}
                        status="info"
                    ></ConfirmationModal>
                    <ConfirmationModal
                        confirmationButtonText="Change to Users Only"
                        confirmationMessage="Are you sure you want this course to be only accessible to signed in users ?"
                        dialogTitle={'Change to Users Only ?'}
                        dialogTrigger={
                            <div className="w-full h-[200px] bg-slate-100 rounded-lg cursor-pointer hover:bg-slate-200 ease-linear transition-all">
                                {!isPublic ? (
                                    <div className="bg-green-200 text-green-600 font-bold w-fit my-3 mx-3 absolute text-sm px-3 py-1 rounded-lg">
                                        Active
                                    </div>
                                ) : null}
                                <div className="flex flex-col space-y-1 justify-center items-center h-full">
                                    <Users className="text-slate-400" size={40}></Users>
                                    <div className="text-2xl text-slate-700 font-bold">
                                        Users Only
                                    </div>
                                    <div className="text-gray-400 text-md tracking-tight w-[500px] leading-5 text-center">
                                        The Course is only accessible to signed in users, additionaly you can choose which UserGroups can access this course
                                    </div>
                                </div>

                            </div>
                        }
                        functionToExecute={() => {
                            setIsPublic(false)
                        }}
                        status="info"
                    ></ConfirmationModal>
                </div>
                {!isPublic ? (<UserGroupsSection usergroups={usergroups} />) : null}
            </div>
        </div>
    )
}


function UserGroupsSection({ usergroups }: { usergroups: any[] }) {
    const course = useCourse() as any
    const [userGroupModal, setUserGroupModal] = React.useState(false)

    const removeUserGroupLink = async (usergroup_id: number) => {
        const res = await unLinkResourcesToUserGroup(usergroup_id, course.courseStructure.course_uuid)
        if (res.status === 200) {
            toast.success('Successfully unliked from usergroup')
            mutate(`${getAPIUrl()}usergroups/resource/${course.courseStructure.course_uuid}`)
        }
        else {
            toast.error('Error ' + res.status + ': ' + res.data.detail)
        }
    }

    return (
        <>
            <div className="flex flex-col bg-gray-50 -space-y-1  px-5 py-3 rounded-md mb-3 ">
                <h1 className="font-bold text-xl text-gray-800">UserGroups</h1>
                <h2 className="text-gray-500 text-sm">
                    {' '}
                    You can choose to give access to this course to specific groups of users only by linking it to a UserGroup{' '}
                </h2>
            </div>
            <table className="table-auto w-full text-left whitespace-nowrap rounded-md overflow-hidden">
                <thead className="bg-gray-100 text-gray-500 rounded-xl uppercase">
                    <tr className="font-bolder text-sm">
                        <th className="py-3 px-4">Name</th>
                        <th className="py-3 px-4">Actions</th>
                    </tr>
                </thead>
                <>
                    <tbody className="mt-5 bg-white rounded-md">
                        {usergroups?.map((usergroup: any) => (
                            <tr
                                key={usergroup.invite_code_uuid}
                                className="border-b border-gray-100 text-sm"
                            >
                                <td className="py-3 px-4">{usergroup.name}</td>
                                <td className="py-3 px-4">
                                    <ConfirmationModal
                                        confirmationButtonText="Delete Link"
                                        confirmationMessage="Users from this UserGroup will no longer have access to this course"
                                        dialogTitle={'Unlink UserGroup ?'}
                                        dialogTrigger={
                                            <button className="mr-2 flex space-x-2 hover:cursor-pointer p-1 px-3 bg-rose-700 rounded-md font-bold items-center text-sm text-rose-100">
                                                <X className="w-4 h-4" />
                                                <span> Delete link</span>
                                            </button>
                                        }
                                        functionToExecute={() => {
                                            removeUserGroupLink(usergroup.id)
                                        }}
                                        status="warning"
                                    ></ConfirmationModal>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </>
            </table>
            <div className='flex flex-row-reverse mt-3 mr-2'>
                <Modal
                    isDialogOpen={
                        userGroupModal
                    }
                    onOpenChange={() =>
                        setUserGroupModal(!userGroupModal)
                    }
                    minHeight="no-min"
                    minWidth='md'
                    dialogContent={
                        <LinkToUserGroup setUserGroupModal={setUserGroupModal} />

                    }
                    dialogTitle="Link Course to a UserGroup"
                    dialogDescription={
                        'Choose a UserGroup to link this course to, Users from this UserGroup will have access to this course.'
                    }
                    dialogTrigger={
                        <button
                            className=" flex space-x-2 hover:cursor-pointer p-1 px-3 bg-green-700 rounded-md font-bold items-center text-sm text-green-100"
                        >
                            <SquareUserRound className="w-4 h-4" />
                            <span>Link to a UserGroup</span>
                        </button>
                    }
                />

            </div>
        </>
    )
}

export default EditCourseAccess