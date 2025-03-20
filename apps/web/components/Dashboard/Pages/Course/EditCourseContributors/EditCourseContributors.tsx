import { useCourse, useCourseDispatch } from '@components/Contexts/CourseContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import ConfirmationModal from '@components/Objects/StyledElements/ConfirmationModal/ConfirmationModal'
import { getAPIUrl } from '@services/config/config'
import { editContributor, getCourseContributors } from '@services/courses/courses'
import { swrFetcher } from '@services/utils/ts/requests'
import { Check, ChevronDown, UserPen, Users } from 'lucide-react'
import React, { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import useSWR, { mutate } from 'swr'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import UserAvatar from '@components/Objects/UserAvatar'

type EditCourseContributorsProps = {
    orgslug: string
    course_uuid?: string
}

type ContributorRole = 'CREATOR' | 'CONTRIBUTOR' | 'MAINTAINER' | 'REPORTER'
type ContributorStatus = 'ACTIVE' | 'INACTIVE' | 'PENDING'

interface Contributor {
    id: string;
    user_id: string;
    authorship: ContributorRole;
    authorship_status: ContributorStatus;
    user: {
        username: string;
        first_name: string;
        last_name: string;
        email: string;
        avatar_image: string;
    }
}

function EditCourseContributors(props: EditCourseContributorsProps) {
    const session = useLHSession() as any;
    const access_token = session?.data?.tokens?.access_token;
    const course = useCourse() as any;
    const { isLoading, courseStructure } = course as any;
    const dispatchCourse = useCourseDispatch() as any;

    const { data: contributors } = useSWR<Contributor[]>(
        courseStructure ? `${getAPIUrl()}courses/${courseStructure.course_uuid}/contributors` : null,
        (url: string) => swrFetcher(url, access_token)
    );

    const [isOpenToContributors, setIsOpenToContributors] = useState<boolean | undefined>(undefined);

    useEffect(() => {
        if (!isLoading && courseStructure?.open_to_contributors !== undefined) {
            setIsOpenToContributors(courseStructure.open_to_contributors);
        }
    }, [isLoading, courseStructure]);

    useEffect(() => {
        if (!isLoading && courseStructure?.open_to_contributors !== undefined && isOpenToContributors !== undefined) {
            if (isOpenToContributors !== courseStructure.open_to_contributors) {
                dispatchCourse({ type: 'setIsNotSaved' });
                const updatedCourse = {
                    ...courseStructure,
                    open_to_contributors: isOpenToContributors,
                };
                dispatchCourse({ type: 'setCourseStructure', payload: updatedCourse });
            }
        }
    }, [isLoading, isOpenToContributors, courseStructure, dispatchCourse]);

    const updateContributor = async (contributorId: string, data: { authorship?: ContributorRole; authorship_status?: ContributorStatus }) => {
        try {
            // Find the current contributor to get their current values
            const currentContributor = contributors?.find(c => c.user_id === contributorId);
            if (!currentContributor) return;

            // Don't allow editing if the user is a CREATOR
            if (currentContributor.authorship === 'CREATOR') {
                toast.error('Cannot modify a creator\'s role or status');
                return;
            }

            // Always send both values in the request
            const updatedData = {
                authorship: data.authorship || currentContributor.authorship,
                authorship_status: data.authorship_status || currentContributor.authorship_status
            };

            const res = await editContributor(courseStructure.course_uuid, contributorId, updatedData.authorship, updatedData.authorship_status, access_token);
            if (res.status === 200 && res.data?.status === 'success') {
                toast.success(res.data.detail || 'Successfully updated contributor');
                mutate(`${getAPIUrl()}courses/${courseStructure.course_uuid}/contributors`);
            } else {
                toast.error(`Error: ${res.data?.detail || 'Failed to update contributor'}`);
            }
        } catch (error) {
            toast.error('An error occurred while updating the contributor.');
        }
    };

    const RoleDropdown = ({ contributor }: { contributor: Contributor }) => (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    variant="outline"
                    className="w-[200px] justify-between"
                    disabled={contributor.authorship === 'CREATOR'}
                >
                    {contributor.authorship}
                    <ChevronDown className="ml-2 h-4 w-4 text-muted-foreground" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-[200px]">
                {['CREATOR', 'CONTRIBUTOR', 'MAINTAINER', 'REPORTER'].map((role) => (
                    <DropdownMenuItem
                        key={role}
                        onClick={() => updateContributor(contributor.user_id, { authorship: role as ContributorRole })}
                        className="justify-between"
                    >
                        {role}
                        {contributor.authorship === role && <Check className="ml-2 h-4 w-4" />}
                    </DropdownMenuItem>
                ))}
            </DropdownMenuContent>
        </DropdownMenu>
    );

    const StatusDropdown = ({ contributor }: { contributor: Contributor }) => (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    variant="outline"
                    className={`w-[200px] justify-between ${getStatusStyle(contributor.authorship_status)}`}
                    disabled={contributor.authorship === 'CREATOR'}
                >
                    {contributor.authorship_status}
                    <ChevronDown className="ml-2 h-4 w-4" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-[200px]">
                {['ACTIVE', 'INACTIVE', 'PENDING'].map((status) => (
                    <DropdownMenuItem
                        key={status}
                        onClick={() => updateContributor(contributor.user_id, { authorship_status: status as ContributorStatus })}
                        className="justify-between"
                    >
                        {status}
                        {contributor.authorship_status === status && <Check className="ml-2 h-4 w-4" />}
                    </DropdownMenuItem>
                ))}
            </DropdownMenuContent>
        </DropdownMenu>
    );

    const getStatusStyle = (status: ContributorStatus) => {
        switch (status) {
            case 'ACTIVE':
                return 'bg-green-50 text-green-700 hover:bg-green-100 hover:text-green-800';
            case 'INACTIVE':
                return 'bg-gray-50 text-gray-700 hover:bg-gray-100 hover:text-gray-800';
            case 'PENDING':
                return 'bg-yellow-50 text-yellow-700 hover:bg-yellow-100 hover:text-yellow-800';
            default:
                return 'bg-gray-50 text-gray-700 hover:bg-gray-100 hover:text-gray-800';
        }
    };

    const sortContributors = (contributors: Contributor[] | undefined) => {
        if (!contributors) return [];
        
        return [...contributors].sort((a, b) => {
            // First sort by role priority
            const rolePriority: Record<ContributorRole, number> = {
                'CREATOR': 0,
                'MAINTAINER': 1,
                'CONTRIBUTOR': 2,
                'REPORTER': 3
            };
            
            const roleDiff = rolePriority[a.authorship] - rolePriority[b.authorship];
            if (roleDiff !== 0) return roleDiff;
            
            // Then sort by name
            const nameA = `${a.user.first_name} ${a.user.last_name}`.toLowerCase();
            const nameB = `${b.user.first_name} ${b.user.last_name}`.toLowerCase();
            return nameA.localeCompare(nameB);
        });
    };

    return (
        <div>
            {courseStructure && (
                <div>
                    <div className="h-6"></div>
                    <div className="mx-4 sm:mx-10 bg-white rounded-xl shadow-xs px-4 py-4">
                        <div className="flex flex-col bg-gray-50 -space-y-1 px-3 sm:px-5 py-3 rounded-md mb-3">
                            <h1 className="font-bold text-lg sm:text-xl text-gray-800">Course Contributors</h1>
                            <h2 className="text-gray-500 text-xs sm:text-sm">
                                Choose if you want your course to be open for contributors and manage existing contributors
                            </h2>
                        </div>
                        <div className="flex flex-col sm:flex-row sm:space-x-2 space-y-2 sm:space-y-0 mx-auto mb-3">
                            <ConfirmationModal
                                confirmationButtonText="Open to Contributors"
                                confirmationMessage="Are you sure you want to open this course to contributors?"
                                dialogTitle="Open to Contributors?"
                                dialogTrigger={
                                    <div className="w-full h-[200px] bg-slate-100 rounded-lg cursor-pointer hover:bg-slate-200 transition-all">
                                        {isOpenToContributors && (
                                            <div className="bg-green-200 text-green-600 font-bold w-fit my-3 mx-3 absolute text-sm px-3 py-1 rounded-lg">
                                                Active
                                            </div>
                                        )}
                                        <div className="flex flex-col space-y-1 justify-center items-center h-full p-2 sm:p-4">
                                            <UserPen className="text-slate-400" size={32} />
                                            <div className="text-xl sm:text-2xl text-slate-700 font-bold">
                                                Open to Contributors
                                            </div>
                                            <div className="text-gray-400 text-sm sm:text-md tracking-tight w-full sm:w-[500px] leading-5 text-center">
                                                The course is open for contributors. Users can apply to become contributors and help improve the course content.
                                            </div>
                                        </div>
                                    </div>
                                }
                                functionToExecute={() => setIsOpenToContributors(true)}
                                status="info"
                            />
                            <ConfirmationModal
                                confirmationButtonText="Close to Contributors"
                                confirmationMessage="Are you sure you want to close this course to contributors?"
                                dialogTitle="Close to Contributors?"
                                dialogTrigger={
                                    <div className="w-full h-[200px] bg-slate-100 rounded-lg cursor-pointer hover:bg-slate-200 transition-all">
                                        {!isOpenToContributors && (
                                            <div className="bg-green-200 text-green-600 font-bold w-fit my-3 mx-3 absolute text-sm px-3 py-1 rounded-lg">
                                                Active
                                            </div>
                                        )}
                                        <div className="flex flex-col space-y-1 justify-center items-center h-full p-2 sm:p-4">
                                            <Users className="text-slate-400" size={32} />
                                            <div className="text-xl sm:text-2xl text-slate-700 font-bold">
                                                Closed to Contributors
                                            </div>
                                            <div className="text-gray-400 text-sm sm:text-md tracking-tight w-full sm:w-[500px] leading-5 text-center">
                                                The course is closed for contributors. Only existing contributors can modify the course content.
                                            </div>
                                        </div>
                                    </div>
                                }
                                functionToExecute={() => setIsOpenToContributors(false)}
                                status="info"
                            />
                        </div>
                        <div className="flex flex-col bg-gray-50 -space-y-1 px-3 sm:px-5 py-3 rounded-md mb-3">
                            <h1 className="font-bold text-lg sm:text-xl text-gray-800">Current Contributors</h1>
                            <h2 className="text-gray-500 text-xs sm:text-sm">
                                Manage the current contributors of this course
                            </h2>
                        </div>
                        <div className="max-h-[600px] overflow-y-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead className="w-[50px]"></TableHead>
                                        <TableHead>Name</TableHead>
                                        <TableHead>Email</TableHead>
                                        <TableHead>Role</TableHead>
                                        <TableHead>Status</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {sortContributors(contributors)?.map((contributor) => (
                                        <TableRow key={contributor.id}>
                                            <TableCell>
                                                <UserAvatar
                                                    width={30}
                                                    border='border-2'
                                                    avatar_url={contributor.user.avatar_image}
                                                    rounded="rounded"
                                                    predefined_avatar={contributor.user.avatar_image === '' ? 'empty' : undefined}
                                                />
                                            </TableCell>
                                            <TableCell className="font-medium">
                                                {contributor.user.first_name} {contributor.user.last_name} 
                                            </TableCell>
                                            <TableCell className="text-gray-500">
                                                {contributor.user.email}
                                            </TableCell>
                                            <TableCell>
                                                <RoleDropdown contributor={contributor} />
                                            </TableCell>
                                            <TableCell>
                                                <StatusDropdown contributor={contributor} />
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

export default EditCourseContributors;