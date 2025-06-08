import { useCourse, useCourseDispatch } from '@components/Contexts/CourseContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrg } from '@components/Contexts/OrgContext'
import ConfirmationModal from '@components/Objects/StyledElements/ConfirmationModal/ConfirmationModal'
import { getAPIUrl } from '@services/config/config'
import { bulkAddContributors, bulkRemoveContributors, editContributor, getCourseContributors } from '@services/courses/courses'
import { searchOrgContent } from '@services/search/search'
import { swrFetcher } from '@services/utils/ts/requests'
import { Check, ChevronDown, Search, UserPen, Users } from 'lucide-react'
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
import { Input } from '@/components/ui/input'
import { useDebounce } from '@/hooks/useDebounce'
import { getUserAvatarMediaDirectory } from '@services/media/media'

type EditCourseContributorsProps = {
    orgslug: string
    course_uuid?: string
}

type ContributorRole = 'CREATOR' | 'CONTRIBUTOR' | 'MAINTAINER' | 'REPORTER'
type ContributorStatus = 'ACTIVE' | 'INACTIVE' | 'PENDING'

interface SearchUser {
    username: string;
    first_name: string;
    last_name: string;
    email: string;
    avatar_image: string;
    avatar_url?: string;
    id: number;
    user_uuid: string;
}

interface Contributor {
    id: string;
    user_id: string;
    authorship: ContributorRole;
    authorship_status: ContributorStatus;
    creation_date: string;
    user: {
        username: string;
        first_name: string;
        last_name: string;
        email: string;
        avatar_image: string;
        user_uuid: string;
    }
}

interface BulkAddResponse {
    successful: string[];
    failed: {
        username: string;
        reason: string;
    }[];
}

// Helper function for date formatting
const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { 
        year: 'numeric',
        month: 'short',
        day: 'numeric'
    });
};

