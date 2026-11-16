'use client'
import React from 'react'
import { CreditCost } from '@components/Objects/AI/CreditCost'
import toast from 'react-hot-toast'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import {
    ArrowClockwise,
    Check,
    Coins,
    FileText,
    FilmStrip,
    ImageSquare,
    PencilSimple,
    Trash,
    Warning,
    Waveform,
} from '@phosphor-icons/react'
import { AIButton, AIChip, AISurfaceHeader, AIThinking, aiSurface } from '@components/Objects/AI/AIBrand'
import { Button, ConfirmDialog, TEXTAREA } from '@components/Dashboard/Shared/DashKit/DashKit'
import { queryKeys } from '@/lib/query/keys'
import {
    acceptAIGrade,
    bulkAIGrade,
    discardAIGrade,
    estimateAIGrading,
    getAIGrade,
    runAIGrade,
    type AIBulkResult,
    type AIGrade,
    type AIGradingEstimate,
} from '@services/courses/assignments'
import { aiGradingEnabled, aiGradingModeOf } from '@/lib/assignments/aiGrading'

export { aiGradingEnabled, aiGradingModeOf } from '@/lib/assignments/aiGrading'
export type { AIGradingMode } from '@/lib/assignments/aiGrading'

function errorText(res: any, fallback: string): string {
    const detail = res?.data?.detail
    if (typeof detail === 'string') return detail
    if (detail && typeof detail.message === 'string') return detail.message
    return fallback
}

const SOURCE_ICON: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
    video: FilmStrip,
    audio: Waveform,
    image: ImageSquare,
}

const CONFIDENCE_TONE: Record<string, string> = {
    high: 'bg-emerald-50 text-emerald-700',
    medium: 'bg-amber-50 text-amber-700',
    low: 'bg-rose-50 text-rose-700',
}

// ─── Evaluate rail panel ─────────────────────────────────────────────────────

/**
 * AI grading for one submission, in the evaluate dialog's rail: run it, then
 * Accept / Edit / Discard the draft. Accepting writes the grade through the
 * API (same path as a manual grade) and calls `onApplied` so the dialog
 * reloads the scores it shows.
 */
