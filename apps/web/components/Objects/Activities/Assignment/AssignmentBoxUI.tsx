import { useAssignments } from '@components/Contexts/Assignments/AssignmentContext'
import { useAssignmentSubmission } from '@components/Contexts/Assignments/AssignmentSubmissionContext'
import { useAssignmentDirtyTasks } from '@components/Contexts/Assignments/AssignmentDirtyTasksContext'
import { useAutoSave, type SaveResult } from './useAutoSave'
import { BookPlus, BookUser, Check, Code2, FileUp, Hash, ListTodo, Loader2, MessageSquare, Pencil, Save, TriangleAlert, Type } from 'lucide-react'
import React from 'react'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useTranslation } from 'react-i18next'

// Options passed to a task's submitFC. `silent` suppresses user-facing toasts
// so background auto-saves and the submit-time flush don't spam the learner.
export type TaskSubmitOptions = { silent?: boolean }

type AssignmentBoxProps = {
    type: 'quiz' | 'file' | 'form' | 'code' | 'short' | 'number'
    view?: 'teacher' | 'student' | 'grading' | 'custom-grading'
    maxPoints?: number
    currentPoints?: number
    currentFeedback?: string
    saveFC?: () => void
    // A task may return 'blocked' to mean "refused by policy, do not retry"
    // (e.g. a code task gated on passing its tests). useAutoSave treats that as
    // terminal instead of looping a doomed save forever.
    submitFC?: (_opts?: TaskSubmitOptions) => void | Promise<SaveResult | void>
    gradeFC?: () => void
    gradeCustomFC?: (_grade: number, _feedback?: string) => void
    autoGradable?: boolean
    // Canonical serialization of the learner's CURRENT answer and the LAST-SAVED
    // baseline. Auto-save fires whenever they differ (student tasks only).
    dirtyValue?: string
    savedValue?: string
    // Identifies this task in the dirty-task registry so "Submit for grading"
    // can flush its unsaved answers. Omit outside the learner activity flow.
    taskUUID?: string
    children: React.ReactNode
}

// Strings the system writes automatically when no teacher comment is provided.
// We treat these as "no real feedback" so we don't pre-fill the textarea with
// them on subsequent grading passes.
const isAutoFeedback = (s?: string) =>
    !!s && (/^Auto graded by system$/.test(s) || /^Graded by teacher : @/.test(s))

