import { useLHSession } from '@components/Contexts/LHSessionContext';
import { useAssignments } from '@components/Contexts/Assignments/AssignmentContext';
import UserAvatar from '@components/Objects/UserAvatar';
import { getAPIUrl } from '@services/config/config';
import { getUserAvatarMediaDirectory } from '@services/media/media';
import { swrFetcher } from '@services/utils/ts/requests';
import {
    Activity,
    Award,
    BarChart3,
    CheckCircle2,
    ChevronsUp,
    Clock,
    Flame,
    LineChart as LineChartIcon,
    Medal,
    MessagesSquare,
    Minus,
    Sparkles,
    Target,
    TrendingUp,
    Trophy,
} from 'lucide-react';
import React, { useMemo } from 'react';
import useSWR from 'swr';
import {
    Area,
    AreaChart,
    Bar,
    BarChart,
    CartesianGrid,
    Cell,
    ReferenceLine,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from 'recharts';
import { useTranslation } from 'react-i18next';

type Submission = {
    assignmentusersubmission_uuid: string;
    user_id: number;
    submission_status: 'LATE' | 'SUBMITTED' | 'GRADED' | 'PENDING' | 'NOT_SUBMITTED';
    grade: number;
    overall_feedback?: string;
    creation_date: string;
    update_date: string;
    grade_display?: {
        display_grade: string;
        passed: boolean;
        points_summary?: string;
        percentage_display?: string;
        tasks?: Array<{
            assignment_task_uuid: string;
            grade: number;
            passed: boolean;
            display_grade: string;
        }>;
    };
};

const GRADE_BUCKETS = [
    { key: 'F', label: 'F', min: 0, max: 59, color: '#e11d48' },      // rose-600
    { key: 'D', label: 'D', min: 60, max: 69, color: '#f97316' },     // orange-500
    { key: 'C', label: 'C', min: 70, max: 79, color: '#f59e0b' },     // amber-500
    { key: 'B', label: 'B', min: 80, max: 89, color: '#10b981' },     // emerald-500
    { key: 'A', label: 'A', min: 90, max: 100, color: '#059669' },    // emerald-600
];

function AssignmentAnalyticsSubPage({ assignment_uuid }: { assignment_uuid: string }) {
    const { t } = useTranslation();
    const session = useLHSession() as any;
    const access_token = session?.data?.tokens?.access_token;
    const assignment = useAssignments() as any;
    const assignmentObj = assignment?.assignment_object;
    const tasks = (assignment?.assignment_tasks || []) as any[];

    const { data: submissions } = useSWR<Submission[]>(
        `${getAPIUrl()}assignments/assignment_${assignment_uuid}/submissions`,
        (url) => swrFetcher(url, access_token),
        {
            refreshInterval: 30000,
            revalidateOnFocus: true,
            revalidateOnReconnect: true,
            dedupingInterval: 10000,
        }
    );

    const graded = useMemo(
        () => (submissions || []).filter((s) => s.submission_status === 'GRADED'),
        [submissions]
    );

    const stats = useMemo(() => {
        const all = submissions || [];
        const total = all.length;
        const gradedCount = graded.length;
        const lateCount = all.filter((s) => s.submission_status === 'LATE').length;
        const passedCount = graded.filter((s) => s.grade_display?.passed).length;
        const withFeedback = graded.filter(
            (s) => (s.overall_feedback || '').trim().length > 0
        ).length;

        // Work in percentage space — the raw `grade` field is a points sum
        // (e.g. 267/500), not a 0–100 value, so it can't drive stats or
        // distribution buckets directly.
        const pctValues = graded
            .map(submissionPct)
            .filter((v): v is number => v !== null)
            .sort((a, b) => a - b);

        const sum = pctValues.reduce((acc, v) => acc + v, 0);
        const avg = pctValues.length ? sum / pctValues.length : 0;

        let median = 0;
        if (pctValues.length) {
            const mid = Math.floor(pctValues.length / 2);
            median = pctValues.length % 2 === 0
                ? (pctValues[mid - 1] + pctValues[mid]) / 2
                : pctValues[mid];
        }

        const highest = pctValues.length ? pctValues[pctValues.length - 1] : 0;
        const lowest = pctValues.length ? pctValues[0] : 0;
        const spread = highest - lowest;

        const passRate = gradedCount ? (passedCount / gradedCount) * 100 : 0;
        const onTimeRate = total ? ((total - lateCount) / total) * 100 : 0;
        const feedbackRate = gradedCount ? (withFeedback / gradedCount) * 100 : 0;

        return {
            total,
            gradedCount,
            lateCount,
            passedCount,
            passRate,
            onTimeRate,
            feedbackRate,
            avg,
            median,
            highest,
            lowest,
            spread,
            hasPctData: pctValues.length > 0,
        };
    }, [submissions, graded]);

    const distributionData = useMemo(() => {
        return GRADE_BUCKETS.map((bucket) => {
            const count = graded.filter((s) => {
                const pct = submissionPct(s);
                return pct !== null && pct >= bucket.min && pct <= bucket.max;
            }).length;
            return { ...bucket, count };
        });
    }, [graded]);

    const timelineData = useMemo(() => {
        if (!submissions?.length) return [];
        const byDay = new Map<string, { date: string; submitted: number; graded: number }>();
        for (const s of submissions) {
            const d = new Date(s.creation_date);
            if (isNaN(d.getTime())) continue;
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            const entry = byDay.get(key) || { date: key, submitted: 0, graded: 0 };
            entry.submitted += 1;
            if (s.submission_status === 'GRADED') entry.graded += 1;
            byDay.set(key, entry);
        }
        return Array.from(byDay.values()).sort((a, b) => (a.date < b.date ? -1 : 1));
    }, [submissions]);

    const timelineMax = useMemo(() => {
        let m = 0;
        for (const d of timelineData) m = Math.max(m, d.submitted, d.graded);
        return m;
    }, [timelineData]);

    const taskPerformance = useMemo(() => {
        if (!tasks.length) return [];
        const taskAgg = new Map<string, { total: number; sum: number; passed: number }>();
        for (const s of graded) {
            const tArr = s.grade_display?.tasks || [];
            for (const ts of tArr) {
                const key = ts.assignment_task_uuid;
                const entry = taskAgg.get(key) || { total: 0, sum: 0, passed: 0 };
                entry.total += 1;
                entry.sum += Number(ts.grade) || 0;
                if (ts.passed) entry.passed += 1;
                taskAgg.set(key, entry);
            }
        }
        return tasks
            .map((task: any, idx: number) => {
                const agg = taskAgg.get(task.assignment_task_uuid) || { total: 0, sum: 0, passed: 0 };
                const avgGrade = agg.total ? agg.sum / agg.total : 0;
                const passRate = agg.total ? (agg.passed / agg.total) * 100 : 0;
                return {
                    uuid: task.assignment_task_uuid,
                    label: `#${idx + 1}`,
                    title: task.title || `Task ${idx + 1}`,
                    avg: Math.round(avgGrade * 10) / 10,
                    passRate: Math.round(passRate),
                    attempts: agg.total,
                };
            })
            .filter((t: any) => t.attempts > 0);
    }, [tasks, graded]);

    const rankedSubmissions = useMemo(() => {
        return [...graded]
            .map((s) => ({ s, pct: submissionPct(s) ?? 0 }))
            .sort((a, b) => b.pct - a.pct)
            .map((x) => x.s);
    }, [graded]);

    // Top performers: only students who actually passed. Avoids showing a
    // failing student as the "top" just because they're the sole graded
    // submission.
    const topPerformers = rankedSubmissions
        .filter((s) => s.grade_display?.passed)
        .slice(0, 5);
    const strugglingStudents = rankedSubmissions
        .filter((s) => !s.grade_display?.passed)
        .slice(-5)
        .reverse();

    const gradingType = assignmentObj?.grading_type as string | undefined;
    const avgFmt = formatGradeValue(stats.avg, gradingType);
    const medianFmt = formatGradeValue(stats.median, gradingType);
    const highestFmt = formatGradeValue(stats.highest, gradingType);
    const lowestFmt = formatGradeValue(stats.lowest, gradingType);

    const isLoading = !submissions;
    const isEmpty = !isLoading && submissions!.length === 0;
    const noGraded = !isLoading && stats.gradedCount === 0;

    if (isLoading) {
        return (
            <div className="flex flex-col w-full h-full custom-dots-bg">
                <div className="flex items-center justify-center h-full text-sm text-gray-400 font-medium">
                    {t('dashboard.assignments.analytics.loading')}
                </div>
            </div>
        );
    }

    if (isEmpty) {
        return (
            <div className="flex flex-col w-full h-full custom-dots-bg">
                <div className="flex flex-col items-center justify-center h-full text-gray-400 gap-3">
                    <div className="bg-gray-100 rounded-2xl p-4">
                        <BarChart3 size={28} />
                    </div>
                    <p className="text-sm font-semibold">{t('dashboard.assignments.analytics.empty.title')}</p>
                    <p className="text-xs text-gray-400 max-w-sm text-center">{t('dashboard.assignments.analytics.empty.description')}</p>
                </div>
            </div>
        );
    }

    return (
        <div className="flex flex-col w-full h-full custom-dots-bg overflow-y-auto">
            <div className="px-10 pt-6 pb-10 flex flex-col space-y-4">
                {/* KPI row */}
                <div className="grid grid-cols-4 gap-3">
                    <KpiCard
                        icon={<Target size={14} className="text-indigo-600" />}
                        iconBg="bg-indigo-50"
                        label={t('dashboard.assignments.analytics.kpis.average')}
                        value={noGraded ? '—' : avgFmt.primary}
                        sub={noGraded ? undefined : avgFmt.secondary}
                    />
                    <KpiCard
                        icon={<Minus size={14} className="text-sky-600" />}
                        iconBg="bg-sky-50"
                        label={t('dashboard.assignments.analytics.kpis.median')}
                        value={noGraded ? '—' : medianFmt.primary}
                        sub={noGraded ? undefined : medianFmt.secondary}
                    />
                    <KpiCard
                        icon={<Award size={14} className="text-emerald-600" />}
                        iconBg="bg-emerald-50"
                        label={t('dashboard.assignments.analytics.kpis.pass_rate')}
                        value={noGraded ? '—' : `${Math.round(stats.passRate)}%`}
                        sub={noGraded ? undefined : t('dashboard.assignments.analytics.kpis.pass_rate_sub', {
                            passed: stats.passedCount,
                            total: stats.gradedCount,
                        })}
                    />
                    <KpiCard
                        icon={<Clock size={14} className="text-amber-600" />}
                        iconBg="bg-amber-50"
                        label={t('dashboard.assignments.analytics.kpis.on_time')}
                        value={stats.total === 0 ? '—' : `${Math.round(stats.onTimeRate)}%`}
                        sub={stats.total === 0 ? undefined : t('dashboard.assignments.analytics.kpis.on_time_sub', {
                            late: stats.lateCount,
                            total: stats.total,
                        })}
                    />
                </div>

                {/* Secondary metrics strip */}
                <div className="grid grid-cols-4 gap-3">
                    <MiniStat
                        icon={<ChevronsUp size={12} />}
                        label={t('dashboard.assignments.analytics.mini.highest')}
                        value={noGraded ? '—' : formatMini(highestFmt)}
                        tone="emerald"
                    />
                    <MiniStat
                        icon={<TrendingUp size={12} className="rotate-180" />}
                        label={t('dashboard.assignments.analytics.mini.lowest')}
                        value={noGraded ? '—' : formatMini(lowestFmt)}
                        tone="rose"
                    />
                    <MiniStat
                        icon={<Activity size={12} />}
                        label={t('dashboard.assignments.analytics.mini.spread')}
                        value={noGraded ? '—' : `${Math.round(stats.spread)}%`}
                        tone="violet"
                    />
                    <MiniStat
                        icon={<MessagesSquare size={12} />}
                        label={t('dashboard.assignments.analytics.mini.feedback')}
                        value={noGraded ? '—' : `${Math.round(stats.feedbackRate)}%`}
                        tone="sky"
                    />
                </div>

                {/* Grade distribution + Submission timeline */}
                <div className="grid grid-cols-2 gap-3">
                    <ChartCard
                        icon={<BarChart3 size={14} />}
                        title={t('dashboard.assignments.analytics.distribution.title')}
                        subtitle={t('dashboard.assignments.analytics.distribution.subtitle')}
                    >
                        {noGraded ? (
                            <EmptyChart message={t('dashboard.assignments.analytics.distribution.empty')} />
                        ) : (
                            <ResponsiveContainer width="100%" height={240}>
                                <BarChart data={distributionData} margin={{ top: 10, right: 10, bottom: 0, left: -20 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
                                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                                    <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} allowDecimals={false} />
                                    <Tooltip
                                        cursor={{ fill: '#f9fafb' }}
                                        contentStyle={{ fontSize: 12, borderRadius: 8, border: 'none', boxShadow: '0 2px 10px rgba(0,0,0,0.08)' }}
                                        formatter={(value: any) => [value, t('dashboard.assignments.analytics.distribution.students')]}
                                        labelFormatter={(label: any) => {
                                            const b = GRADE_BUCKETS.find((x) => x.label === label);
                                            return b ? `${label} · ${b.min}–${b.max}` : label;
                                        }}
                                    />
                                    <Bar dataKey="count" radius={[6, 6, 0, 0]}>
                                        {distributionData.map((entry, index) => (
                                            <Cell key={`c-${index}`} fill={entry.color} />
                                        ))}
                                    </Bar>
                                </BarChart>
                            </ResponsiveContainer>
                        )}
                    </ChartCard>

                    <ChartCard
                        icon={<LineChartIcon size={14} />}
                        title={t('dashboard.assignments.analytics.timeline.title')}
                        subtitle={t('dashboard.assignments.analytics.timeline.subtitle')}
                    >
                        {timelineData.length === 0 ? (
                            <EmptyChart message={t('dashboard.assignments.analytics.timeline.empty')} />
                        ) : (
                            <ResponsiveContainer width="100%" height={240}>
                                <AreaChart data={timelineData} margin={{ top: 10, right: 10, bottom: 0, left: -20 }}>
                                    <defs>
                                        <linearGradient id="submittedGrad" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="0%" stopColor="#6366f1" stopOpacity={0.35} />
                                            <stop offset="100%" stopColor="#6366f1" stopOpacity={0} />
                                        </linearGradient>
                                        <linearGradient id="gradedGrad" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="0%" stopColor="#10b981" stopOpacity={0.3} />
                                            <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
                                    <XAxis
                                        dataKey="date"
                                        tick={{ fontSize: 10, fill: '#9ca3af' }}
                                        axisLine={false}
                                        tickLine={false}
                                        tickFormatter={(v) => {
                                            const d = new Date(v);
                                            return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
                                        }}
                                    />
                                    <YAxis
                                        tick={{ fontSize: 11, fill: '#9ca3af' }}
                                        axisLine={false}
                                        tickLine={false}
                                        allowDecimals={false}
                                        domain={[0, (max: number) => Math.max(2, max + 1)]}
                                        tickCount={Math.min(5, Math.max(3, timelineMax + 2))}
                                    />
                                    <Tooltip
                                        contentStyle={{ fontSize: 12, borderRadius: 8, border: 'none', boxShadow: '0 2px 10px rgba(0,0,0,0.08)' }}
                                        labelFormatter={(v: any) => new Date(v).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
                                    />
                                    {assignmentObj?.due_date && (
                                        <ReferenceLine
                                            x={dateKey(assignmentObj.due_date)}
                                            stroke="#ef4444"
                                            strokeDasharray="4 4"
                                            label={{ value: t('dashboard.assignments.analytics.timeline.due'), fontSize: 10, fill: '#ef4444', position: 'insideTopRight' }}
                                        />
                                    )}
                                    <Area
                                        type="monotone"
                                        dataKey="submitted"
                                        stroke="#6366f1"
                                        strokeWidth={2}
                                        fill="url(#submittedGrad)"
                                        name={t('dashboard.assignments.analytics.timeline.submitted')}
                                        dot={{ r: 3, strokeWidth: 0, fill: '#6366f1' }}
                                    />
                                    <Area
                                        type="monotone"
                                        dataKey="graded"
                                        stroke="#10b981"
                                        strokeWidth={2}
                                        fill="url(#gradedGrad)"
                                        name={t('dashboard.assignments.analytics.timeline.graded')}
                                        dot={{ r: 3, strokeWidth: 0, fill: '#10b981' }}
                                    />
                                </AreaChart>
                            </ResponsiveContainer>
                        )}
                    </ChartCard>
                </div>

                {/* Task difficulty */}
                <ChartCard
                    icon={<Flame size={14} />}
                    title={t('dashboard.assignments.analytics.tasks.title')}
                    subtitle={t('dashboard.assignments.analytics.tasks.subtitle')}
                >
                    {taskPerformance.length === 0 ? (
                        <EmptyChart message={t('dashboard.assignments.analytics.tasks.empty')} />
                    ) : (
                        <div className="flex flex-col">
                            <ResponsiveContainer width="100%" height={Math.max(180, taskPerformance.length * 42)}>
                                <BarChart
                                    layout="vertical"
                                    data={taskPerformance}
                                    margin={{ top: 10, right: 30, bottom: 10, left: 10 }}
                                >
                                    <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" horizontal={false} />
                                    <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                                    <YAxis
                                        type="category"
                                        dataKey="label"
                                        tick={{ fontSize: 12, fill: '#4b5563', fontWeight: 600 }}
                                        axisLine={false}
                                        tickLine={false}
                                        width={40}
                                    />
                                    <Tooltip
                                        cursor={{ fill: '#f9fafb' }}
                                        contentStyle={{ fontSize: 12, borderRadius: 8, border: 'none', boxShadow: '0 2px 10px rgba(0,0,0,0.08)' }}
                                        formatter={(value: any, name: any, props: any) => {
                                            if (name === 'avg') return [`${value} / 100`, t('dashboard.assignments.analytics.tasks.avg_grade')];
                                            return [value, name];
                                        }}
                                        labelFormatter={(label: any, payload: any) => {
                                            const item = payload?.[0]?.payload;
                                            return item?.title || label;
                                        }}
                                    />
                                    <Bar dataKey="avg" radius={[0, 6, 6, 0]}>
                                        {taskPerformance.map((t, idx) => (
                                            <Cell key={`tc-${idx}`} fill={gradeColor(t.avg)} />
                                        ))}
                                    </Bar>
                                </BarChart>
                            </ResponsiveContainer>
                            <div className="flex flex-wrap gap-x-4 gap-y-1 px-3 pt-2 text-[10px] text-gray-400 font-medium">
                                {taskPerformance.map((task) => (
                                    <div key={task.uuid} className="flex items-center space-x-1">
                                        <span className="font-bold text-gray-500">{task.label}</span>
                                        <span className="truncate max-w-[220px]">{task.title}</span>
                                        <span className="text-gray-300">·</span>
                                        <span>{task.attempts} {t('dashboard.assignments.analytics.tasks.attempts')}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </ChartCard>

                {/* Top performers + Needs attention */}
                <div className="grid grid-cols-2 gap-3">
                    <ChartCard
                        icon={<Trophy size={14} />}
                        title={t('dashboard.assignments.analytics.top.title')}
                        subtitle={t('dashboard.assignments.analytics.top.subtitle')}
                    >
                        {topPerformers.length === 0 ? (
                            <EmptyChart message={t('dashboard.assignments.analytics.top.empty')} />
                        ) : (
                            <div className="flex flex-col divide-y divide-gray-100">
                                {topPerformers.map((s, idx) => (
                                    <PerformerRow
                                        key={s.assignmentusersubmission_uuid}
                                        submission={s}
                                        rank={idx + 1}
                                        tone="positive"
                                        access_token={access_token}
                                    />
                                ))}
                            </div>
                        )}
                    </ChartCard>

                    <ChartCard
                        icon={<Sparkles size={14} />}
                        title={t('dashboard.assignments.analytics.attention.title')}
                        subtitle={t('dashboard.assignments.analytics.attention.subtitle')}
                    >
                        {strugglingStudents.length === 0 ? (
                            <div className="flex items-center justify-center h-40 text-xs text-gray-400 font-medium flex-col gap-2">
                                <CheckCircle2 size={20} className="text-emerald-400" />
                                <span>{t('dashboard.assignments.analytics.attention.empty')}</span>
                            </div>
                        ) : (
                            <div className="flex flex-col divide-y divide-gray-100">
                                {strugglingStudents.map((s) => (
                                    <PerformerRow
                                        key={s.assignmentusersubmission_uuid}
                                        submission={s}
                                        tone="warning"
                                        access_token={access_token}
                                    />
                                ))}
                            </div>
                        )}
                    </ChartCard>
                </div>
            </div>
        </div>
    );
}

function KpiCard({
    icon,
    iconBg,
    label,
    value,
    sub,
    hint,
}: {
    icon: React.ReactNode;
    iconBg: string;
    label: string;
    value: string | number;
    sub?: string;
    hint?: string;
}) {
    return (
        <div className="bg-white nice-shadow rounded-xl px-4 py-3.5 flex flex-col space-y-2">
            <div className="flex items-center justify-between">
                <div className={`${iconBg} rounded-lg p-1.5`}>{icon}</div>
                {hint && (
                    <span className="text-[9px] uppercase tracking-wider font-semibold text-gray-300">
                        {hint}
                    </span>
                )}
            </div>
            <div>
                <p className="text-[10px] uppercase tracking-wide font-semibold text-gray-400">{label}</p>
                <p className="text-2xl font-bold text-gray-900 leading-tight">{value}</p>
                {sub && <p className="text-[11px] text-gray-400 font-medium -mt-0.5">{sub}</p>}
            </div>
        </div>
    );
}

const TONE_STYLES: Record<string, { bg: string; text: string; ring: string }> = {
    emerald: { bg: 'bg-emerald-50', text: 'text-emerald-700', ring: 'ring-emerald-200/50' },
    rose: { bg: 'bg-rose-50', text: 'text-rose-700', ring: 'ring-rose-200/50' },
    violet: { bg: 'bg-violet-50', text: 'text-violet-700', ring: 'ring-violet-200/50' },
    sky: { bg: 'bg-sky-50', text: 'text-sky-700', ring: 'ring-sky-200/50' },
};

function MiniStat({
    icon,
    label,
    value,
    tone,
}: {
    icon: React.ReactNode;
    label: string;
    value: string;
    tone: keyof typeof TONE_STYLES;
}) {
    const style = TONE_STYLES[tone];
    return (
        <div className={`bg-white nice-shadow rounded-xl px-3 py-2.5 flex items-center gap-2.5`}>
            <div className={`${style.bg} ${style.text} rounded-md p-1.5 ring-1 ring-inset ${style.ring}`}>
                {icon}
            </div>
            <div className="flex-1 min-w-0">
                <p className="text-[10px] uppercase tracking-wide font-semibold text-gray-400 truncate">{label}</p>
                <p className="text-sm font-bold text-gray-900 -mt-0.5 truncate">{value}</p>
            </div>
        </div>
    );
}

function ChartCard({
    icon,
    title,
    subtitle,
    children,
}: {
    icon: React.ReactNode;
    title: string;
    subtitle?: string;
    children: React.ReactNode;
}) {
    return (
        <div className="bg-white nice-shadow rounded-xl p-4 flex flex-col">
            <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2">
                    <div className="bg-gray-100 rounded-md p-1.5 text-gray-600">{icon}</div>
                    <div className="flex flex-col">
                        <h3 className="text-sm font-bold text-gray-800 leading-tight">{title}</h3>
                        {subtitle && <p className="text-[11px] text-gray-400 font-medium">{subtitle}</p>}
                    </div>
                </div>
            </div>
            {children}
        </div>
    );
}

function EmptyChart({ message }: { message: string }) {
    return (
        <div className="flex items-center justify-center h-40 text-xs text-gray-400 font-medium">
            {message}
        </div>
    );
}

function PerformerRow({
    submission,
    rank,
    tone,
    access_token,
}: {
    submission: Submission;
    rank?: number;
    tone: 'positive' | 'warning';
    access_token: string;
}) {
    const { data: user } = useSWR(
        `${getAPIUrl()}users/id/${submission.user_id}`,
        (url) => swrFetcher(url, access_token),
        { revalidateOnFocus: false, dedupingInterval: 30000 }
    );

    const gradeText = submission.grade_display?.display_grade ?? `${submission.grade}`;
    const points = submission.grade_display?.points_summary;
    const passed = submission.grade_display?.passed;

    const displayName = user?.first_name && user?.last_name
        ? `${user.first_name} ${user.last_name}`
        : user?.username ? `@${user.username}` : '...';

    return (
        <div className="flex items-center px-1 py-2.5 gap-3">
            {rank !== undefined && (
                <RankBadge rank={rank} />
            )}
            <UserAvatar
                border="border-2"
                avatar_url={getUserAvatarMediaDirectory(user?.user_uuid, user?.avatar_image)}
                predefined_avatar={user?.avatar_image ? undefined : 'empty'}
                width={30}
            />
            <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-900 truncate">{displayName}</p>
                {user?.email && <p className="text-[11px] text-gray-400 truncate">{user.email}</p>}
            </div>
            <div className="flex flex-col items-end">
                <span className={`text-sm font-bold ${passed ? 'text-emerald-700' : 'text-rose-700'}`}>
                    {gradeText}
                </span>
                {points && <span className="text-[10px] text-gray-400 font-medium">{points}</span>}
            </div>
        </div>
    );
}

function RankBadge({ rank }: { rank: number }) {
    const palette: Record<number, { bg: string; text: string; icon?: React.ReactNode }> = {
        1: { bg: 'bg-amber-100', text: 'text-amber-700', icon: <Medal size={11} /> },
        2: { bg: 'bg-slate-100', text: 'text-slate-600', icon: <Medal size={11} /> },
        3: { bg: 'bg-orange-100', text: 'text-orange-700', icon: <Medal size={11} /> },
    };
    const style = palette[rank] || { bg: 'bg-gray-100', text: 'text-gray-500' };
    return (
        <div className={`${style.bg} ${style.text} w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0`}>
            {style.icon ? style.icon : `#${rank}`}
        </div>
    );
}

function dateKey(iso: string): string {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function gradeColor(pct: number): string {
    if (pct >= 90) return '#059669';
    if (pct >= 80) return '#10b981';
    if (pct >= 70) return '#f59e0b';
    if (pct >= 60) return '#f97316';
    return '#e11d48';
}

// Extract a 0–100 percentage from a submission. The raw `grade` field is a
// points sum (e.g. 267 of 500), so we prefer the server-computed
// `percentage_display` or derive it from `points_summary`.
function submissionPct(s: Submission): number | null {
    const pd = s.grade_display?.percentage_display;
    if (pd) {
        const m = pd.match(/(\d+(?:\.\d+)?)/);
        if (m) return parseFloat(m[1]);
    }
    const ps = s.grade_display?.points_summary;
    if (ps) {
        const m = ps.match(/^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/);
        if (m) {
            const pts = parseFloat(m[1]);
            const max = parseFloat(m[2]);
            if (max > 0) return (pts / max) * 100;
        }
    }
    // Last resort: treat `grade` as already a percentage when it plausibly is.
    const g = Number(s.grade);
    if (!isNaN(g) && g >= 0 && g <= 100) return g;
    return null;
}

function pctToLetter(pct: number): string {
    if (pct >= 90) return 'A';
    if (pct >= 80) return 'B';
    if (pct >= 70) return 'C';
    if (pct >= 60) return 'D';
    return 'F';
}

function pctToGpa(pct: number): string {
    const gpa = Math.max(0, Math.min(4, (pct / 100) * 4));
    return gpa.toFixed(2);
}

// Format a percentage value (0–100) for display according to the assignment's
// grading type. Returns a prominent primary string + optional secondary
// (e.g. for ALPHABET we show the letter and a "53%" subtitle).
function formatGradeValue(pct: number, gradingType?: string): { primary: string; secondary?: string } {
    if (pct === null || pct === undefined || isNaN(pct)) return { primary: '—' };
    const rounded = Math.round(pct);
    switch (gradingType) {
        case 'ALPHABET':
            return { primary: pctToLetter(pct), secondary: `${rounded}%` };
        case 'PERCENTAGE':
            return { primary: `${rounded}%` };
        case 'PASS_FAIL':
            return { primary: pct >= 60 ? 'Pass' : 'Fail', secondary: `${rounded}%` };
        case 'GPA_SCALE':
            return { primary: pctToGpa(pct), secondary: `${rounded}%` };
        case 'NUMERIC':
        default:
            return { primary: `${rounded}`, secondary: '/ 100' };
    }
}

// Single-line variant used inside MiniStat where we only have one slot.
function formatMini(v: { primary: string; secondary?: string }): string {
    return v.secondary ? `${v.primary} · ${v.secondary}` : v.primary;
}

export default AssignmentAnalyticsSubPage;
