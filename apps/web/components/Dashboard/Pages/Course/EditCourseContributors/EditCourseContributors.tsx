import { useCourseFieldSync } from '@components/Contexts/CourseContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrg } from '@components/Contexts/OrgContext'
import { bulkAddContributors, bulkRemoveContributors, editContributor, getCourseContributors } from '@services/courses/courses'
import { searchOrgContent } from '@services/search/search'
import { Check, CaretDown, Trash, UserGear, UserPlus, Users, UsersThree, Handshake } from '@phosphor-icons/react'
import React, { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query/keys'
import { useTranslation } from 'react-i18next'
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
import UserAvatar from '@components/Objects/UserAvatar'
import { useDebounce } from '@/hooks/useDebounce'
import { getUserAvatarMediaDirectory } from '@services/media/media'
import { Button, Chip, ConfirmDialog, SearchInput, SectionCard } from '@components/Dashboard/Shared/DashKit/DashKit'
import { ChoiceTile, EditorPage, EditorSkeleton, ErrorNotice, SelectBox } from '../courseEditorUi'
import { useSectionDraft } from '../courseEditorSave'

const DROPDOWN_TRIGGER =
    'inline-flex h-8 w-[160px] items-center justify-between gap-2 rounded-lg px-3 text-xs font-semibold transition-colors disabled:opacity-60 disabled:cursor-not-allowed'
const TH = 'text-xs font-semibold text-neutral-500'

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

function EditCourseContributors(_props: EditCourseContributorsProps) {
    const { t } = useTranslation()
    const session = useLHSession() as any;
    const access_token = session?.data?.tokens?.access_token;
    const { syncChanges, isLoading, courseStructure } = useCourseFieldSync('editCourseContributors');
    const org = useOrg() as any;
    const [confirmOpen, setConfirmOpen] = useState<boolean | null>(null);
    const [confirmRemove, setConfirmRemove] = useState(false);

    const queryClient = useQueryClient()

    const { data: contributors } = useQuery({
        queryKey: queryKeys.courses.contributors(courseStructure?.course_uuid ?? ''),
        // getCourseContributors resolves (does not throw) on non-200s, returning the
        // error body as `data`. Reject on failure so React Query surfaces an error
        // state, and always resolve to an array so render never calls .filter/.find
        // on a `{ detail: ... }` object (was crashing the whole page on 401/403/404).
        queryFn: async () => {
            const res = await getCourseContributors(courseStructure!.course_uuid, access_token)
            if (!res.success) {
                const detail = typeof res.data?.detail === 'string' ? res.data.detail : undefined
                throw new Error(detail ?? 'Failed to load contributors')
            }
            return (Array.isArray(res.data) ? res.data : []) as Contributor[]
        },
        enabled: !!courseStructure?.course_uuid && !!access_token,
        staleTime: 60_000,
    });

    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState<SearchUser[]>([]);
    const [selectedUsers, setSelectedUsers] = useState<string[]>([]);
    const [isSearching, setIsSearching] = useState(false);
    const debouncedSearch = useDebounce(searchQuery, 300);
    const [selectedContributors, setSelectedContributors] = useState<string[]>([]);

    // Derived during render: the master checkbox is checked when every
    // non-creator contributor is currently selected (and there is at least one).
    const nonCreatorContributors = (Array.isArray(contributors) ? contributors : []).filter(c => c.authorship !== 'CREATOR');
    const masterCheckboxChecked =
        nonCreatorContributors.length > 0 &&
        selectedContributors.length === nonCreatorContributors.length;

    // The "open to contributors" flag is a course field: staged in the course
    // store and sent by the header Save.
    const isOpenToContributors: boolean | undefined = courseStructure?.open_to_contributors;

    const setIsOpenToContributors = (value: boolean) => {
        if (isLoading || !courseStructure) return;
        if (courseStructure.open_to_contributors === value) return;
        syncChanges({ open_to_contributors: value }, true);
    };

    // Role and status edits are staged per contributor (keyed by user_id) and
    // sent by the header Save. Adding and removing people are actions.
    type RoleEdit = { authorship: ContributorRole; authorship_status: ContributorStatus };
    const roleDraft = useSectionDraft<Record<string, RoleEdit>>('contributors', {
        label: t('dashboard.courses.editor.contributors.roles_section'),
        tab: 'contributors',
        save: async (edits: Record<string, RoleEdit>) => {
            const failed: string[] = [];
            for (const [userId, edit] of Object.entries(edits)) {
                const res = await editContributor(courseStructure.course_uuid, userId, edit.authorship, edit.authorship_status, access_token);
                if (!(res.status === 200 && res.data?.status === 'success')) {
                    failed.push(typeof res.data?.detail === 'string' ? res.data.detail : userId);
                }
            }
            await queryClient.invalidateQueries({ queryKey: queryKeys.courses.contributors(courseStructure.course_uuid) });
            if (failed.length > 0) throw new Error(failed.join(', '));
        },
    });
    const roleEdits = roleDraft.value ?? {};
    const withEdits = (c: Contributor): Contributor => (roleEdits[c.user_id] ? { ...c, ...roleEdits[c.user_id] } : c);

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
            } catch (_error) {
                setSearchResults([]);
            }
            setIsSearching(false);
        };

        if (org?.slug && access_token) {
            searchUsers();
        }
    }, [debouncedSearch, org?.slug, access_token]);

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
                    toast.success(t('dashboard.courses.contributors.toasts.add_success', { count: result.successful.length }));
                }
                
                // Show error messages for failed adds
                result.failed.forEach(failure => {
                    toast.error(t('dashboard.courses.contributors.toasts.add_error', { username: failure.username, reason: failure.reason }));
                });

                // Refresh contributors list
                queryClient.invalidateQueries({ queryKey: queryKeys.courses.contributors(courseStructure.course_uuid) });
                // Clear selection and search
                setSelectedUsers([]);
                setSearchQuery('');
            }
        } catch (_error) {
            toast.error(t('dashboard.courses.contributors.toasts.add_failed'));
        }
    };

    const updateContributor = (contributorId: string, data: { authorship?: ContributorRole; authorship_status?: ContributorStatus }) => {
        const original = contributors?.find(c => c.user_id === contributorId);
        if (!original) return;
        // Don't allow editing if the user is a CREATOR
        if (original.authorship === 'CREATOR') {
            toast.error(t('dashboard.courses.contributors.toasts.cannot_modify_creator'));
            return;
        }
        const current = withEdits(original);
        const next: RoleEdit = {
            authorship: data.authorship || current.authorship,
            authorship_status: data.authorship_status || current.authorship_status,
        };
        const edits = { ...roleEdits };
        if (next.authorship === original.authorship && next.authorship_status === original.authorship_status) {
            delete edits[contributorId];
        } else {
            edits[contributorId] = next;
        }
        if (Object.keys(edits).length === 0) roleDraft.clear();
        else roleDraft.set(edits);
    };

    const RoleDropdown = ({ contributor }: { contributor: Contributor }) => (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <button
                    type="button"
                    className={`${DROPDOWN_TRIGGER} bg-white text-neutral-700 ring-1 ring-inset ring-neutral-200 hover:ring-neutral-300`}
                    disabled={contributor.authorship === 'CREATOR'}
                >
                    {t(`dashboard.courses.contributors.roles.${contributor.authorship.toLowerCase()}`)}
                    <CaretDown className="h-3.5 w-3.5 opacity-60" />
                </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-[180px]">
                {['CONTRIBUTOR', 'MAINTAINER', 'REPORTER'].map((role) => (
                    <DropdownMenuItem
                        key={role}
                        onClick={() => updateContributor(contributor.user_id, { authorship: role as ContributorRole })}
                        className="justify-between"
                    >
                        {t(`dashboard.courses.contributors.roles.${role.toLowerCase()}`)}
                        {contributor.authorship === role && <Check className="ms-2 h-4 w-4" />}
                    </DropdownMenuItem>
                ))}
            </DropdownMenuContent>
        </DropdownMenu>
    );

    const StatusDropdown = ({ contributor }: { contributor: Contributor }) => (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <button
                    type="button"
                    className={`${DROPDOWN_TRIGGER} ${getStatusStyle(contributor.authorship_status)}`}
                    disabled={contributor.authorship === 'CREATOR'}
                >
                    {t(`dashboard.courses.contributors.statuses.${contributor.authorship_status.toLowerCase()}`)}
                    <CaretDown className="h-3.5 w-3.5 opacity-60" />
                </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-[180px]">
                {['ACTIVE', 'INACTIVE', 'PENDING'].map((status) => (
                    <DropdownMenuItem
                        key={status}
                        onClick={() => updateContributor(contributor.user_id, { authorship_status: status as ContributorStatus })}
                        className="justify-between"
                    >
                        {t(`dashboard.courses.contributors.statuses.${status.toLowerCase()}`)}
                        {contributor.authorship_status === status && <Check className="ms-2 h-4 w-4" />}
                    </DropdownMenuItem>
                ))}
            </DropdownMenuContent>
        </DropdownMenu>
    );

    const getStatusStyle = (status: ContributorStatus) => {
        switch (status) {
            case 'ACTIVE':
                return 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100';
            case 'INACTIVE':
                return 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200';
            case 'PENDING':
                return 'bg-amber-50 text-amber-700 hover:bg-amber-100';
            default:
                return 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200';
        }
    };

    const sortContributors = (contributors: Contributor[] | undefined) => {
        if (!Array.isArray(contributors)) return [];
        
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

            const response = await bulkRemoveContributors(
                courseStructure.course_uuid, 
                selectedUsernames, // Send as raw array, not stringified
                access_token
            );
            
            if (response.status === 200) {
                toast.success(t('dashboard.courses.contributors.toasts.remove_success', { count: selectedContributors.length }));
                // Drop staged role edits for people who are gone.
                const edits = { ...roleEdits };
                selectedContributors.forEach((id) => delete edits[id]);
                if (Object.keys(edits).length === 0) roleDraft.clear();
                else roleDraft.set(edits);
                // Refresh contributors list
                queryClient.invalidateQueries({ queryKey: queryKeys.courses.contributors(courseStructure.course_uuid) });
                // Clear selection
                setSelectedContributors([]);
            }
        } catch (_error) {
            toast.error(t('dashboard.courses.contributors.toasts.remove_failed'));
        }
    };

    if (isLoading || !courseStructure) {
        return (
            <EditorPage width="wide">
                <EditorSkeleton sections={2} rows={2} />
            </EditorPage>
        );
    }

    return (
        <EditorPage width="wide">
            {roleDraft.error && <ErrorNotice>{roleDraft.error}</ErrorNotice>}
            <SectionCard
                icon={<Handshake size={18} />}
                title={t('dashboard.courses.contributors.title')}
                description={t('dashboard.courses.contributors.subtitle')}
            >
                <div role="radiogroup" aria-label={t('dashboard.courses.contributors.title')} className="grid sm:grid-cols-2 gap-3">
                    <ChoiceTile
                        icon={UserGear}
                        title={t('dashboard.courses.contributors.open_to_contributors.title')}
                        description={t('dashboard.courses.contributors.open_to_contributors.description')}
                        selected={!!isOpenToContributors}
                        activeLabel={t('dashboard.courses.contributors.open_to_contributors.active')}
                        tabIndex={0}
                        onClick={() => !isOpenToContributors && setConfirmOpen(true)}
                        onKeyDown={(e) => {
                            if ((e.key === 'Enter' || e.key === ' ') && !isOpenToContributors) {
                                e.preventDefault()
                                setConfirmOpen(true)
                            }
                        }}
                    />
                    <ChoiceTile
                        icon={Users}
                        title={t('dashboard.courses.contributors.closed_to_contributors.title')}
                        description={t('dashboard.courses.contributors.closed_to_contributors.description')}
                        selected={!isOpenToContributors}
                        activeLabel={t('dashboard.courses.contributors.closed_to_contributors.active')}
                        tabIndex={0}
                        onClick={() => isOpenToContributors && setConfirmOpen(false)}
                        onKeyDown={(e) => {
                            if ((e.key === 'Enter' || e.key === ' ') && isOpenToContributors) {
                                e.preventDefault()
                                setConfirmOpen(false)
                            }
                        }}
                    />
                </div>
                <ConfirmDialog
                    open={confirmOpen !== null}
                    onOpenChange={(open) => !open && setConfirmOpen(null)}
                    tone="info"
                    title={
                        confirmOpen
                            ? t('dashboard.courses.contributors.open_to_contributors.confirmation_title')
                            : t('dashboard.courses.contributors.closed_to_contributors.confirmation_title')
                    }
                    message={
                        <>
                            {confirmOpen
                                ? t('dashboard.courses.contributors.open_to_contributors.confirmation_message')
                                : t('dashboard.courses.contributors.closed_to_contributors.confirmation_message')}{' '}
                            {t('dashboard.courses.editor.save.applies_on_save')}
                        </>
                    }
                    confirmLabel={
                        confirmOpen
                            ? t('dashboard.courses.contributors.open_to_contributors.confirmation_button')
                            : t('dashboard.courses.contributors.closed_to_contributors.confirmation_button')
                    }
                    onConfirm={() => {
                        if (confirmOpen !== null) setIsOpenToContributors(confirmOpen)
                    }}
                />
            </SectionCard>

            <SectionCard
                icon={<UsersThree size={18} />}
                title={t('dashboard.courses.editor.contributors.people_title')}
                description={t('dashboard.courses.editor.contributors.people_description')}
                bodyClassName="p-5 space-y-4"
                actions={
                    Array.isArray(contributors) && contributors.length > 0 ? (
                        <Chip tone="neutral">
                            {t('dashboard.courses.editor.contributors.count', { count: contributors.length })}
                        </Chip>
                    ) : undefined
                }
            >
                <div className="relative">
                    <SearchInput
                        value={searchQuery}
                        onChange={setSearchQuery}
                        placeholder={t('dashboard.courses.contributors.search.placeholder')}
                    />
                    {searchQuery && (
                        <div className="mt-2 bg-white rounded-xl ring-1 ring-inset ring-neutral-200 divide-y divide-neutral-100 overflow-hidden">
                            {isSearching ? (
                                <div className="p-4 text-center text-sm text-neutral-500">
                                    {t('dashboard.courses.contributors.search.searching')}
                                </div>
                            ) : searchResults && searchResults.length > 0 ? (
                                <>
                                    {selectedUsers.length > 0 && (
                                        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 bg-neutral-50">
                                            <span className="text-sm font-medium text-neutral-700">
                                                {t('dashboard.courses.contributors.actions.selected_users', { count: selectedUsers.length })}
                                            </span>
                                            <div className="flex gap-2">
                                                <Button size="sm" onClick={() => setSelectedUsers([])}>
                                                    {t('dashboard.courses.contributors.actions.clear')}
                                                </Button>
                                                <Button size="sm" variant="primary" icon={<UserPlus size={13} />} onClick={handleAddContributors}>
                                                    {t('dashboard.courses.contributors.actions.add_selected')}
                                                </Button>
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
                                                className={`flex items-center justify-between gap-3 px-4 py-3 ${
                                                    isSelected ? 'bg-neutral-50' : ''
                                                } ${!isExistingContributor ? 'cursor-pointer hover:bg-neutral-50' : ''} transition-colors`}
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
                                                <div className="flex items-center gap-3 min-w-0">
                                                    <div onClick={(e) => e.stopPropagation()}>
                                                        <SelectBox
                                                            checked={isSelected || false}
                                                            onClick={() => !isExistingContributor && handleUserSelect(user.username)}
                                                            disabled={isExistingContributor}
                                                        />
                                                    </div>
                                                    <UserAvatar
                                                        width={36}
                                                        avatar_url={user.avatar_url}
                                                        predefined_avatar={user.avatar_image ? undefined : 'empty'}
                                                        userId={user.id.toString()}
                                                        showProfilePopup
                                                        rounded="rounded-full"
                                                        backgroundColor="bg-gray-100"
                                                    />
                                                    <div className="min-w-0">
                                                        <div className="text-sm font-semibold text-neutral-900 truncate">
                                                            {user.first_name} {user.last_name}
                                                        </div>
                                                        <div className="text-xs text-neutral-500 truncate">
                                                            @{user.username}
                                                        </div>
                                                    </div>
                                                </div>
                                                {isExistingContributor && (
                                                    <Chip tone="neutral">
                                                        {t('dashboard.courses.contributors.actions.already_contributor')}
                                                    </Chip>
                                                )}
                                            </div>
                                        );
                                    })}
                                </>
                            ) : (
                                <div className="p-4 text-center text-sm text-neutral-500">
                                    {t('dashboard.courses.contributors.search.no_results')}
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {selectedContributors.length > 0 && (
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-neutral-900 text-white ps-4 pe-1.5 py-1.5">
                        <span className="text-sm font-semibold tabular-nums">
                            {t('dashboard.courses.contributors.actions.selected_contributors', { count: selectedContributors.length })}
                        </span>
                        <div className="flex items-center gap-1">
                            <button
                                type="button"
                                onClick={() => setSelectedContributors([])}
                                className="h-8 px-3 rounded-lg text-xs font-semibold text-white/70 hover:text-white hover:bg-white/10 transition-colors"
                            >
                                {t('dashboard.courses.contributors.actions.clear')}
                            </button>
                            <button
                                type="button"
                                onClick={() => setConfirmRemove(true)}
                                className="h-8 px-3 rounded-lg text-xs font-semibold text-rose-300 hover:text-white hover:bg-rose-500/80 transition-colors inline-flex items-center gap-1.5"
                            >
                                <Trash size={13} />
                                {t('dashboard.courses.contributors.actions.remove_selected')}
                            </button>
                        </div>
                    </div>
                )}

                <ConfirmDialog
                    open={confirmRemove}
                    onOpenChange={setConfirmRemove}
                    title={t('dashboard.courses.editor.contributors.remove_title', { count: selectedContributors.length })}
                    message={t('dashboard.courses.editor.contributors.remove_message')}
                    confirmLabel={t('dashboard.courses.contributors.actions.remove_selected')}
                    onConfirm={handleBulkRemove}
                />

                <div className="max-h-[600px] overflow-auto rounded-xl ring-1 ring-inset ring-neutral-200">
                    <Table>
                        <TableHeader>
                            <TableRow className="bg-neutral-50/80 hover:bg-neutral-50/80">
                                <TableHead className="w-[40px]">
                                    <SelectBox
                                        checked={masterCheckboxChecked}
                                        disabled={nonCreatorContributors.length === 0}
                                        onClick={() => {
                                            if (contributors) {
                                                if (!masterCheckboxChecked) {
                                                    // Select all non-creator contributors
                                                    setSelectedContributors(
                                                        nonCreatorContributors.map(c => c.user_id)
                                                    );
                                                } else {
                                                    setSelectedContributors([]);
                                                }
                                            }
                                        }}
                                    />
                                </TableHead>
                                <TableHead className="w-[50px]"></TableHead>
                                <TableHead className={TH}>{t('dashboard.courses.contributors.table.name')}</TableHead>
                                <TableHead className={TH}>{t('dashboard.courses.contributors.table.username')}</TableHead>
                                <TableHead className={TH}>{t('dashboard.courses.contributors.table.email')}</TableHead>
                                <TableHead className={TH}>{t('dashboard.courses.contributors.table.role')}</TableHead>
                                <TableHead className={TH}>{t('dashboard.courses.contributors.table.status')}</TableHead>
                                <TableHead className={TH}>{t('dashboard.courses.contributors.table.added_on')}</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {sortContributors(contributors).map(withEdits).map((contributor) => (
                                <TableRow
                                    key={`${contributor.user_id}-${contributor.id}`}
                                    className={`${selectedContributors.includes(contributor.user_id) ? 'bg-neutral-50' : ''} ${contributor.authorship !== 'CREATOR' ? 'cursor-pointer hover:bg-neutral-50' : ''}`}
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
                                        <SelectBox
                                            checked={selectedContributors.includes(contributor.user_id)}
                                            onClick={() => handleContributorSelect(contributor.user_id)}
                                            disabled={contributor.authorship === 'CREATOR'}
                                        />
                                    </TableCell>
                                    <TableCell>
                                        <UserAvatar
                                            width={30}
                                            border='border-2'
                                            avatar_url={contributor.user.avatar_image ? getUserAvatarMediaDirectory(contributor.user.user_uuid, contributor.user.avatar_image) : ''}
                                            rounded="rounded-full"
                                            predefined_avatar={contributor.user.avatar_image === '' ? 'empty' : undefined}
                                        />
                                    </TableCell>
                                    <TableCell className="font-semibold text-neutral-900">
                                        <span className="inline-flex items-center gap-1.5">
                                            {contributor.user.first_name} {contributor.user.last_name}
                                            {roleEdits[contributor.user_id] && (
                                                <span
                                                    className="w-1.5 h-1.5 rounded-full bg-amber-400"
                                                    title={t('dashboard.courses.save.unsaved')}
                                                    aria-label={t('dashboard.courses.save.unsaved')}
                                                />
                                            )}
                                        </span>
                                    </TableCell>
                                    <TableCell className="text-neutral-500">
                                        @{contributor.user.username}
                                    </TableCell>
                                    <TableCell className="text-neutral-500">
                                        {contributor.user.email}
                                    </TableCell>
                                    <TableCell>
                                        <RoleDropdown contributor={contributor} />
                                    </TableCell>
                                    <TableCell>
                                        <StatusDropdown contributor={contributor} />
                                    </TableCell>
                                    <TableCell className="text-neutral-500 text-sm tabular-nums">
                                        {formatDate(contributor.creation_date)}
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </div>
            </SectionCard>
        </EditorPage>
    );
}

export default EditCourseContributors;