export function AIGradePanel({
    userId,
    assignment,
    accessToken,
    submissionStatus,
    onApplied,
}: {
    userId: string | number
    assignment: any
    accessToken: string
    submissionStatus?: string
    onApplied: () => void
}) {
    const { t } = useTranslation()
    const queryClient = useQueryClient()
    const assignmentUuid: string = assignment?.assignment_uuid
    const mode = aiGradingModeOf(assignment)
    const [grade, setGrade] = React.useState<AIGrade | null>(null)
    const [loaded, setLoaded] = React.useState(false)
    const [estimate, setEstimate] = React.useState<number | null>(null)
    const [running, setRunning] = React.useState(false)
    const [busy, setBusy] = React.useState<'accept' | 'discard' | null>(null)
    const [editing, setEditing] = React.useState(false)
    const [scores, setScores] = React.useState<Record<string, string>>({})
    const [feedbacks, setFeedbacks] = React.useState<Record<string, string>>({})
    const [overall, setOverall] = React.useState('')
    const [discardOpen, setDiscardOpen] = React.useState(false)

    React.useEffect(() => {
        if (!assignmentUuid || !accessToken) return
        let cancelled = false
        ;(async () => {
            const [gradeRes, estimateRes] = await Promise.all([
                getAIGrade(userId, assignmentUuid, accessToken),
                estimateAIGrading(assignmentUuid, accessToken, userId),
            ])
            if (cancelled) return
            setGrade(gradeRes.success ? gradeRes.data : null)
            if (estimateRes.success && typeof estimateRes.data?.credits === 'number') setEstimate(estimateRes.data.credits)
            setLoaded(true)
        })()
        return () => {
            cancelled = true
        }
    }, [userId, assignmentUuid, accessToken])

    const invalidateLists = () => {
        const rawUuid = assignmentUuid?.replace('assignment_', '') ?? ''
        queryClient.invalidateQueries({ queryKey: queryKeys.assignments.allSubmissions(rawUuid) })
        queryClient.invalidateQueries({ queryKey: queryKeys.assignments.analytics(rawUuid) })
    }

    const startEditing = (g: AIGrade) => {
        setScores(Object.fromEntries(g.tasks.map((task) => [task.assignment_task_uuid, String(task.score)])))
        setFeedbacks(Object.fromEntries(g.tasks.map((task) => [task.assignment_task_uuid, task.feedback || ''])))
        setOverall(g.overall_feedback || '')
        setEditing(true)
    }

    const run = async () => {
        setRunning(true)
        setEditing(false)
        try {
            const res = await runAIGrade(userId, assignmentUuid, accessToken)
            if (!res.success) {
                toast.error(errorText(res, t('dashboard.assignments.ai_grading.panel.run_error')))
                const again = await getAIGrade(userId, assignmentUuid, accessToken)
                if (again.success) setGrade(again.data)
                return
            }
            setGrade(res.data)
            invalidateLists()
            if (res.data?.status === 'APPLIED') {
                toast.success(t('dashboard.assignments.ai_grading.panel.applied_toast'))
                onApplied()
            } else {
                toast.success(t('dashboard.assignments.ai_grading.panel.draft_toast'))
            }
        } finally {
            setRunning(false)
        }
    }

    const accept = async () => {
        if (!grade) return
        setBusy('accept')
        try {
            const edits = editing
                ? {
                    overall_feedback: overall,
                    tasks: grade.tasks.map((task) => ({
                        assignment_task_uuid: task.assignment_task_uuid,
                        feedback: feedbacks[task.assignment_task_uuid] ?? task.feedback,
                        ...(task.scored_by === 'ai' && scores[task.assignment_task_uuid] !== ''
                            ? { score: Number(scores[task.assignment_task_uuid]) }
                            : {}),
                    })),
                }
                : null
            const res = await acceptAIGrade(userId, assignmentUuid, accessToken, edits)
            if (!res.success) {
                toast.error(errorText(res, t('common.something_went_wrong')))
                return
            }
            setGrade(res.data?.ai_grade ?? { ...grade, status: 'APPLIED' })
            setEditing(false)
            toast.success(t('dashboard.assignments.ai_grading.panel.accepted_toast', { grade: res.data?.display_grade ?? '' }))
            invalidateLists()
            onApplied()
        } finally {
            setBusy(null)
        }
    }

    const discard = async () => {
        setBusy('discard')
        try {
            const res = await discardAIGrade(userId, assignmentUuid, accessToken)
            if (!res.success) {
                toast.error(errorText(res, t('common.something_went_wrong')))
                return
            }
            setGrade(null)
            setEditing(false)
            invalidateLists()
        } finally {
            setBusy(null)
        }
    }

    const handedIn = submissionStatus === undefined || ['SUBMITTED', 'LATE', 'GRADED'].includes(submissionStatus)
    const status = grade?.status
    const showResult = !!grade && (status === 'DRAFT' || status === 'APPLIED')
    const description = running
        ? t('dashboard.assignments.ai_grading.panel.running_description')
        : status === 'DRAFT'
            ? t('dashboard.assignments.ai_grading.panel.draft_description')
            : status === 'APPLIED'
                ? t('dashboard.assignments.ai_grading.panel.applied_description')
                : mode === 'AUTO' && submissionStatus !== 'GRADED'
                    ? t('dashboard.assignments.ai_grading.panel.auto_description')
                    : t('dashboard.assignments.ai_grading.panel.suggest_description')

    return (
        // shrink-0: the rail is a scrolling flex column, and an overflow-hidden
        // child would otherwise be squeezed to nothing.
        <section className={`${aiSurface.panel} shrink-0`} aria-label={t('dashboard.assignments.ai_grading.panel.title')}>
            <AISurfaceHeader
                title={t('dashboard.assignments.ai_grading.panel.title')}
                description={description}
                actions={
                    status === 'APPLIED' ? (
                        <AIChip tone='soft'>{t('dashboard.assignments.ai_grading.panel.applied_chip')}</AIChip>
                    ) : status === 'DRAFT' ? (
                        <AIChip tone='soft'>{t('dashboard.assignments.ai_grading.panel.draft_chip')}</AIChip>
                    ) : undefined
                }
            />
            <div className='flex flex-col gap-3 p-4'>
                {!loaded ? (
                    <AIThinking label={t('dashboard.assignments.ai_grading.panel.loading')} />
                ) : running ? (
                    <div className={`${aiSurface.tint} p-3 flex flex-col gap-1.5`}>
                        <AIThinking label={t('dashboard.assignments.ai_grading.panel.running')} />
                        <p className='text-xs text-neutral-500'>{t('dashboard.assignments.ai_grading.panel.running_hint')}</p>
                    </div>
                ) : showResult && grade ? (
                    <>
                        <ul className='flex flex-col gap-2'>
                            {grade.tasks.map((task) => (
                                <li key={task.assignment_task_uuid} className='rounded-xl bg-neutral-50 p-3'>
                                    <div className='flex items-center justify-between gap-2'>
                                        <span className='min-w-0 truncate text-xs font-semibold text-neutral-800'>{task.title}</span>
                                        {editing && task.scored_by === 'ai' ? (
                                            <span className='flex items-center gap-1 shrink-0'>
                                                <input
                                                    type='number'
                                                    min={0}
                                                    max={task.max_score}
                                                    value={scores[task.assignment_task_uuid] ?? ''}
                                                    onChange={(e) => setScores((prev) => ({ ...prev, [task.assignment_task_uuid]: e.target.value }))}
                                                    aria-label={t('dashboard.assignments.ai_grading.panel.score_label', { title: task.title })}
                                                    className='h-7 w-16 rounded-md bg-white text-center text-xs font-semibold tabular-nums ring-1 ring-inset ring-neutral-200 focus:outline-none focus:ring-2 focus:ring-violet-500/30'
                                                />
                                                <span className='text-xs text-neutral-400 tabular-nums'>/ {task.max_score}</span>
                                            </span>
                                        ) : (
                                            <span className='shrink-0 text-xs font-bold text-neutral-900 tabular-nums'>
                                                {task.score}/{task.max_score}
                                            </span>
                                        )}
                                    </div>
                                    {task.scored_by === 'checker' && (
                                        <p className='mt-0.5 text-[11px] text-neutral-400'>{t('dashboard.assignments.ai_grading.panel.checker_scored')}</p>
                                    )}
                                    {editing ? (
                                        <textarea
                                            rows={3}
                                            value={feedbacks[task.assignment_task_uuid] ?? ''}
                                            onChange={(e) => setFeedbacks((prev) => ({ ...prev, [task.assignment_task_uuid]: e.target.value }))}
                                            aria-label={t('dashboard.assignments.ai_grading.panel.feedback_label', { title: task.title })}
                                            className={`${TEXTAREA} mt-2 text-xs`}
                                        />
                                    ) : (
                                        task.feedback && <p className='mt-1 text-xs text-neutral-600 leading-relaxed'>{task.feedback}</p>
                                    )}
                                </li>
                            ))}
                        </ul>
                        <div>
                            <p className='text-xs font-semibold text-neutral-800'>{t('dashboard.assignments.ai_grading.panel.overall')}</p>
                            {editing ? (
                                <textarea rows={4} value={overall} onChange={(e) => setOverall(e.target.value)} className={`${TEXTAREA} mt-1.5 text-xs`} />
                            ) : (
                                <p className='mt-1 text-xs text-neutral-600 leading-relaxed'>{grade.overall_feedback}</p>
                            )}
                        </div>
                        {(grade.confidence || grade.notes) && (
                            <div className={`${aiSurface.tint} p-3 flex flex-col gap-1`}>
                                {grade.confidence && (
                                    <span className={`self-start rounded-full px-2 py-0.5 text-[11px] font-semibold ${CONFIDENCE_TONE[grade.confidence] ?? ''}`}>
                                        {t(`dashboard.assignments.ai_grading.panel.confidence.${grade.confidence}`)}
                                    </span>
                                )}
                                {grade.notes && <p className='text-xs text-neutral-700'>{grade.notes}</p>}
                            </div>
                        )}
                        <SourcesList sources={grade.sources} />
                        <p className='flex items-center gap-1 text-[11px] text-neutral-400'>
                            <Coins size={12} />
                            {t('dashboard.assignments.ai_grading.panel.credits_used', { count: grade.credits_charged })}
                        </p>
                        {status === 'DRAFT' ? (
                            <div className='flex flex-wrap gap-2'>
                                <Button variant='primary' size='sm' icon={<Check size={13} weight='bold' />} loading={busy === 'accept'} disabled={!!busy} onClick={accept}>
                                    {editing ? t('dashboard.assignments.ai_grading.panel.apply_edits') : t('dashboard.assignments.ai_grading.panel.accept')}
                                </Button>
                                {editing ? (
                                    <Button size='sm' disabled={!!busy} onClick={() => setEditing(false)}>
                                        {t('common.cancel')}
                                    </Button>
                                ) : (
                                    <Button size='sm' icon={<PencilSimple size={13} />} disabled={!!busy} onClick={() => startEditing(grade)}>
                                        {t('dashboard.assignments.ai_grading.panel.edit')}
                                    </Button>
                                )}
                                <Button variant='danger-ghost' size='sm' icon={<Trash size={13} />} disabled={!!busy} onClick={() => setDiscardOpen(true)}>
                                    {t('dashboard.assignments.ai_grading.panel.discard')}
                                </Button>
                            </div>
                        ) : (
                            <AIButton variant='outline' size='sm' icon={<ArrowClockwise size={14} />} onClick={run} disabled={!handedIn}>
                                {t('dashboard.assignments.ai_grading.panel.regrade')}
                            </AIButton>
                        )}
                    </>
                ) : (
                    <>
                        {status === 'FAILED' && grade?.error && (
                            <p className='flex items-start gap-1.5 rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700'>
                                <Warning size={14} className='shrink-0 mt-px' />
                                {grade.error}
                            </p>
                        )}
                        <AIButton variant='solid' size='md' onClick={run} disabled={!handedIn} className='w-full'>
                            {t('dashboard.assignments.ai_grading.panel.run')}
                        </AIButton>
                        {estimate !== null && (
                            <p className='flex items-center justify-center gap-1 text-[11px] text-neutral-500'>
                                <Coins size={12} />
                                {t('dashboard.assignments.ai_grading.panel.estimate', { count: estimate })}
                            </p>
                        )}
                    </>
                )}
            </div>
            <ConfirmDialog
                open={discardOpen}
                onOpenChange={setDiscardOpen}
                title={t('dashboard.assignments.ai_grading.panel.discard')}
                message={t('dashboard.assignments.ai_grading.panel.discard_confirm')}
                confirmLabel={t('dashboard.assignments.ai_grading.panel.discard')}
                onConfirm={discard}
            />
        </section>
    )
}

