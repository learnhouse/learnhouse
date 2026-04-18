import { useLHSession } from '@components/Contexts/LHSessionContext';
import UserAvatar from '@components/Objects/UserAvatar';
import Modal from '@components/Objects/StyledElements/Modal/Modal';
import { getAPIUrl } from '@services/config/config';
import { getUserAvatarMediaDirectory } from '@services/media/media';
import { swrFetcher } from '@services/utils/ts/requests';
import {
    ArrowUpDown,
    Calendar,
    CheckCircle2,
    ChevronDown,
    Clock,
    Inbox,
    Search,
    SendHorizonal,
    Users,
    X,
} from 'lucide-react';
import React, { useMemo, useState } from 'react';
import useSWR from 'swr';
import EvaluateAssignment from './Modals/EvaluateAssignment';
import { AssignmentProvider } from '@components/Contexts/Assignments/AssignmentContext';
import { AssignmentsTaskProvider } from '@components/Contexts/Assignments/AssignmentsTaskContext';
import AssignmentSubmissionProvider from '@components/Contexts/Assignments/AssignmentSubmissionContext';
import { useTranslation } from 'react-i18next';

type SortField =
    | 'date'             // when the student submitted
    | 'name'             // student display name
    | 'status'           // LATE → SUBMITTED → GRADED (or reverse)
    | 'grade'            // numeric grade value — highest / lowest first
    | 'needs_grading'    // put LATE/SUBMITTED before GRADED so teachers see what to review
    | 'late_first'       // LATE submissions at the top
    | 'recently_graded'; // GRADED first, then sorted by submission date
type SortDirection = 'asc' | 'desc';
type StatusFilter = 'ALL' | 'LATE' | 'SUBMITTED' | 'GRADED';

