import { useAssignmentSubmission } from '@components/Contexts/Assignments/AssignmentSubmissionContext'
import { useAssignmentDirtyTasks } from '@components/Contexts/Assignments/AssignmentDirtyTasksContext'
import { useAutoSave, type SaveResult } from './useAutoSave'
import { BookPlus, BookUser, Check, Code2, EllipsisVertical, FileUp, ListTodo, Loader2, MessageSquare, Save, TriangleAlert, Type } from 'lucide-react'
import React from 'react'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useTranslation } from 'react-i18next'

// Options passed to a task's submitFC. `silent` suppresses user-facing toasts
// so background auto-saves and the submit-time flush don't spam the learner.
export type TaskSubmitOptions = { silent?: boolean }

type AssignmentBoxProps = {
    type: 'quiz' | 'file' | 'form' | 'code'
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
    const session = useLHSession() as any

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
    // focus, submission-status churn, and unrelated re-renders — the failure
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

    const isGradingMode = view === 'grading' || view === 'custom-grading'

    // Check if user is authenticated
    const isAuthenticated = session?.status === 'authenticated'

    return (
        <div className='flex flex-col px-3 sm:px-6 py-4 nice-shadow rounded-md bg-slate-100/30'>
            <div className='flex flex-col sm:flex-row sm:justify-between sm:space-x-2 pb-2 text-slate-400 sm:items-center'>
                {/* Left side with type and badges */}
                <div className='flex flex-wrap gap-2 items-center mb-2 sm:mb-0'>
                    <div className='text-lg font-semibold'>
                        {type === 'quiz' &&
                            <div className='flex space-x-1.5 items-center'>
                                <ListTodo size={17} />
                                <p>{t('activities.quiz')}</p>
                            </div>}
                        {type === 'file' &&
                            <div className='flex space-x-1.5 items-center'>
                                <FileUp size={17} />
                                <p>{t('activities.file_submission')}</p>
                            </div>}
                        {type === 'form' &&
                            <div className='flex space-x-1.5 items-center'>
                                <Type size={17} />
                                <p>{t('activities.form')}</p>
                            </div>}
                        {type === 'code' &&
                            <div className='flex space-x-1.5 items-center'>
                                <Code2 size={17} />
                                <p>{t('activities.code')}</p>
                            </div>}
                    </div>

                    <div className='flex items-center space-x-1'>
                        <EllipsisVertical size={15} />
                    </div>
                    {view === 'teacher' &&
                        <div className='flex bg-amber-200/20 text-xs rounded-full space-x-1 px-2 py-0.5 font-bold outline items-center text-amber-600 outline-1 outline-amber-300/40'>
                            <BookUser size={12} />
                            <p>{t('activities.teacher_view')}</p>
                        </div>
                    }
                    {maxPoints &&
                        <div className='flex bg-emerald-200/20 text-xs rounded-full space-x-1 px-2 py-0.5 font-bold outline items-center text-emerald-600 outline-1 outline-emerald-300/40'>
                            <BookPlus size={12} />
                            <p>{maxPoints} {t('assignments.points')}</p>
                        </div>
                    }
                </div>

                {/* Right side with buttons and actions */}
                <div className='flex flex-wrap gap-2 items-center'>
                    {/* Auto-save status — answers persist automatically. */}
                    {autoSaveEnabled && (auto.isDirty || auto.status !== 'idle') && (
                        <div className='flex space-x-1.5 items-center font-medium px-2 py-1 text-xs text-slate-400 sm:me-2'>
                            {auto.isBlocked ? (
                                // Refused by policy, not a transient failure — no retry
                                // is coming, so promising one would be a lie. The task
                                // itself explains what needs to change (e.g. tests must
                                // pass before the answer can be saved).
                                <>
                                    <TriangleAlert size={13} className='text-rose-500' />
                                    <p className='text-rose-600'>{t('activities.autosave_blocked', { defaultValue: "Can't be saved yet" })}</p>
                                </>
                            ) : auto.isError ? (
                                // Failed save: show a distinct indicator (a retry
                                // is already scheduled) instead of a stuck spinner.
                                <>
                                    <TriangleAlert size={13} className='text-amber-500' />
                                    <p className='text-amber-600'>{t('activities.autosave_retry', { defaultValue: "Couldn't save — retrying…" })}</p>
                                </>
                            ) : auto.isSaving ? (
                                <>
                                    <Loader2 size={13} className='animate-spin' />
                                    <p>{t('activities.autosaving', { defaultValue: 'Saving…' })}</p>
                                </>
                            ) : (auto.isPending || auto.isDirty) ? (
                                // Debounce timer armed but no request in flight. Showing
                                // a spinner + "Saving…" here claimed work that had not
                                // started, which is exactly when an unmount lost it.
                                <>
                                    <TriangleAlert size={13} className='text-slate-400' />
                                    <p>{t('activities.autosave_unsaved', { defaultValue: 'Unsaved changes' })}</p>
                                </>
                            ) : (
                                <>
                                    <Check size={13} className='text-emerald-500' />
                                    <p>{t('activities.autosaved', { defaultValue: 'Saved' })}</p>
                                </>
                            )}
                        </div>
                    )}

                    {/* Teacher button */}
                    {view === 'teacher' &&
                        <div
                            onClick={() => saveFC && saveFC()}
                            className='flex px-2 py-1 cursor-pointer rounded-md space-x-2 items-center bg-linear-to-bl text-emerald-700 bg-emerald-300/20 hover:bg-emerald-300/10 hover:outline-offset-4 active:outline-offset-1 linear transition-all outline-offset-2 outline-dashed outline-emerald-500/60'>
                            <Save size={14} />
                            <p className='text-xs font-semibold'>{t('common.save')}</p>
                        </div>
                    }

                    {/* Student button - only show if authenticated and not yet submitted/graded.
                        Routed through the auto-save hook so a manual click can't race a
                        background save into a duplicate submission; disabled while saving. */}
                    {view === 'student' && isAuthenticated && canStudentSave &&
                        <div
                            onClick={() => { if (!auto.isSaving) auto.saveNow() }}
                            className={`flex px-2 py-1 rounded-md space-x-2 items-center justify-center mx-auto w-full sm:w-auto bg-linear-to-bl text-emerald-700 bg-emerald-300/20 hover:bg-emerald-300/10 hover:outline-offset-4 active:outline-offset-1 linear transition-all outline-offset-2 outline-dashed outline-emerald-500/60 ${auto.isSaving ? 'opacity-60 cursor-wait' : 'cursor-pointer'}`}>
                            <Save size={14} />
                            <p className='text-xs font-semibold'>{t('activities.save_answers', { defaultValue: 'Save answers' })}</p>
                        </div>
                    }

                    {/* Grading controls — shared between 'grading' and 'custom-grading' views */}
                    {isGradingMode && maxPoints !== undefined && gradeCustomFC && (
                        <div className='flex flex-wrap sm:flex-nowrap w-full sm:w-auto px-0.5 py-0.5 rounded-md gap-2 sm:space-x-2 items-center'>
                            {currentPoints !== undefined && currentPoints > 0 && (
                                <p className='font-semibold px-2 text-xs text-emerald-700 bg-emerald-50 rounded-full py-0.5'>{currentPoints}/{maxPoints} {t('assignments.points')}</p>
                            )}
                            <div className='flex items-center gap-1'>
                                <button
                                    type='button'
                                    onClick={() => setManualGrade(String(maxPoints))}
                                    className='cursor-pointer text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition-colors'>
                                    {t('assignments.quick_grade.full', { defaultValue: 'Full' })}
                                </button>
                                <button
                                    type='button'
                                    onClick={() => setManualGrade(String(Math.round(maxPoints / 2)))}
                                    className='cursor-pointer text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 hover:bg-amber-100 transition-colors'>
                                    {t('assignments.quick_grade.half', { defaultValue: 'Half' })}
                                </button>
                                <button
                                    type='button'
                                    onClick={() => setManualGrade('0')}
                                    className='cursor-pointer text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 hover:bg-rose-100 transition-colors'>
                                    {t('assignments.quick_grade.zero', { defaultValue: 'Zero' })}
                                </button>
                            </div>
                            <div className='flex items-center gap-1.5'>
                                <input
                                    value={manualGrade}
                                    onChange={(e) => setManualGrade(e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') submitManualGrade()
                                    }}
                                    placeholder={`/${maxPoints}`}
                                    min={0}
                                    max={maxPoints}
                                    className='w-[80px] light-shadow text-sm py-0.5 outline outline-gray-200 rounded-lg px-2'
                                    type='number'
                                />
                                <div
                                    onClick={submitManualGrade}
                                    className='cursor-pointer bg-orange-50 text-orange-700 hover:bg-orange-100 items-center flex rounded-md px-2 py-1 space-x-1.5 transition-colors'>
                                    <BookPlus size={14} />
                                    <p className='text-xs font-semibold'>{t('assignments.grade')}</p>
                                </div>
                            </div>
                            {view === 'grading' && gradeFC && (
                                <div
                                    onClick={() => gradeFC && gradeFC()}
                                    className='cursor-pointer bg-gray-100 text-gray-700 hover:bg-gray-200 items-center flex rounded-md px-2 py-1 space-x-1.5 transition-colors'>
                                    <BookPlus size={14} />
                                    <p className='text-xs font-semibold'>{autoGradable ? t('assignments.run_autograde') : t('assignments.grade')}</p>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>

            {/* Per-task feedback — saved together with the manual grade. */}
            {isGradingMode && gradeCustomFC && (
                <div className='flex items-start gap-2 mb-3 px-1'>
                    <MessageSquare size={14} className='text-gray-400 mt-2 flex-none' />
                    <textarea
                        value={manualFeedback}
                        onChange={(e) => setManualFeedback(e.target.value)}
                        placeholder={t('assignments.task_feedback_placeholder', { defaultValue: 'Note for this task (saved with grade)' })}
                        rows={1}
                        className='w-full px-2.5 py-1.5 text-xs text-gray-700 bg-white border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-orange-200 placeholder:text-gray-400 resize-y'
                    />
                </div>
            )}

            {children}
        </div>
    )
}

export default AssignmentBoxUI