function EditCourseContributors(props: EditCourseContributorsProps) {
    const session = useLHSession() as any;
    const access_token = session?.data?.tokens?.access_token;
    const course = useCourse() as any;
    const { isLoading, courseStructure } = course as any;
    const dispatchCourse = useCourseDispatch() as any;
    const org = useOrg() as any;

    const { data: contributors } = useSWR<Contributor[]>(
        courseStructure ? `${getAPIUrl()}courses/${courseStructure.course_uuid}/contributors` : null,
        (url: string) => swrFetcher(url, access_token)
    );

    const [isOpenToContributors, setIsOpenToContributors] = useState<boolean | undefined>(undefined);
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState<SearchUser[]>([]);
    const [selectedUsers, setSelectedUsers] = useState<string[]>([]);
    const [isSearching, setIsSearching] = useState(false);
    const debouncedSearch = useDebounce(searchQuery, 300);
    const [selectedContributors, setSelectedContributors] = useState<string[]>([]);
    const [masterCheckboxChecked, setMasterCheckboxChecked] = useState(false);

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

    useEffect(() => {
        const searchUsers = async () => {
            if (debouncedSearch.trim().length === 0) {
                setSearchResults([]);
                setIsSearching(false);
                return;
            }

            setIsSearching(true);
            try {
                const response = await searchOrgContent(
                    org?.slug,
                    debouncedSearch,
                    1,
                    5,
                    null,
                    access_token
                );

                if (response.success && response.data?.users) {
                    const users = response.data.users.map((user: SearchUser) => ({
                        ...user,
                        avatar_url: user.avatar_image ? getUserAvatarMediaDirectory(user.user_uuid, user.avatar_image) : ''
                    }));
                    setSearchResults(users);
                } else {
                    setSearchResults([]);
                }
            } catch (error) {
                console.error('Error searching users:', error);
                setSearchResults([]);
            }
            setIsSearching(false);
        };

        if (org?.slug && access_token) {
            searchUsers();
        }
    }, [debouncedSearch, org?.slug, access_token]);

    useEffect(() => {
        if (contributors) {
            const nonCreatorContributors = contributors.filter(c => c.authorship !== 'CREATOR');
            setMasterCheckboxChecked(
                nonCreatorContributors.length > 0 && 
                selectedContributors.length === nonCreatorContributors.length
            );
        }
    }, [contributors, selectedContributors]);

    const handleUserSelect = (username: string) => {
        setSelectedUsers(prev => {
            if (prev.includes(username)) {
                return prev.filter(u => u !== username);
            }
            return [...prev, username];
        });
    };

    const handleAddContributors = async () => {
        if (selectedUsers.length === 0) return;

        try {
            const response = await bulkAddContributors(courseStructure.course_uuid, selectedUsers, access_token);
            if (response.status === 200) {
                const result = response.data as BulkAddResponse;
                
                // Show success message for successful adds
                if (result.successful.length > 0) {
                    toast.success(`Successfully added ${result.successful.length} contributor(s)`);
                }
                
                // Show error messages for failed adds
                result.failed.forEach(failure => {
                    toast.error(`Failed to add ${failure.username}: ${failure.reason}`);
                });

                // Refresh contributors list
                mutate(`${getAPIUrl()}courses/${courseStructure.course_uuid}/contributors`);
                // Clear selection and search
                setSelectedUsers([]);
                setSearchQuery('');
            }
        } catch (error) {
            console.error('Error adding contributors:', error);
            toast.error('Failed to add contributors');
        }
    };

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
                {['CONTRIBUTOR', 'MAINTAINER', 'REPORTER'].map((role) => (
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
        
        // Find the creator and other contributors
        const creator = contributors.find(c => c.authorship === 'CREATOR');
        const otherContributors = contributors.filter(c => c.authorship !== 'CREATOR');
        
        // Return array with creator at the top, followed by other contributors in their original order
        return creator ? [creator, ...otherContributors] : otherContributors;
    };

    const handleContributorSelect = (userId: string) => {
        setSelectedContributors(prev => {
            if (prev.includes(userId)) {
                return prev.filter(id => id !== userId);
            }
            return [...prev, userId];
        });
    };

    const handleBulkRemove = async () => {
        if (selectedContributors.length === 0) return;

        try {
            // Get the usernames from the selected contributors
            const selectedUsernames = contributors
                ?.filter(c => selectedContributors.includes(c.user_id))
                .map(c => c.user.username) || [];

            console.log('Sending usernames:', selectedUsernames); // Debug log

            const response = await bulkRemoveContributors(
                courseStructure.course_uuid, 
                selectedUsernames, // Send as raw array, not stringified
                access_token
            );
            
            if (response.status === 200) {
                toast.success(`Successfully removed ${selectedContributors.length} contributor(s)`);
                // Refresh contributors list
                mutate(`${getAPIUrl()}courses/${courseStructure.course_uuid}/contributors`);
                // Clear selection
                setSelectedContributors([]);
            }
        } catch (error) {
            console.error('Error removing contributors:', error);
            toast.error('Failed to remove contributors');
        }
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
                                Manage contributors and add new ones to your course
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
                        <div className="space-y-4">
                            <div className="relative">
                                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                                <Input
                                    placeholder="Search users by name or username to add as contributors..."
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    className="pl-8"
                                />
                            </div>
                            {searchQuery && (
                                <div className="bg-white rounded-xl nice-shadow divide-y">
                                    {isSearching ? (
                                        <div className="p-4 text-center text-sm text-gray-500">
                                            Searching...
                                        </div>
                                    ) : searchResults && searchResults.length > 0 ? (
                                        <>
                                            {selectedUsers.length > 0 && (
                                                <div className="p-3 bg-gray-100">
                                                    <div className="flex items-center justify-between">
                                                        <span className="text-sm text-gray-700">
                                                            {selectedUsers.length} user{selectedUsers.length > 1 ? 's' : ''} selected
                                                        </span>
                                                        <div className="flex gap-2">
                                                            <Button
                                                                onClick={() => setSelectedUsers([])}
                                                                variant="outline"
                                                                className="text-sm"
                                                            >
                                                                Clear
                                                            </Button>
                                                            <Button
                                                                onClick={handleAddContributors}
                                                                className="bg-gray-900 text-white hover:bg-gray-800 text-sm"
                                                            >
                                                                Add Selected
                                                            </Button>
                                                        </div>
                                                    </div>
                                                </div>
                                            )}
                                            {searchResults.map((user) => {
                                                const isSelected = selectedUsers.includes(user.username);
                                                const isExistingContributor = contributors?.some(
                                                    c => c.user.username === user.username
                                                );

                                                return (
                                                    <div
                                                        key={user.username}
                                                        className={`flex items-center justify-between p-4 ${
                                                            isSelected ? 'bg-gray-100' : ''
                                                        } ${!isExistingContributor ? 'cursor-pointer hover:bg-gray-50' : ''} transition-colors`}
                                                        onClick={(e) => {
                                                            // Don't handle click if it's on a checkbox
                                                            if (e.target instanceof HTMLElement && e.target.closest('input[type="checkbox"]')) {
                                                                return;
                                                            }
                                                            if (!isExistingContributor) {
                                                                handleUserSelect(user.username);
                                                            }
                                                        }}
                                                    >
                                                        <div className="flex items-center space-x-3">
                                                            <div onClick={(e) => e.stopPropagation()}>
                                                                <input
                                                                    type="checkbox"
                                                                    checked={isSelected || false}
                                                                    onChange={() => !isExistingContributor && handleUserSelect(user.username)}
                                                                    disabled={isExistingContributor}
                                                                    className="h-4 w-4 rounded border-gray-300 text-gray-600 focus:ring-gray-500 disabled:opacity-50"
                                                                />
                                                            </div>
                                                            <UserAvatar
                                                                width={40}
                                                                avatar_url={user.avatar_url}
                                                                predefined_avatar={user.avatar_image ? undefined : 'empty'}
                                                                userId={user.id.toString()}
                                                                showProfilePopup
                                                                rounded="rounded-full"
                                                                backgroundColor="bg-gray-100"
                                                            />
                                                            <div>
                                                                <div className="font-medium text-gray-900">
                                                                    {user.first_name} {user.last_name}
                                                                </div>
                                                                <div className="text-sm text-gray-500">
                                                                    @{user.username}
                                                                </div>
                                                            </div>
                                                        </div>
                                                        {isExistingContributor && (
                                                            <span className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded">
                                                                Already a contributor
                                                            </span>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                        </>
                                    ) : (
                                        <div className="p-4 text-center text-sm text-gray-500">
                                            No users found
                                        </div>
                                    )}
                                </div>
                            )}
                            <div className="bg-white rounded-xl nice-shadow">
                                {selectedContributors.length > 0 && (
                                    <div className="p-3 bg-gray-100 rounded-t-xl border-b">
                                        <div className="flex items-center justify-between">
                                            <span className="text-sm text-gray-700">
                                                {selectedContributors.length} contributor{selectedContributors.length > 1 ? 's' : ''} selected
                                            </span>
                                            <div className="flex gap-2">
                                                <Button
                                                    onClick={() => setSelectedContributors([])}
                                                    variant="outline"
                                                    className="text-sm"
                                                >
                                                    Clear
                                                </Button>
                                                <Button
                                                    onClick={handleBulkRemove}
                                                    className="bg-red-600 text-white hover:bg-red-700 text-sm"
                                                >
                                                    Remove Selected
                                                </Button>
                                            </div>
                                        </div>
                                    </div>
                                )}
                                <div className="max-h-[600px] overflow-y-auto">
                                    <Table>
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead className="w-[30px]">
                                                    <input
                                                        type="checkbox"
                                                        checked={masterCheckboxChecked}
                                                        onChange={(e) => {
                                                            setMasterCheckboxChecked(e.target.checked);
                                                            if (contributors) {
                                                                if (e.target.checked) {
                                                                    // Select all non-creator contributors
                                                                    const nonCreatorContributors = contributors
                                                                        .filter(c => c.authorship !== 'CREATOR')
                                                                        .map(c => c.user_id);
                                                                    setSelectedContributors(nonCreatorContributors);
                                                                } else {
                                                                    setSelectedContributors([]);
                                                                }
                                                            }
                                                        }}
                                                        className="h-4 w-4 rounded border-gray-300 text-gray-600 focus:ring-gray-500"
                                                    />
                                                </TableHead>
                                                <TableHead className="w-[50px]"></TableHead>
                                                <TableHead>Name</TableHead>
                                                <TableHead>Username</TableHead>
                                                <TableHead>Email</TableHead>
                                                <TableHead>Role</TableHead>
                                                <TableHead>Status</TableHead>
                                                <TableHead>Added On</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {sortContributors(contributors)?.map((contributor) => (
                                                <TableRow 
                                                    key={`${contributor.user_id}-${contributor.id}`}
                                                    className={`${selectedContributors.includes(contributor.user_id) ? 'bg-gray-50' : ''} ${contributor.authorship !== 'CREATOR' ? 'cursor-pointer hover:bg-gray-50' : ''}`}
                                                    onClick={(e) => {
                                                        // Don't handle click if it's on a dropdown or checkbox
                                                        if (
                                                            e.target instanceof HTMLElement && 
                                                            (e.target.closest('button') || 
                                                             e.target.closest('input[type="checkbox"]'))
                                                        ) {
                                                            return;
                                                        }
                                                        if (contributor.authorship !== 'CREATOR') {
                                                            handleContributorSelect(contributor.user_id);
                                                        }
                                                    }}
                                                >
                                                    <TableCell onClick={(e) => e.stopPropagation()}>
                                                        <input
                                                            type="checkbox"
                                                            checked={selectedContributors.includes(contributor.user_id)}
                                                            onChange={() => handleContributorSelect(contributor.user_id)}
                                                            disabled={contributor.authorship === 'CREATOR'}
                                                            className="h-4 w-4 rounded border-gray-300 text-gray-600 focus:ring-gray-500 disabled:opacity-50"
                                                        />
                                                    </TableCell>
                                                    <TableCell>
                                                        <UserAvatar
                                                            width={30}
                                                            border='border-2'
                                                            avatar_url={contributor.user.avatar_image ? getUserAvatarMediaDirectory(contributor.user.user_uuid, contributor.user.avatar_image) : ''}
                                                            rounded="rounded"
                                                            predefined_avatar={contributor.user.avatar_image === '' ? 'empty' : undefined}
                                                        />
                                                    </TableCell>
                                                    <TableCell className="font-medium">
                                                        {contributor.user.first_name} {contributor.user.last_name}
                                                    </TableCell>
                                                    <TableCell className="text-gray-500">
                                                        @{contributor.user.username}
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
                                                    <TableCell className="text-gray-500 text-sm">
                                                        {formatDate(contributor.creation_date)}
                                                    </TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

export default EditCourseContributors;