function AssignmentSubmissionsSubPage({ assignment_uuid }: { assignment_uuid: string }) {
    const { t } = useTranslation();
    const session = useLHSession() as any;
    const access_token = session?.data?.tokens?.access_token;

    const [searchQuery, setSearchQuery] = useState('');
    const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
    const [sortField, setSortField] = useState<SortField>('date');
    const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
    const [sortDropdownOpen, setSortDropdownOpen] = useState(false);

    const { data: assignmentSubmissions } = useSWR(
        `${getAPIUrl()}assignments/assignment_${assignment_uuid}/submissions`,
        (url) => swrFetcher(url, access_token),
        {
            // Keep the submissions view in near real-time: poll every 10s, and
            // refetch whenever the teacher refocuses the tab or reconnects.
            // 10s is a reasonable floor — auto-graded submissions should show
            // up without the teacher having to manually refresh the page.
            refreshInterval: 10000,
            revalidateOnFocus: true,
            revalidateOnReconnect: true,
            dedupingInterval: 5000,
        }
    );

    const stats = useMemo(() => {
        if (!assignmentSubmissions) return { total: 0, late: 0, submitted: 0, graded: 0 };
        return {
            total: assignmentSubmissions.length,
            late: assignmentSubmissions.filter((s: any) => s.submission_status === 'LATE').length,
            submitted: assignmentSubmissions.filter((s: any) => s.submission_status === 'SUBMITTED').length,
            graded: assignmentSubmissions.filter((s: any) => s.submission_status === 'GRADED').length,
        };
    }, [assignmentSubmissions]);

    const statusFilters: { key: StatusFilter; label: string; count: number; icon: React.ReactNode; activeClass: string }[] = [
        { key: 'ALL', label: t('dashboard.assignments.submissions.filters.all'), count: stats.total, icon: <Users size={13} />, activeClass: 'bg-neutral-600/80 text-white' },
        { key: 'LATE', label: t('dashboard.assignments.submissions.status.late'), count: stats.late, icon: <Clock size={13} />, activeClass: 'bg-rose-600/80 text-white' },
        { key: 'SUBMITTED', label: t('dashboard.assignments.submissions.status.submitted'), count: stats.submitted, icon: <SendHorizonal size={13} />, activeClass: 'bg-amber-600/80 text-white' },
        { key: 'GRADED', label: t('dashboard.assignments.submissions.status.graded'), count: stats.graded, icon: <CheckCircle2 size={13} />, activeClass: 'bg-emerald-600/80 text-white' },
    ];

    const sortOptions: { field: SortField; label: string }[] = [
        { field: 'date', label: t('dashboard.assignments.submissions.sort.date') },
        { field: 'name', label: t('dashboard.assignments.submissions.sort.name') },
        { field: 'status', label: t('dashboard.assignments.submissions.sort.status') },
        { field: 'grade', label: t('dashboard.assignments.submissions.sort.grade') },
        { field: 'needs_grading', label: t('dashboard.assignments.submissions.sort.needs_grading') },
        { field: 'late_first', label: t('dashboard.assignments.submissions.sort.late_first') },
        { field: 'recently_graded', label: t('dashboard.assignments.submissions.sort.recently_graded') },
    ];

    return (
        <div className="flex flex-col w-full h-full custom-dots-bg">
            <div className="px-10 pt-6 pb-4 flex flex-col space-y-4">
                {/* Stats row */}
                <div className="flex gap-3">
                    <div className="bg-white nice-shadow rounded-xl px-4 py-3 flex items-center space-x-3">
                        <div className="bg-gray-100 rounded-lg p-1.5">
                            <Users size={14} className="text-gray-600" />
                        </div>
                        <div>
                            <p className="text-[10px] uppercase tracking-wide font-semibold text-gray-400">{t('dashboard.assignments.submissions.stats.total')}</p>
                            <p className="text-lg font-bold text-gray-900 -mt-0.5">{stats.total}</p>
                        </div>
                    </div>
                    <div className="bg-white nice-shadow rounded-xl px-4 py-3 flex items-center space-x-3">
                        <div className="bg-rose-50 rounded-lg p-1.5">
                            <Clock size={14} className="text-rose-600" />
                        </div>
                        <div>
                            <p className="text-[10px] uppercase tracking-wide font-semibold text-gray-400">{t('dashboard.assignments.submissions.status.late')}</p>
                            <p className="text-lg font-bold text-gray-900 -mt-0.5">{stats.late}</p>
                        </div>
                    </div>
                    <div className="bg-white nice-shadow rounded-xl px-4 py-3 flex items-center space-x-3">
                        <div className="bg-amber-50 rounded-lg p-1.5">
                            <SendHorizonal size={14} className="text-amber-600" />
                        </div>
                        <div>
                            <p className="text-[10px] uppercase tracking-wide font-semibold text-gray-400">{t('dashboard.assignments.submissions.status.submitted')}</p>
                            <p className="text-lg font-bold text-gray-900 -mt-0.5">{stats.submitted}</p>
                        </div>
                    </div>
                    <div className="bg-white nice-shadow rounded-xl px-4 py-3 flex items-center space-x-3">
                        <div className="bg-emerald-50 rounded-lg p-1.5">
                            <CheckCircle2 size={14} className="text-emerald-600" />
                        </div>
                        <div>
                            <p className="text-[10px] uppercase tracking-wide font-semibold text-gray-400">{t('dashboard.assignments.submissions.status.graded')}</p>
                            <p className="text-lg font-bold text-gray-900 -mt-0.5">{stats.graded}</p>
                        </div>
                    </div>
                </div>

                {/* Toolbar */}
                <div className="flex items-center gap-3">
                    {/* Search */}
                    <div className="relative flex-1 max-w-sm">
                        <Search size={14} className="absolute start-3 top-1/2 -translate-y-1/2 text-gray-400" />
                        <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder={t('dashboard.assignments.submissions.search_placeholder')}
                            className="w-full ps-9 pe-8 py-2 text-sm bg-white nice-shadow rounded-lg focus:outline-none focus:ring-2 focus:ring-black/5 placeholder:text-gray-400"
                        />
                        {searchQuery && (
                            <button
                                onClick={() => setSearchQuery('')}
                                className="absolute end-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                            >
                                <X size={14} />
                            </button>
                        )}
                    </div>

                    {/* Status filter pills */}
                    <div className="flex gap-1.5">
                        {statusFilters.map((filter) => (
                            <button
                                key={filter.key}
                                onClick={() => setStatusFilter(filter.key)}
                                className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${
                                    statusFilter === filter.key
                                        ? filter.activeClass
                                        : 'bg-white nice-shadow text-gray-600 hover:bg-gray-50'
                                }`}
                            >
                                {filter.icon}
                                <span>{filter.label}</span>
                                <span className={`${statusFilter === filter.key ? 'bg-white/20' : 'bg-gray-100'} px-1.5 py-0.5 rounded-full text-[10px] font-bold`}>
                                    {filter.count}
                                </span>
                            </button>
                        ))}
                    </div>

                    {/* Sort */}
                    <div className="relative">
                        <button
                            onClick={() => setSortDropdownOpen(!sortDropdownOpen)}
                            className="flex items-center space-x-1.5 px-3 py-1.5 text-xs font-semibold text-gray-600 bg-white nice-shadow rounded-full hover:bg-gray-50 transition-colors"
                        >
                            <ArrowUpDown size={12} />
                            <span>{t('dashboard.assignments.submissions.sort.label')}</span>
                            <ChevronDown size={11} className={`transition-transform ${sortDropdownOpen ? 'rotate-180' : ''}`} />
                        </button>
                        {sortDropdownOpen && (
                            <>
                                <div className="fixed inset-0 z-10" onClick={() => setSortDropdownOpen(false)} />
                                <div className="absolute end-0 top-full mt-2 z-20 bg-white nice-shadow rounded-xl py-1.5 min-w-[150px]">
                                    {sortOptions.map((option) => (
                                        <button
                                            key={option.field}
                                            onClick={() => {
                                                if (sortField === option.field) {
                                                    setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
                                                } else {
                                                    setSortField(option.field);
                                                    setSortDirection('desc');
                                                }
                                                setSortDropdownOpen(false);
                                            }}
                                            className={`w-full px-3 py-1.5 text-xs text-start flex items-center justify-between hover:bg-gray-50 ${
                                                sortField === option.field ? 'text-gray-900 font-bold' : 'text-gray-500 font-medium'
                                            }`}
                                        >
                                            <span>{option.label}</span>
                                            {sortField === option.field && (
                                                <span className="text-gray-400 text-[10px]">
                                                    {sortDirection === 'asc' ? '↑' : '↓'}
                                                </span>
                                            )}
                                        </button>
                                    ))}
                                </div>
                            </>
                        )}
                    </div>
                </div>
            </div>

            {/* Submissions list */}
            <div className="flex-1 overflow-y-auto px-10 pb-6">
                <SubmissionsList
                    submissions={assignmentSubmissions}
                    assignment_uuid={assignment_uuid}
                    searchQuery={searchQuery}
                    statusFilter={statusFilter}
                    sortField={sortField}
                    sortDirection={sortDirection}
                />
            </div>
        </div>
    );
}

function SubmissionsList({
    submissions,
    assignment_uuid,
    searchQuery,
    statusFilter,
    sortField,
    sortDirection,
}: {
    submissions: any[] | undefined;
    assignment_uuid: string;
    searchQuery: string;
    statusFilter: StatusFilter;
    sortField: SortField;
    sortDirection: SortDirection;
}) {
    const { t } = useTranslation();

    if (!submissions) {
        return (
            <div className="flex items-center justify-center h-40 text-sm text-gray-400 font-medium">
                {t('dashboard.assignments.submissions.loading')}
            </div>
        );
    }

    // Priority tables used by the status-based sorts. Lower numbers come first
    // when `sortDirection === 'asc'`.
    const statusOrder: Record<string, number> = { LATE: 0, SUBMITTED: 1, GRADED: 2 };
    // needsGradingOrder: ungraded (LATE + SUBMITTED) before GRADED
    const needsGradingOrder: Record<string, number> = { LATE: 0, SUBMITTED: 0, GRADED: 1 };
    // lateFirstOrder: LATE first, everything else after
    const lateFirstOrder: Record<string, number> = { LATE: 0, SUBMITTED: 1, GRADED: 1 };
    // recentlyGradedOrder: GRADED first, then everything else
    const recentlyGradedOrder: Record<string, number> = { GRADED: 0, LATE: 1, SUBMITTED: 1 };

    const dateMs = (s: any) => new Date(s.creation_date).getTime();

    const filtered = submissions
        .filter((s: any) => {
            if (statusFilter !== 'ALL' && s.submission_status !== statusFilter) return false;
            return true;
        })
        .sort((a: any, b: any) => {
            let cmp = 0;
            if (sortField === 'date') {
                cmp = dateMs(a) - dateMs(b);
            } else if (sortField === 'status') {
                cmp = (statusOrder[a.submission_status] ?? 1) - (statusOrder[b.submission_status] ?? 1);
                // Tiebreak by date so stable output in groups
                if (cmp === 0) cmp = dateMs(a) - dateMs(b);
            } else if (sortField === 'grade') {
                // Sort by numeric grade. Ungraded rows (grade === 0 AND status !== GRADED)
                // sink to the bottom regardless of direction so teachers see the
                // actually-graded ones first.
                const aGraded = a.submission_status === 'GRADED';
                const bGraded = b.submission_status === 'GRADED';
                if (aGraded !== bGraded) return aGraded ? -1 : 1;
                cmp = (Number(a.grade) || 0) - (Number(b.grade) || 0);
                if (cmp === 0) cmp = dateMs(a) - dateMs(b);
            } else if (sortField === 'needs_grading') {
                cmp = (needsGradingOrder[a.submission_status] ?? 1) - (needsGradingOrder[b.submission_status] ?? 1);
                // Inside the "needs grading" bucket, show oldest first (they've
                // been waiting longest). Inside the "graded" bucket, newest first.
                if (cmp === 0) {
                    const oldestFirst = a.submission_status !== 'GRADED';
                    cmp = oldestFirst ? dateMs(a) - dateMs(b) : dateMs(b) - dateMs(a);
                }
            } else if (sortField === 'late_first') {
                cmp = (lateFirstOrder[a.submission_status] ?? 1) - (lateFirstOrder[b.submission_status] ?? 1);
                if (cmp === 0) cmp = dateMs(a) - dateMs(b);
            } else if (sortField === 'recently_graded') {
                cmp = (recentlyGradedOrder[a.submission_status] ?? 1) - (recentlyGradedOrder[b.submission_status] ?? 1);
                // Inside the graded bucket, newest updates first
                if (cmp === 0) cmp = dateMs(b) - dateMs(a);
            } else {
                // name and any unknown: delegate to date as a safe fallback
                // (name sort happens inside the row component since user data
                // is fetched there)
                cmp = dateMs(a) - dateMs(b);
            }
            return sortDirection === 'asc' ? cmp : -cmp;
        });

    if (filtered.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center py-16 text-gray-400 gap-3">
                <div className="bg-gray-100 rounded-2xl p-4">
                    <Inbox size={24} />
                </div>
                <p className="text-sm font-semibold">{t('dashboard.assignments.submissions.empty')}</p>
            </div>
        );
    }

    return (
        <div className="bg-white nice-shadow rounded-xl overflow-hidden">
            {filtered.map((submission: any, index: number) => (
                <SubmissionRow
                    key={submission.assignmentusersubmission_uuid || submission.id}
                    submission={submission}
                    assignment_uuid={assignment_uuid}
                    searchQuery={searchQuery}
                    isLast={index === filtered.length - 1}
                />
            ))}
        </div>
    );
}

function SubmissionRow({
    assignment_uuid,
    submission,
    searchQuery,
    isLast,
}: {
    assignment_uuid: string;
    submission: any;
    searchQuery: string;
    isLast: boolean;
}) {
    const { t } = useTranslation();
    const session = useLHSession() as any;
    const access_token = session?.data?.tokens?.access_token;
    const [gradeModalOpen, setGradeModalOpen] = useState(false);

    const { data: user } = useSWR(
        `${getAPIUrl()}users/id/${submission.user_id}`,
        (url) => swrFetcher(url, access_token),
        { revalidateOnFocus: false }
    );

    const matchesSearch = useMemo(() => {
        if (!searchQuery) return true;
        if (!user) return true;
        const q = searchQuery.toLowerCase();
        const fullName = `${user.first_name || ''} ${user.last_name || ''}`.toLowerCase();
        const username = (user.username || '').toLowerCase();
        const email = (user.email || '').toLowerCase();
        return fullName.includes(q) || username.includes(q) || email.includes(q);
    }, [searchQuery, user]);

    if (!matchesSearch) return null;

    const statusConfig: Record<string, { label: string; className: string; icon: React.ReactNode }> = {
        LATE: {
            label: t('dashboard.assignments.submissions.status.late'),
            className: 'bg-rose-50 text-rose-700',
            icon: <Clock size={11} />,
        },
        SUBMITTED: {
            label: t('dashboard.assignments.submissions.status.submitted'),
            className: 'bg-amber-50 text-amber-700',
            icon: <SendHorizonal size={11} />,
        },
        GRADED: {
            label: t('dashboard.assignments.submissions.status.graded'),
            className: 'bg-emerald-50 text-emerald-700',
            icon: <CheckCircle2 size={11} />,
        },
    };

    const status = statusConfig[submission.submission_status] || statusConfig['SUBMITTED'];
    const submittedDate = new Date(submission.creation_date);
    const dateStr = submittedDate.toLocaleDateString('en-UK', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
    });
    const timeStr = submittedDate.toLocaleTimeString('en-UK', {
        hour: '2-digit',
        minute: '2-digit',
    });

    return (
        <div className={`flex items-center px-5 py-3.5 hover:bg-gray-50/60 transition-colors group ${!isLast ? 'border-b border-gray-100' : ''}`}>
            {/* User info */}
            <div className="flex items-center space-x-3 flex-1 min-w-0">
                <UserAvatar
                    border="border-2"
                    avatar_url={getUserAvatarMediaDirectory(user?.user_uuid, user?.avatar_image)}
                    predefined_avatar={user?.avatar_image ? undefined : 'empty'}
                    width={36}
                />
                <div className="min-w-0">
                    <p className="text-sm font-semibold text-gray-900 truncate">
                        {user?.first_name && user?.last_name
                            ? `${user.first_name} ${user.last_name}`
                            : user?.username
                                ? `@${user.username}`
                                : '...'}
                    </p>
                    <p className="text-xs text-gray-400 truncate">{user?.email}</p>
                </div>
            </div>

            {/* Grade */}
            {submission.submission_status === 'GRADED' && (
                <div className="flex items-center space-x-1.5 me-5">
                    <span className="bg-gray-100 text-gray-500 text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full">{t('dashboard.assignments.submissions.grade_label')}</span>
                    <span className="text-sm font-bold text-gray-900">{submission.grade}</span>
                </div>
            )}

            {/* Date */}
            <div className="flex items-center space-x-1.5 me-5 text-gray-400">
                <Calendar size={12} />
                <span className="text-xs font-medium">{dateStr}</span>
                <span className="text-[10px] text-gray-300">|</span>
                <span className="text-xs text-gray-300">{timeStr}</span>
            </div>

            {/* Status badge */}
            <div className={`flex items-center space-x-1 px-2.5 py-1 rounded-full me-4 text-xs font-semibold ${status.className}`}>
                {status.icon}
                <span>{status.label}</span>
            </div>

            {/* Evaluate button */}
            <Modal
                isDialogOpen={gradeModalOpen}
                onOpenChange={(open: boolean) => setGradeModalOpen(open)}
                minHeight="lg"
                minWidth="lg"
                dialogContent={
                    <AssignmentProvider assignment_uuid={'assignment_' + assignment_uuid}>
                        <AssignmentsTaskProvider>
                            <AssignmentSubmissionProvider assignment_uuid={'assignment_' + assignment_uuid}>
                                <EvaluateAssignment user_id={submission.user_id} />
                            </AssignmentSubmissionProvider>
                        </AssignmentsTaskProvider>
                    </AssignmentProvider>
                }
                dialogTitle={t('dashboard.assignments.submissions.evaluate_modal.title', { username: user?.username })}
                dialogDescription={t('dashboard.assignments.submissions.evaluate_modal.description')}
                dialogTrigger={
                    <div className="bg-black hover:bg-gray-800 text-white font-bold py-1.5 px-3.5 rounded-md text-xs cursor-pointer nice-shadow transition-colors">
                        {t('dashboard.assignments.submissions.evaluate')}
                    </div>
                }
            />
        </div>
    );
}

export default AssignmentSubmissionsSubPage;
