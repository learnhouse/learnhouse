import { useLHSession } from '@components/Contexts/LHSessionContext';
import UserAvatar from '@components/Objects/UserAvatar';
import Modal from '@components/Objects/StyledElements/Modal/Modal';
import { getAPIUrl } from '@services/config/config';
import { getUserAvatarMediaDirectory } from '@services/media/media';
import { apiFetch } from '@services/utils/ts/requests';
import { useQueries, useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/keys';
import {
    AlertTriangle,
    ArrowUpDown,
    Check,
    CheckCircle2,
    ChevronDown,
    CircleDashed,
    Clock,
    Hourglass,
    Inbox,
    RotateCcw,
    Search,
    SendHorizonal,
    Users,
    X,
} from 'lucide-react';
import React, { useMemo, useState } from 'react';
import EvaluateAssignment from './Modals/EvaluateAssignment';
import { AssignmentProvider, useAssignments } from '@components/Contexts/Assignments/AssignmentContext';
import { AssignmentsTaskProvider } from '@components/Contexts/Assignments/AssignmentsTaskContext';
import AssignmentSubmissionProvider from '@components/Contexts/Assignments/AssignmentSubmissionContext';
import { useTranslation } from 'react-i18next';
import { formatDate } from '@/lib/format';
import { BTN_PRIMARY_SM, BTN_SECONDARY_SM, Chip, type ChipTone } from '../../_components/assignmentUi';
import { useLHAnalytics, AnalyticsEvent } from '@services/analytics';

type SortField =
    | 'date'             // when the student submitted
    | 'name'             // student display name
    | 'status'           // LATE → SUBMITTED → GRADED (or reverse)
    | 'grade'            // numeric grade value, highest / lowest first
    | 'needs_grading'    // put LATE/SUBMITTED before GRADED so teachers see what to review
    | 'late_first'       // LATE submissions at the top
    | 'recently_graded'; // GRADED first, then sorted by submission date
type SortDirection = 'asc' | 'desc';
type StatusFilter = 'ALL' | 'LATE' | 'SUBMITTED' | 'GRADED' | 'PENDING' | 'NOT_SUBMITTED';

// The submissions endpoint is paginated server-side (`limit` defaults to 50,
// caps at 500) and answers with a bare array (no total, no cursor). Requesting
// it without params silently returned only the newest 50 submitters, which made
// the stats, the filters and the search lie and left everyone else ungradable.
// So we page through explicitly until a short page comes back.
const SUBMISSIONS_PAGE_SIZE = 500;
// Hard stop so a misbehaving server (e.g. one that ignores `offset`) can never
// spin this loop forever.
const SUBMISSIONS_MAX_PAGES = 20;
const SUBMISSIONS_FETCH_CAP = SUBMISSIONS_PAGE_SIZE * SUBMISSIONS_MAX_PAGES;

// Fetch every page of an assignment's submissions. When the returned array is
// exactly SUBMISSIONS_FETCH_CAP long we bailed on the page guard rather than on
// a short page, which is what the UI uses to warn about truncation.
async function fetchAllAssignmentSubmissions(assignment_uuid: string, access_token: string) {
    const all: any[] = [];
    for (let page = 0; page < SUBMISSIONS_MAX_PAGES; page++) {
        const url = `${getAPIUrl()}assignments/assignment_${assignment_uuid}/submissions`
            + `?limit=${SUBMISSIONS_PAGE_SIZE}&offset=${page * SUBMISSIONS_PAGE_SIZE}`;
        const batch = await apiFetch(url, access_token);
        if (!Array.isArray(batch)) break;
        all.push(...batch);
        if (batch.length < SUBMISSIONS_PAGE_SIZE) break;
    }
    return all;
}

// Display name used by the list-level search + name sort. Kept identical to
// what SubmissionRow renders so a student can never match one and not the other.
function displayNameOf(user: any): string {
    if (!user) return '';
    if (user.first_name || user.last_name) {
        return `${user.first_name || ''} ${user.last_name || ''}`.trim();
    }
    return user.username || '';
}

function AssignmentSubmissionsSubPage({ assignment_uuid }: { assignment_uuid: string }) {
    const { t } = useTranslation();
    const session = useLHSession() as any;
    const access_token = session?.data?.tokens?.access_token;

    const [searchQuery, setSearchQuery] = useState('');
    const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
    const [sortField, setSortField] = useState<SortField>('date');
    const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
    const [sortDropdownOpen, setSortDropdownOpen] = useState(false);

    const { data: assignmentSubmissions } = useQuery({
        queryKey: queryKeys.assignments.allSubmissions(assignment_uuid),
        // Paged fetch; see fetchAllAssignmentSubmissions: a single unpaginated
        // request only ever returned the newest 50 rows.
        queryFn: () => fetchAllAssignmentSubmissions(assignment_uuid, access_token),
        enabled: !!(assignment_uuid && access_token),
        // Keep the submissions view in near real-time: poll every 10s so
        // auto-graded submissions show up without a manual page refresh.
        staleTime: 5_000,
        refetchInterval: 10_000,
        refetchOnWindowFocus: false,
        refetchOnReconnect: true,
    });

    // We only ever stop early on a short page, so landing exactly on the cap
    // means there are probably more rows we did not load. Say so out loud
    // instead of hiding students behind a silently truncated list.
    const isTruncated = !!assignmentSubmissions && assignmentSubmissions.length >= SUBMISSIONS_FETCH_CAP;

    const stats = useMemo(() => {
        if (!assignmentSubmissions) return { total: 0, late: 0, submitted: 0, graded: 0, pending: 0, not_submitted: 0 };
        // Every status the API can return gets its own bucket so the pills add
        // up to `total`. PENDING/NOT_SUBMITTED used to fall through and be
        // rendered (and counted) as "Submitted".
        return {
            total: assignmentSubmissions.length,
            late: assignmentSubmissions.filter((s: any) => s.submission_status === 'LATE').length,
            submitted: assignmentSubmissions.filter((s: any) => s.submission_status === 'SUBMITTED').length,
            graded: assignmentSubmissions.filter((s: any) => s.submission_status === 'GRADED').length,
            pending: assignmentSubmissions.filter((s: any) => s.submission_status === 'PENDING').length,
            not_submitted: assignmentSubmissions.filter((s: any) => s.submission_status === 'NOT_SUBMITTED').length,
        };
    }, [assignmentSubmissions]);

    const statusFilters: { key: StatusFilter; label: string; count: number; icon: React.ReactNode }[] = [
        { key: 'ALL', label: t('dashboard.assignments.submissions.filters.all'), count: stats.total, icon: <Users size={14} /> },
        { key: 'SUBMITTED', label: t('dashboard.assignments.submissions.status.submitted'), count: stats.submitted, icon: <SendHorizonal size={14} /> },
        { key: 'LATE', label: t('dashboard.assignments.submissions.status.late'), count: stats.late, icon: <Clock size={14} /> },
        { key: 'GRADED', label: t('dashboard.assignments.submissions.status.graded'), count: stats.graded, icon: <CheckCircle2 size={14} /> },
        // Only surfaced when they actually occur; most assignments have none of
        // these and the toolbar is already crowded. Kept visible while selected
        // so the pill can never vanish and strand the user on an empty list.
        ...(stats.pending > 0 || statusFilter === 'PENDING' ? [{ key: 'PENDING' as StatusFilter, label: t('dashboard.assignments.submissions.status.pending', { defaultValue: 'In progress' }), count: stats.pending, icon: <Hourglass size={14} /> }] : []),
        ...(stats.not_submitted > 0 || statusFilter === 'NOT_SUBMITTED' ? [{ key: 'NOT_SUBMITTED' as StatusFilter, label: t('dashboard.assignments.submissions.preview.not_submitted'), count: stats.not_submitted, icon: <CircleDashed size={14} /> }] : []),
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

    const toGrade = stats.submitted + stats.late;

    return (
        <div className="flex flex-col w-full min-w-0 lg:h-full lg:overflow-y-auto">
            <div className="w-full px-4 sm:px-6 lg:px-10 pt-5 sm:pt-6 pb-10 flex flex-col gap-4">
                {/* Stats */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                    <SubmissionStat
                        icon={<Users size={16} />}
                        iconClass="bg-neutral-100 text-neutral-600"
                        label={t('dashboard.assignments.submissions.stats.total')}
                        value={assignmentSubmissions ? stats.total : null}
                    />
                    <SubmissionStat
                        icon={<SendHorizonal size={16} />}
                        iconClass="bg-amber-50 text-amber-600"
                        label={t('dashboard.assignments.submissions.stats.to_grade')}
                        value={assignmentSubmissions ? toGrade : null}
                        highlight={toGrade > 0}
                    />
                    <SubmissionStat
                        icon={<Clock size={16} />}
                        iconClass="bg-rose-50 text-rose-600"
                        label={t('dashboard.assignments.submissions.status.late')}
                        value={assignmentSubmissions ? stats.late : null}
                    />
                    <SubmissionStat
                        icon={<CheckCircle2 size={16} />}
                        iconClass="bg-emerald-50 text-emerald-600"
                        label={t('dashboard.assignments.submissions.status.graded')}
                        value={assignmentSubmissions ? stats.graded : null}
                    />
                </div>

                {/* Toolbar */}
                <div className="flex flex-col xl:flex-row xl:items-center gap-3">
                    {/* Search */}
                    <div className="relative flex-1 min-w-0 xl:max-w-sm">
                        <Search size={16} className="absolute start-3.5 top-1/2 -translate-y-1/2 text-neutral-400" />
                        <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder={t('dashboard.assignments.submissions.search_placeholder')}
                            className="w-full h-10 ps-10 pe-9 text-sm bg-white nice-shadow rounded-xl focus:outline-none focus:ring-2 focus:ring-neutral-900/10 placeholder:text-neutral-400"
                        />
                        {searchQuery && (
                            <button
                                onClick={() => setSearchQuery('')}
                                aria-label={t('dashboard.assignments.home.clear_search')}
                                className="absolute end-3 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600"
                            >
                                <X size={14} />
                            </button>
                        )}
                    </div>

                    <div className="flex items-center gap-2 min-w-0">
                        {/* Status filter (scrolls sideways on narrow screens) */}
                        <div className="min-w-0 flex-1 xl:flex-none overflow-x-auto scrollbar-hide">
                            <div className="inline-flex items-center rounded-xl bg-neutral-200/60 p-1" role="tablist">
                                {statusFilters.map((filter) => {
                                    const active = statusFilter === filter.key;
                                    return (
                                        <button
                                            key={filter.key}
                                            role="tab"
                                            aria-selected={active}
                                            onClick={() => setStatusFilter(filter.key)}
                                            className={`flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
                                                active ? 'bg-white text-neutral-900 shadow-sm' : 'text-neutral-500 hover:text-neutral-800'
                                            }`}
                                        >
                                            {filter.icon}
                                            <span>{filter.label}</span>
                                            <span className={`tabular-nums ${active ? 'text-neutral-500' : 'text-neutral-400'}`}>{filter.count}</span>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Sort */}
                        <div className="relative shrink-0">
                            <button
                                onClick={() => setSortDropdownOpen(!sortDropdownOpen)}
                                aria-haspopup="menu"
                                aria-expanded={sortDropdownOpen}
                                className="flex items-center gap-1.5 h-10 px-3 text-xs font-semibold text-neutral-700 bg-white nice-shadow rounded-xl hover:text-neutral-900 transition-colors"
                            >
                                <ArrowUpDown size={14} />
                                <span className="hidden sm:inline">{sortOptions.find((o) => o.field === sortField)?.label ?? t('dashboard.assignments.submissions.sort.label')}</span>
                                <ChevronDown size={14} className={`transition-transform ${sortDropdownOpen ? 'rotate-180' : ''}`} />
                            </button>
                            {sortDropdownOpen && (
                                <>
                                    <div className="fixed inset-0 z-10" onClick={() => setSortDropdownOpen(false)} />
                                    <div role="menu" className="absolute end-0 top-full mt-2 z-20 bg-white nice-shadow rounded-xl p-1.5 min-w-[210px]">
                                        <p className="px-2.5 pt-1 pb-1.5 text-xs text-neutral-500">{t('dashboard.assignments.submissions.sort.label')}</p>
                                        {sortOptions.map((option) => {
                                            const active = sortField === option.field;
                                            return (
                                                <button
                                                    key={option.field}
                                                    role="menuitem"
                                                    onClick={() => {
                                                        if (sortField === option.field) {
                                                            setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
                                                        } else {
                                                            setSortField(option.field);
                                                            setSortDirection('desc');
                                                        }
                                                        setSortDropdownOpen(false);
                                                    }}
                                                    className={`w-full h-9 px-2.5 rounded-lg text-sm text-start flex items-center justify-between gap-3 hover:bg-neutral-50 ${
                                                        active ? 'text-neutral-900 font-semibold' : 'text-neutral-600'
                                                    }`}
                                                >
                                                    <span>{option.label}</span>
                                                    {active && (
                                                        <span className="text-neutral-400 text-xs">
                                                            {sortDirection === 'asc' ? '↑' : '↓'}
                                                        </span>
                                                    )}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </>
                            )}
                        </div>
                    </div>
                </div>

                {isTruncated && (
                    <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-amber-50 text-amber-800 text-sm font-medium">
                        <AlertTriangle size={16} className="shrink-0" />
                        <span>
                            {t('dashboard.assignments.submissions.truncated_warning', {
                                max: SUBMISSIONS_FETCH_CAP,
                                defaultValue: 'Only the first {{max}} submissions are shown. Some submissions are not listed here.',
                            })}
                        </span>
                    </div>
                )}

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

function SubmissionStat({
    icon,
    iconClass,
    label,
    value,
    highlight = false,
}: {
    icon: React.ReactNode;
    iconClass: string;
    label: string;
    value: number | null;
    highlight?: boolean;
}) {
    return (
        <div className={`flex items-center gap-3 bg-white nice-shadow rounded-2xl px-4 py-3.5 min-w-0 ${highlight ? 'ring-1 ring-amber-200' : ''}`}>
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${iconClass}`}>{icon}</div>
            <div className="min-w-0">
                <p className="text-xs text-neutral-500 truncate">{label}</p>
                {value === null ? (
                    <div className="mt-1 h-5 w-8 rounded bg-neutral-100 animate-pulse" />
                ) : (
                    <p className="text-xl font-bold text-neutral-900 tabular-nums leading-tight">{value}</p>
                )}
            </div>
        </div>
    );
}

// Desktop table layout: the card is the grid and the header, list and rows
// are subgrids, so the auto-sized button column lines up across every row.
const SUB_TABLE_GRID =
    'xl:grid xl:grid-cols-[minmax(0,2.2fr)_minmax(0,1.2fr)_minmax(0,0.7fr)_minmax(0,1fr)_minmax(0,1.1fr)_auto] xl:gap-x-4';
const SUB_ROW_GRID = 'xl:col-span-full xl:grid xl:grid-cols-subgrid xl:items-center xl:gap-x-4';

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
    const session = useLHSession() as any;
    const access_token = session?.data?.tokens?.access_token;

    // Prefetch every submitter at list level. These use the exact same query
    // key as the rows did, so react-query dedupes them (no extra requests),
    // but having the names here is what makes a real "sort by name" and a
    // list-level search predicate possible at all.
    const userQueries = useQueries({
        queries: (submissions || []).map((s: any) => ({
            queryKey: ['users', 'id', s.user_id],
            queryFn: () => apiFetch(`${getAPIUrl()}users/id/${s.user_id}`, access_token),
            enabled: !!(s.user_id && access_token),
            staleTime: 60_000,
        })),
    });

    const usersById = new Map<number, any>();
    (submissions || []).forEach((s: any, i: number) => {
        const u = userQueries[i]?.data;
        if (u) usersById.set(s.user_id, u);
    });

    if (!submissions) {
        return (
            <div className="bg-white nice-shadow rounded-2xl overflow-hidden animate-pulse divide-y divide-neutral-100">
                {[1, 2, 3, 4, 5].map((i) => (
                    <div key={i} className="flex items-center px-5 py-4 gap-3">
                        <div className="w-10 h-10 rounded-full bg-neutral-100 flex-shrink-0" />
                        <div className="flex-1 space-y-1.5">
                            <div className="h-3.5 bg-neutral-100 rounded w-1/3" />
                            <div className="h-3 bg-neutral-100 rounded w-1/4" />
                        </div>
                        <div className="h-6 w-20 bg-neutral-100 rounded-full" />
                    </div>
                ))}
            </div>
        );
    }

    // Priority tables used by the status-based sorts. Lower numbers come first
    // when `sortDirection === 'asc'`. PENDING/NOT_SUBMITTED sit last everywhere:
    // there is nothing submitted to review on those rows.
    const statusOrder: Record<string, number> = { LATE: 0, SUBMITTED: 1, GRADED: 2, PENDING: 3, NOT_SUBMITTED: 4 };
    // needsGradingOrder: ungraded (LATE + SUBMITTED) before GRADED
    const needsGradingOrder: Record<string, number> = { LATE: 0, SUBMITTED: 0, GRADED: 1, PENDING: 2, NOT_SUBMITTED: 2 };
    // lateFirstOrder: LATE first, everything else after
    const lateFirstOrder: Record<string, number> = { LATE: 0, SUBMITTED: 1, GRADED: 1, PENDING: 2, NOT_SUBMITTED: 2 };
    // recentlyGradedOrder: GRADED first, then everything else
    const recentlyGradedOrder: Record<string, number> = { GRADED: 0, LATE: 1, SUBMITTED: 1, PENDING: 2, NOT_SUBMITTED: 2 };

    const dateMs = (s: any) => new Date(s.creation_date).getTime();

    // Search lives here rather than inside the row: when the rows filtered
    // themselves out, `filtered.length` stayed >0 so the empty state never
    // rendered (blank list area) and `isLast` pointed at a hidden row (stray
    // bottom border).
    const q = searchQuery.trim().toLowerCase();
    const matchesSearch = (s: any) => {
        if (!q) return true;
        const user = usersById.get(s.user_id);
        // Keep the row until its user record lands, otherwise everything
        // disappears for a frame on every refetch.
        if (!user) return true;
        const fullName = `${user.first_name || ''} ${user.last_name || ''}`.toLowerCase();
        const username = (user.username || '').toLowerCase();
        const email = (user.email || '').toLowerCase();
        return fullName.includes(q) || username.includes(q) || email.includes(q);
    };

    const filtered = submissions
        .filter((s: any) => {
            if (statusFilter !== 'ALL' && s.submission_status !== statusFilter) return false;
            return matchesSearch(s);
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
            } else if (sortField === 'name') {
                // Real name sort, now that the users are prefetched above.
                // Rows whose user hasn't loaded yet sort to the end instead of
                // jumping around as each request resolves.
                const aName = displayNameOf(usersById.get(a.user_id));
                const bName = displayNameOf(usersById.get(b.user_id));
                if (!aName || !bName) {
                    if (aName !== bName) return aName ? -1 : 1;
                } else {
                    cmp = aName.localeCompare(bName, undefined, { sensitivity: 'base' });
                }
                if (cmp === 0) cmp = dateMs(a) - dateMs(b);
            } else {
                // Any unknown field: delegate to date as a safe fallback.
                cmp = dateMs(a) - dateMs(b);
            }
            return sortDirection === 'asc' ? cmp : -cmp;
        });

    if (filtered.length === 0) {
        return (
            <div className="bg-white nice-shadow rounded-2xl flex flex-col items-center justify-center text-center py-16 px-6 gap-3">
                <div className="w-12 h-12 rounded-2xl bg-neutral-100 text-neutral-400 flex items-center justify-center">
                    <Inbox size={22} />
                </div>
                <p className="text-base font-semibold text-neutral-900">{t('dashboard.assignments.submissions.empty')}</p>
                {submissions.length === 0 && (
                    <p className="text-sm text-neutral-500 max-w-sm">{t('dashboard.assignments.submissions.empty_description')}</p>
                )}
            </div>
        );
    }

    return (
        <div className={`bg-white nice-shadow rounded-2xl overflow-hidden ${SUB_TABLE_GRID}`}>
            <div className={`hidden ${SUB_ROW_GRID} px-5 py-3 border-b border-neutral-100 text-xs font-medium text-neutral-500`}>
                <span>{t('dashboard.assignments.submissions.columns.learner')}</span>
                <span>{t('dashboard.assignments.submissions.sort.date')}</span>
                <span>{t('assignments.attempt_label')}</span>
                <span>{t('common.status')}</span>
                <span>{t('assignments.grade')}</span>
                <span className="sr-only">{t('dashboard.assignments.home.columns.actions')}</span>
            </div>
            <ul className={`divide-y divide-neutral-100 ${SUB_ROW_GRID}`}>
                {filtered.map((submission: any) => (
                    <SubmissionRow
                        key={submission.assignmentusersubmission_uuid || submission.id}
                        submission={submission}
                        assignment_uuid={assignment_uuid}
                        user={usersById.get(submission.user_id)}
                    />
                ))}
            </ul>
        </div>
    );
}

function SubmissionRow({
    assignment_uuid,
    submission,
    user,
}: {
    assignment_uuid: string;
    submission: any;
    user: any;
}) {
    const { t, i18n } = useTranslation();
    const { track } = useLHAnalytics('dashboard');
    const assignment = useAssignments() as any;
    const [gradeModalOpen, setGradeModalOpen] = useState(false);

    // Every status the API can return is listed explicitly. The old fallback
    // to SUBMITTED painted a mid-retry PENDING row with the amber "Submitted"
    // badge, so a teacher would open Evaluate on a student who had submitted
    // nothing and grading it would zero their in-flight retry. It also broke
    // the filter, which compares the real status and therefore hid the very
    // row that claimed to be "Submitted".
    const statusConfig: Record<string, { label: string; tone: ChipTone; icon: React.ReactNode }> = {
        LATE: {
            label: t('dashboard.assignments.submissions.status.late'),
            tone: 'rose',
            icon: <Clock size={12} />,
        },
        SUBMITTED: {
            label: t('dashboard.assignments.submissions.status.submitted'),
            tone: 'amber',
            icon: <SendHorizonal size={12} />,
        },
        GRADED: {
            label: t('dashboard.assignments.submissions.status.graded'),
            tone: 'emerald',
            icon: <CheckCircle2 size={12} />,
        },
        PENDING: {
            label: t('dashboard.assignments.submissions.status.pending', { defaultValue: 'In progress' }),
            tone: 'neutral',
            icon: <Hourglass size={12} />,
        },
        NOT_SUBMITTED: {
            label: t('dashboard.assignments.submissions.preview.not_submitted'),
            tone: 'neutral',
            icon: <CircleDashed size={12} />,
        },
    };

    // Unrecognised statuses degrade to a neutral chip that shows the raw value
    // rather than claiming the student submitted.
    const status = statusConfig[submission.submission_status] || {
        label: submission.submission_status || t('common.unknown'),
        tone: 'neutral' as ChipTone,
        icon: <CircleDashed size={12} />,
    };
    const submittedDate = new Date(submission.creation_date);
    // 'en-UK' was not a valid locale tag (the UK is en-GB), so this silently
    // fell back to the browser default regardless of the UI language.
    const dateStr = formatDate(submittedDate, i18n.language, {
        dateStyle: undefined,
        year: 'numeric',
        month: 'short',
        day: 'numeric',
    });
    const timeStr = formatDate(submittedDate, i18n.language, {
        dateStyle: undefined,
        hour: '2-digit',
        minute: '2-digit',
    });

    const displayName = user?.first_name && user?.last_name
        ? `${user.first_name} ${user.last_name}`
        : user?.username
            ? `@${user.username}`
            : '...';
    const needsGrading = submission.submission_status === 'SUBMITTED' || submission.submission_status === 'LATE';
    const attempt = submission.attempt_number || 1;

    // Grade: show the computed display_grade (e.g. "B", "85/100", "Pass") so
    // the list matches the evaluate modal and the student's own view instead
    // of showing a naked raw sum.
    const gradeCell = submission.submission_status === 'GRADED' ? (
        <span className="inline-flex items-center gap-2 min-w-0">
            <Chip tone={submission.grade_display ? (submission.grade_display.passed ? 'emerald' : 'rose') : 'neutral'} className="tabular-nums">
                {submission.grade_display?.display_grade ?? submission.grade}
            </Chip>
            {submission.grade_display?.points_summary && (
                <span className="text-xs text-neutral-500 tabular-nums truncate">{submission.grade_display.points_summary}</span>
            )}
        </span>
    ) : (
        <span className="text-sm text-neutral-300" aria-hidden>—</span>
    );

    // One trigger per layout (compact row / desktop cell); both open the same
    // controlled dialog below, the same path the old DialogTrigger took.
    const openEvaluate = () => {
        track(AnalyticsEvent.SubmissionEvaluateOpened, {
            submission_status: submission.submission_status,
            attempt_number: submission.attempt_number ?? 1,
        })
        setGradeModalOpen(true)
    };
    const evaluateButton = (
        <button
            type="button"
            onClick={openEvaluate}
            className={needsGrading ? BTN_PRIMARY_SM : BTN_SECONDARY_SM}
        >
            {needsGrading ? <Check size={14} /> : null}
            {needsGrading
                ? t('dashboard.assignments.submissions.evaluate')
                : t('dashboard.assignments.submissions.review')}
        </button>
    );

    return (
        <li className={`px-4 sm:px-5 py-4 hover:bg-neutral-50/70 transition-colors ${SUB_ROW_GRID}`}>
            {/* Learner */}
            <div className="flex items-center gap-3 min-w-0">
                <UserAvatar
                    avatar_url={getUserAvatarMediaDirectory(user?.user_uuid, user?.avatar_image)}
                    predefined_avatar={user?.avatar_image ? undefined : 'empty'}
                    width={40}
                    rounded="rounded-full"
                />
                <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-neutral-900 truncate">{displayName}</p>
                    {user?.email && <p className="text-xs text-neutral-500 truncate">{user.email}</p>}
                </div>
                <span className="xl:hidden shrink-0">
                    <Chip tone={status.tone} icon={status.icon}>{status.label}</Chip>
                </span>
            </div>

            {/* Compact meta + action (below xl) */}
            <div className="xl:hidden mt-2.5 ps-[52px] flex items-center gap-3">
                <div className="min-w-0 flex-1 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-neutral-500">
                    <span className="tabular-nums">{dateStr} · {timeStr}</span>
                    {attempt > 1 && (
                        <Chip tone="sky" icon={<RotateCcw size={12} />}>{t('assignments.attempt_count', { current: attempt })}</Chip>
                    )}
                    {submission.submission_status === 'GRADED' && gradeCell}
                </div>
                <span className="shrink-0">{evaluateButton}</span>
            </div>

            {/* Submitted */}
            <div className="hidden xl:block min-w-0">
                <p className="text-sm text-neutral-700 tabular-nums truncate">{dateStr}</p>
                <p className="text-xs text-neutral-400 tabular-nums">{timeStr}</p>
            </div>

            {/* Attempt */}
            <div className="hidden xl:block">
                {attempt > 1 ? (
                    <Chip tone="sky" icon={<RotateCcw size={12} />} className="tabular-nums">{attempt}</Chip>
                ) : (
                    <span className="text-sm text-neutral-700 tabular-nums">{attempt}</span>
                )}
            </div>

            {/* Status */}
            <div className="hidden xl:block">
                <Chip tone={status.tone} icon={status.icon}>{status.label}</Chip>
            </div>

            {/* Grade */}
            <div className="hidden xl:block min-w-0">{gradeCell}</div>

            {/* Evaluate (desktop cell) */}
            <div className="hidden xl:flex xl:justify-end">{evaluateButton}</div>

            <Modal
                isDialogOpen={gradeModalOpen}
                onOpenChange={(open: boolean) => {
                    if (open && !gradeModalOpen) {
                        track(AnalyticsEvent.SubmissionEvaluateOpened, {
                            submission_status: submission.submission_status,
                            attempt_number: submission.attempt_number ?? 1,
                        })
                    }
                    setGradeModalOpen(open)
                }}
                minHeight="lg"
                minWidth="lg"
                dialogContent={
                    <AssignmentProvider assignment_uuid={'assignment_' + assignment_uuid}>
                        <AssignmentsTaskProvider>
                            <AssignmentSubmissionProvider assignment_uuid={'assignment_' + assignment_uuid}>
                                <EvaluateAssignment
                                    user_id={submission.user_id}
                                    user={user}
                                    submission={submission}
                                    statusChip={<Chip tone={status.tone} icon={status.icon}>{status.label}</Chip>}
                                />
                            </AssignmentSubmissionProvider>
                        </AssignmentsTaskProvider>
                    </AssignmentProvider>
                }
                dialogTitle={t('dashboard.assignments.submissions.evaluate_modal.title_name', { name: displayName })}
                dialogDescription={assignment?.assignment_object?.title || t('dashboard.assignments.submissions.evaluate_modal.description')}
            />
        </li>
    );
}

export default AssignmentSubmissionsSubPage;