function AssignmentBoxUI({ type, view, currentPoints, currentFeedback, maxPoints, saveFC, submitFC, gradeFC, gradeCustomFC, autoGradable, dirtyValue, savedValue, taskUUID, children }: AssignmentBoxProps) {
    const { t } = useTranslation()
    // Grading view manual input. Pre-filled from the server-side currentPoints
    // so teachers can tweak an existing grade instead of retyping it.
    const [manualGrade, setManualGrade] = React.useState<string>('')
    const [manualFeedback, setManualFeedback] = React.useState<string>('')
    const submission = useAssignmentSubmission() as any
    const assignmentCtx = useAssignments() as any
    const session = useLHSession() as any

    // A formative assignment carries no grade at all (the API refuses to grade
    // it), so every scoring affordance in this box is hidden rather than left
    // wired to an endpoint that 400s. One check here covers the learner view,
    // the teacher view and both grading views for all six task types.
    const isUngraded = !!assignmentCtx?.assignment_object?.ungraded

    // The student can save/draft answers until they SUBMIT for grading or are
    // GRADED. A retry flips the row back to PENDING, which re-enables saving.
    const latestSubmissionStatus =
        Array.isArray(submission) && submission.length > 0
            ? submission[0]?.submission_status
            : null
    const canStudentSave =
        latestSubmissionStatus !== 'SUBMITTED' && latestSubmissionStatus !== 'GRADED'

    // Value-driven auto-save. "Dirty" is a pure content predicate
    // (dirtyValue !== savedValue) so it is immune to query refetches, window
    // focus, submission-status churn, and unrelated re-renders: the failure
    // modes of the previous flag+poller design.
    const autoSaveEnabled = view === 'student' && !!taskUUID && !!submitFC && canStudentSave
    const auto = useAutoSave({
        currentValue: dirtyValue ?? '',
        savedValue: savedValue ?? '',
        save: (opts) => (submitFC ? submitFC(opts) : Promise.resolve(true)),
        enabled: autoSaveEnabled,
    })

    // Register this student task so a single "Submit for grading" click flushes
    // its unsaved answers before the server auto-grades. Backed by the hook's
    // own dirty/flush, read via refs to avoid stale closures.
    const dirtyTasks = useAssignmentDirtyTasks()
    const flushRef = React.useRef(auto.flush)
    const getDirtyRef = React.useRef(auto.getIsDirty)
    React.useEffect(() => { flushRef.current = auto.flush; getDirtyRef.current = auto.getIsDirty })
    React.useEffect(() => {
        if (view !== 'student' || !taskUUID) return
        dirtyTasks.register(taskUUID, {
            getIsDirty: () => getDirtyRef.current(),
            flush: () => flushRef.current(),
        })
        return () => dirtyTasks.unregister(taskUUID)
    }, [view, taskUUID, dirtyTasks])

    React.useEffect(() => {
        if (currentPoints !== undefined && currentPoints !== null) {
            setManualGrade(String(currentPoints))
        }
    }, [currentPoints])

    React.useEffect(() => {
        if (currentFeedback && !isAutoFeedback(currentFeedback)) {
            setManualFeedback(currentFeedback)
        }
    }, [currentFeedback])

    const submitManualGrade = () => {
        if (!gradeCustomFC) return
        const parsed = parseInt(manualGrade, 10)
        if (Number.isNaN(parsed)) return
        const trimmed = manualFeedback.trim()
        gradeCustomFC(parsed, trimmed.length > 0 ? trimmed : undefined)
    }

    const isGradingMode = (view === 'grading' || view === 'custom-grading') && !isUngraded

    // Check if user is authenticated
    const isAuthenticated = session?.status === 'authenticated'

    // Auto-save status line. Learners never press "Save": answers persist on
    // their own, and this says so quietly instead of a button per task.
    const saveStatus = autoSaveEnabled && (auto.isDirty || auto.status !== 'idle') ? (
        <div className='flex items-center gap-1.5 text-xs font-medium text-neutral-400' aria-live='polite'>
            {auto.isBlocked ? (
                // Refused by policy, not a transient failure. No retry is coming,
                // so promising one would be a lie. The task itself explains what
                // needs to change (e.g. tests must pass before the answer can be saved).
                <>
                    <TriangleAlert size={13} className='text-rose-500' />
                    <span className='text-rose-600'>{t('activities.autosave_blocked', { defaultValue: "Can't be saved yet" })}</span>
                </>
            ) : auto.isError ? (
                // Failed save: a retry is already scheduled; let the learner force it.
                <>
                    <TriangleAlert size={13} className='text-amber-500' />
                    <span className='text-amber-600'>{t('activities.autosave_retry', { defaultValue: "Couldn't save, retrying…" })}</span>
                    {isAuthenticated && (
                        <button type='button' onClick={() => { if (!auto.isSaving) auto.saveNow() }} className='ms-1 font-semibold text-neutral-700 underline underline-offset-2 hover:text-neutral-900'>
                            {t('activities.save_answers', { defaultValue: 'Save answers' })}
                        </button>
                    )}
                </>
            ) : auto.isSaving ? (
                <>
                    <Loader2 size={13} className='animate-spin' />
                    <span>{t('activities.autosaving', { defaultValue: 'Saving…' })}</span>
                </>
            ) : (auto.isPending || auto.isDirty) ? (
                // Debounce timer armed but no request in flight yet.
                <>
                    <span className='h-1.5 w-1.5 rounded-full bg-amber-400' />
                    <span>{t('activities.autosave_unsaved', { defaultValue: 'Unsaved changes' })}</span>
                </>
            ) : (
                <>
                    <Check size={13} className='text-teal-600' />
                    <span>{t('activities.autosaved', { defaultValue: 'Saved' })}</span>
                </>
            )}
        </div>
    ) : null

    // The learner view has no chrome of its own: the assignment page wraps each
    // task in a card with its number, prompt and points.
    if (view === 'student') {
        return (
            <div className='flex flex-col gap-3'>
                {children}
                {saveStatus && <div className='flex justify-end'>{saveStatus}</div>}
            </div>
        )
    }

    const TypeIcon = { quiz: ListTodo, file: FileUp, code: Code2, short: Pencil, number: Hash, form: Type }[type]
    const typeLabel = {
        quiz: t('activities.quiz'),
        file: t('activities.file_submission'),
        code: t('activities.code'),
        short: t('dashboard.assignments.editor.task_type_labels.short_answer', { defaultValue: 'Short answer' }),
        number: t('dashboard.assignments.editor.task_type_labels.number_answer', { defaultValue: 'Number' }),
        form: t('activities.form'),
    }[type]

    return (
        // A bordered section, not a card: the editor panel and the grading modal
        // already put each task on a white card.
        <div className='flex flex-col rounded-xl border border-neutral-200 bg-white'>
            <div className={`flex flex-col gap-3 px-4 py-3 border-b border-neutral-100 ${isGradingMode ? '' : 'sm:flex-row sm:items-center sm:justify-between'}`}>
                <div className='flex flex-wrap items-center gap-2'>
                    <div className='flex items-center gap-2 text-sm font-semibold text-neutral-800'>
                        <span className='flex h-7 w-7 items-center justify-center rounded-lg bg-neutral-100 text-neutral-600'>
                            <TypeIcon size={15} />
                        </span>
                        <span>{typeLabel}</span>
                    </div>
                    {view === 'teacher' &&
                        <span className='flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700'>
                            <BookUser size={12} />
                            {t('activities.teacher_view')}
                        </span>
                    }
                    {maxPoints && !isUngraded &&
                        <span className='flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 tabular-nums'>
                            <BookPlus size={12} />
                            {maxPoints} {t('assignments.points')}
                        </span>
                    }
                </div>

                <div className='flex flex-wrap items-center gap-2'>
                    {view === 'teacher' &&
                        <button
                            type='button'
                            onClick={() => saveFC && saveFC()}
                            className='flex h-9 items-center gap-1.5 rounded-xl bg-neutral-900 px-3.5 text-xs font-semibold text-white transition-colors hover:bg-neutral-800'>
                            <Save size={14} />
                            {t('common.save')}
                        </button>
                    }

                    {/* Grading controls, shared between 'grading' and 'custom-grading' views */}
                    {isGradingMode && maxPoints !== undefined && gradeCustomFC && (
                        <div className='flex flex-wrap items-center gap-2 w-full sm:w-auto'>
                            {currentPoints !== undefined && currentPoints > 0 && (
                                <span className='rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 tabular-nums'>{currentPoints}/{maxPoints} {t('assignments.points')}</span>
                            )}
                            <div className='flex items-center rounded-xl bg-neutral-100 p-0.5'>
                                <button
                                    type='button'
                                    onClick={() => setManualGrade(String(maxPoints))}
                                    className='rounded-lg px-2.5 py-1 text-[11px] font-semibold text-emerald-700 transition-colors hover:bg-white'>
                                    {t('assignments.quick_grade.full', { defaultValue: 'Full' })}
                                </button>
                                <button
                                    type='button'
                                    onClick={() => setManualGrade(String(Math.round(maxPoints / 2)))}
                                    className='rounded-lg px-2.5 py-1 text-[11px] font-semibold text-amber-700 transition-colors hover:bg-white'>
                                    {t('assignments.quick_grade.half', { defaultValue: 'Half' })}
                                </button>
                                <button
                                    type='button'
                                    onClick={() => setManualGrade('0')}
                                    className='rounded-lg px-2.5 py-1 text-[11px] font-semibold text-rose-700 transition-colors hover:bg-white'>
                                    {t('assignments.quick_grade.zero', { defaultValue: 'Zero' })}
                                </button>
                            </div>
                            <div className='flex items-center gap-1.5'>
                                <div className='relative'>
                                    <input
                                        value={manualGrade}
                                        onChange={(e) => setManualGrade(e.target.value)}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') submitManualGrade()
                                        }}
                                        placeholder='0'
                                        min={0}
                                        max={maxPoints}
                                        aria-label={t('assignments.grade')}
                                        className='h-9 w-[96px] rounded-xl border border-neutral-200 bg-white ps-3 pe-10 text-sm tabular-nums outline-none focus:border-neutral-400'
                                        type='number'
                                    />
                                    <span className='pointer-events-none absolute inset-y-0 end-3 flex items-center text-xs text-neutral-400 tabular-nums'>/{maxPoints}</span>
                                </div>
                                <button
                                    type='button'
                                    onClick={submitManualGrade}
                                    className='flex h-9 items-center gap-1.5 rounded-xl bg-neutral-900 px-3 text-xs font-semibold text-white transition-colors hover:bg-neutral-800'>
                                    <BookPlus size={14} />
                                    {t('assignments.grade')}
                                </button>
                            </div>
                            {view === 'grading' && gradeFC && (
                                <button
                                    type='button'
                                    onClick={() => gradeFC && gradeFC()}
                                    className='flex h-9 items-center gap-1.5 rounded-xl bg-neutral-100 px-3 text-xs font-semibold text-neutral-800 transition-colors hover:bg-neutral-200'>
                                    <BookPlus size={14} />
                                    {autoGradable ? t('assignments.run_autograde') : t('assignments.grade')}
                                </button>
                            )}
                        </div>
                    )}
                </div>
            </div>

            <div className='flex flex-col gap-3 px-4 py-4'>
                {/* Per-task feedback, saved together with the manual grade. */}
                {isGradingMode && gradeCustomFC && (
                    <div className='flex items-start gap-2'>
                        <MessageSquare size={14} className='text-neutral-400 mt-2.5 flex-none' />
                        <textarea
                            value={manualFeedback}
                            onChange={(e) => setManualFeedback(e.target.value)}
                            placeholder={t('assignments.task_feedback_placeholder', { defaultValue: 'Note for this task (saved with grade)' })}
                            rows={1}
                            className='w-full rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-700 outline-none placeholder:text-neutral-400 focus:border-neutral-400 resize-y'
                        />
                    </div>
                )}

                {children}
            </div>
        </div>
    )
}

export default AssignmentBoxUI