function SourcesList({ sources }: { sources: Record<string, any>[] }) {
    const { t } = useTranslation()
    if (!sources?.length) return null
    return (
        <details className='group rounded-xl bg-neutral-50 px-3 py-2'>
            <summary className='cursor-pointer text-xs font-semibold text-neutral-700 select-none'>
                {t('dashboard.assignments.ai_grading.panel.sources', { count: sources.length })}
            </summary>
            <ul className='mt-2 flex flex-col gap-2'>
                {sources.map((source, index) => {
                    const Icon = SOURCE_ICON[source.kind] ?? FileText
                    const seconds = typeof source.duration_seconds === 'number' ? Math.round(source.duration_seconds) : null
                    const duration = seconds !== null ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` : null
                    return (
                        <li key={index} className='text-xs text-neutral-600'>
                            <span className='flex items-center gap-1.5 font-medium text-neutral-800'>
                                <Icon size={13} className='shrink-0 text-neutral-400' />
                                <span className='uppercase text-[10px] tracking-wide text-neutral-500'>{source.kind}</span>
                                {duration && <span className='tabular-nums text-neutral-500'>{duration}</span>}
                                {source.pages ? <span className='tabular-nums text-neutral-500'>{t('dashboard.assignments.ai_grading.panel.pages', { count: source.pages })}</span> : null}
                            </span>
                            {source.transcript_excerpt && (
                                <p className='mt-1 whitespace-pre-line rounded-lg bg-white px-2 py-1.5 text-[11px] leading-relaxed text-neutral-600 ring-1 ring-inset ring-neutral-100'>
                                    {source.transcript_excerpt}
                                </p>
                            )}
                            {source.note && <p className='mt-0.5 text-[11px] text-amber-700'>{source.note}</p>}
                        </li>
                    )
                })}
            </ul>
        </details>
    )
}

// ─── Bulk grading (submissions list) ─────────────────────────────────────────

/**
 * "Grade all ungraded with AI": shows the credit estimate first, then grades
 * batch by batch (the API grades a few per request and reserves credits per
 * submission), and stops cleanly when credits run out.
 */
export function BulkAIGradeButton({
    assignment,
    accessToken,
    rawAssignmentUuid,
}: {
    assignment: any
    accessToken: string
    rawAssignmentUuid: string
}) {
    const { t } = useTranslation()
    const queryClient = useQueryClient()
    const assignmentUuid = 'assignment_' + rawAssignmentUuid
    const [estimate, setEstimate] = React.useState<AIGradingEstimate | null>(null)
    const [estimating, setEstimating] = React.useState(false)
    const [open, setOpen] = React.useState(false)
    const [progress, setProgress] = React.useState<{ done: number; total: number } | null>(null)
    const mode = aiGradingModeOf(assignment)

    const openConfirm = async () => {
        setEstimating(true)
        try {
            const res = await estimateAIGrading(assignmentUuid, accessToken)
            if (!res.success) {
                toast.error(errorText(res, t('common.something_went_wrong')))
                return
            }
            if (!res.data?.submissions) {
                toast(t('dashboard.assignments.ai_grading.bulk.nothing_to_grade'))
                return
            }
            setEstimate(res.data)
            setOpen(true)
        } finally {
            setEstimating(false)
        }
    }

    const runAll = async () => {
        const total = estimate?.submissions ?? 0
        const totals = { graded: 0, drafted: 0, failed: 0, credits: 0 }
        let stopped: AIBulkResult['stopped'] = null
        let stopDetail: string | null = null
        setProgress({ done: 0, total })
        // Batches until nothing is left, a stop condition, or a batch that
        // made no progress (every submission in it failed).
        for (let guard = 0; guard < 200; guard++) {
            const res = await bulkAIGrade(assignmentUuid, accessToken)
            if (!res.success) {
                stopDetail = errorText(res, t('common.something_went_wrong'))
                break
            }
            const batch: AIBulkResult = res.data
            totals.graded += batch.graded
            totals.drafted += batch.drafted
            totals.failed += batch.failed
            totals.credits += batch.credits_used
            setProgress({ done: totals.graded + totals.drafted + totals.failed, total })
            queryClient.invalidateQueries({ queryKey: queryKeys.assignments.allSubmissions(rawAssignmentUuid) })
            if (batch.stopped) {
                stopped = batch.stopped
                stopDetail = batch.stop_detail
                break
            }
            if (batch.remaining === 0 || batch.graded + batch.drafted === 0) break
        }
        setProgress(null)
        const summary = t('dashboard.assignments.ai_grading.bulk.summary', {
            graded: totals.graded,
            drafted: totals.drafted,
            failed: totals.failed,
            credits: totals.credits,
        })
        queryClient.invalidateQueries({ queryKey: ['org'] , predicate: (q) => q.queryKey[2] === 'ai-credits' })
        if (stopped === 'no_credits') toast.error(`${t('dashboard.assignments.ai_grading.bulk.stopped_credits')} ${summary}`, { duration: 8000 })
        else if (stopped === 'rate_limited') toast(`${t('dashboard.assignments.ai_grading.bulk.stopped_rate')} ${summary}`, { duration: 8000 })
        else if (stopDetail) toast.error(stopDetail)
        else toast.success(summary, { duration: 6000 })
        queryClient.invalidateQueries({ queryKey: queryKeys.assignments.analytics(rawAssignmentUuid) })
    }

    if (!aiGradingEnabled(assignment)) return null

    const remaining = estimate?.remaining_credits
    return (
        <>
            {progress ? (
                <div className={`${aiSurface.tint} flex items-center gap-3 px-3 h-8`} role='status'>
                    <AIThinking
                        label={t('dashboard.assignments.ai_grading.bulk.progress', { done: progress.done, total: progress.total })}
                    />
                </div>
            ) : (
                <AIButton variant='soft' size='md' loading={estimating} onClick={openConfirm}>
                    {t('dashboard.assignments.ai_grading.bulk.button')}
                </AIButton>
            )}
            <ConfirmDialog
                open={open}
                onOpenChange={setOpen}
                tone='info'
                title={t('dashboard.assignments.ai_grading.bulk.confirm_title')}
                confirmLabel={t('dashboard.assignments.ai_grading.bulk.confirm')}
                onConfirm={() => {
                    // Close the dialog at once; progress shows in the toolbar.
                    void runAll()
                }}
                message={
                    estimate ? (
                        <span className='flex flex-col gap-2'>
                            <span>
                                {t('dashboard.assignments.ai_grading.bulk.confirm_message', {
                                    count: estimate.submissions,
                                    credits: estimate.credits,
                                })}
                            </span>
                            <CreditCost credits={estimate.credits} total />
                            <span>
                                {mode === 'AUTO'
                                    ? t('dashboard.assignments.ai_grading.bulk.mode_auto')
                                    : t('dashboard.assignments.ai_grading.bulk.mode_suggest')}
                            </span>
                            {typeof remaining === 'number' && (
                                <span className={remaining < estimate.credits ? 'text-rose-600 font-medium' : 'text-neutral-500'}>
                                    {t('dashboard.assignments.ai_grading.bulk.remaining', { count: remaining })}
                                </span>
                            )}
                        </span>
                    ) : null
                }
            />
        </>
    )
}
