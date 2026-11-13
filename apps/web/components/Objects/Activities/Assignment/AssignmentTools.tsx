import React, { useEffect } from 'react'
import dynamic from 'next/dynamic'
import toast from 'react-hot-toast'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import { useWindowSize } from 'usehooks-ts'
import {
  BookOpenCheck,
  CheckCircle,
  ChevronRight,
  Infinity as InfinityIcon,
  Loader2,
  MessageSquare,
  RotateCcw,
  Sparkles,
  Trophy,
  UserRoundPen,
  XCircle,
} from 'lucide-react'
import { getFinalGrade, retryAssignmentSubmission, submitAssignmentForGrading } from '@services/courses/assignments'
import { useAssignmentSubmission } from '@components/Contexts/Assignments/AssignmentSubmissionContext'
import { useAssignmentDirtyTasks } from '@components/Contexts/Assignments/AssignmentDirtyTasksContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import ConfirmationModal from '@components/Objects/StyledElements/ConfirmationModal/ConfirmationModal'
import Modal from '@components/Objects/StyledElements/Modal/Modal'
import { ASSIGNMENT_SUBMIT_EVENT } from '@components/Objects/Activities/Assignment/assignmentUI'
import { isAssignmentPastDue } from '@components/Objects/Activities/Assignment/AssignmentStudentActivity'
import { queryKeys } from '@/lib/query/keys'

const ReactConfetti = dynamic(() => import('react-confetti'), { ssr: false })

/**
 * The learner's submit / retry / grade controls for an assignment: the
 * activity page's action bar and the embed components (@learnhouse/react)
 * both render this. Needs the assignment providers above it.
 */
export default function AssignmentTools(props: {
  activity: any
  activityid: string
  course: any
  orgslug: string
  assignment: any
}) {
  const { t } = useTranslation();
  const submission = useAssignmentSubmission() as any
  const session = useLHSession() as any;
  const queryClient = useQueryClient();
  const dirtyTasks = useAssignmentDirtyTasks();
  const [gradeData, setGradeData] = React.useState<any>(null);
  const [isGradeModalOpen, setIsGradeModalOpen] = React.useState(false);
  const { width: windowWidth, height: windowHeight } = useWindowSize();
  // Ensures the auto-open-on-mount logic only fires once per page view,
  // so the modal doesn't pop back open every time gradeData refreshes.
  const hasAutoOpenedRef = React.useRef(false);

  const [isSubmitting, setIsSubmitting] = React.useState(false);

  const submitForGradingUI = async () => {
    if (props.assignment) {
      if (isSubmitting) return
      setIsSubmitting(true)
      try {
        // Persist any answers the learner selected but didn't manually save, so
        // grading never runs against an empty/stale answer sheet. Abort if a save
        // fails rather than silently finalizing a 0%.
        const flushed = await dirtyTasks.flushAll()
        if (!flushed) {
          toast.error(t('assignments.failed_submit_assignment'))
          return
        }
        const res = await submitAssignmentForGrading(
          props.assignment?.assignment_uuid,
          session.data?.tokens?.access_token
        )
        if (res.success) {
          toast.success(t('assignments.assignment_submitted_success'))
          queryClient.invalidateQueries({ queryKey: queryKeys.assignments.submission(props.assignment?.assignment_uuid) })
          queryClient.invalidateQueries({ queryKey: queryKeys.assignments.taskSubmission(props.assignment?.assignment_uuid) })
          // Submitting may auto-grade the assignment (GRADED), which makes the
          // answer key eligible to be revealed (show_correct_answers). The task
          // definitions were fetched pre-grade with the key stripped, so refetch
          // them; otherwise the reveal renders every option as "incorrect".
          queryClient.invalidateQueries({ queryKey: queryKeys.assignments.tasks(props.assignment?.assignment_uuid) })
          // Handing in can also unlock the model answer (solution_reveal =
          // ON_SUBMISSION). The corrigé rides on the assignment payload and was
          // fetched with it stripped, so refetch that too; otherwise the
          // learner has to reload the page to see what they just earned.
          queryClient.invalidateQueries({ queryKey: queryKeys.assignments.detail(props.assignment?.assignment_uuid) })
        }
        else {
          toast.error(t('assignments.failed_submit_assignment'))
        }
      } finally {
        setIsSubmitting(false)
      }
    }
  }

  const [isRetrying, setIsRetrying] = React.useState(false);
  const retrySubmissionUI = async () => {
    if (!props.assignment || isRetrying) return;
    setIsRetrying(true);
    try {
      const res = await retryAssignmentSubmission(
        props.assignment?.assignment_uuid,
        session.data?.tokens?.access_token
      );
      if (res.success) {
        toast.success(t('assignments.retry_assignment_success'));
        // The retry wiped every per-task submission server-side. Clear the
        // cached batch IMMEDIATELY (before the refetch lands) so the task
        // editors (which remount on the incremented attempt number) hydrate
        // from an empty state and don't briefly re-adopt the previous attempt's
        // answers as their saved baseline (which would submit empty -> 0%).
        queryClient.setQueryData(queryKeys.assignments.taskSubmission(props.assignment?.assignment_uuid), {});
        // Pull the fresh per-task batch + the user submission so the task
        // editors snap back to an empty state without a hard reload.
        queryClient.invalidateQueries({ queryKey: queryKeys.assignments.submission(props.assignment?.assignment_uuid) });
        queryClient.invalidateQueries({ queryKey: queryKeys.assignments.taskSubmission(props.assignment?.assignment_uuid) });
        // The submission is back to PENDING, so the answer key must be stripped
        // again; refetch the task definitions so a revealed key from the graded
        // attempt isn't left visible during the retry.
        queryClient.invalidateQueries({ queryKey: queryKeys.assignments.tasks(props.assignment?.assignment_uuid) });
        // A retry puts the submission back to PENDING, which re-locks the model
        // answer server-side. Refetch so the learner isn't left reading the
        // corrigé they are no longer entitled to for this attempt.
        queryClient.invalidateQueries({ queryKey: queryKeys.assignments.detail(props.assignment?.assignment_uuid) });
        setGradeData(null);
        setIsGradeModalOpen(false);
        // Re-arm the auto-open on this fresh attempt so the next graded
        // result still pops the celebration / detail modal.
        hasAutoOpenedRef.current = false;
      } else {
        toast.error(t('assignments.retry_assignment_failed'));
      }
    } finally {
      setIsRetrying(false);
    }
  };

  const getGradingBasedOnMethod = async () => {
    const res = await getFinalGrade(
      session.data?.user?.id,
      props.assignment?.assignment_uuid,
      session.data?.tokens?.access_token
    );
    if (res.success) {
      // The backend returns a rich grade object: display_grade, points_summary,
      // percentage_display, passed, overall_feedback, etc. We just render it,
      // no client-side math.
      setGradeData(res.data);
    }
  };

  useEffect(() => {
    if ( submission && submission.length > 0 && submission[0].submission_status === 'GRADED') {
      getGradingBasedOnMethod();
    }
  }
    , [submission, props.assignment])

  // Auto-open the grade details modal when the student lands on a GRADED
  // assignment that was auto-graded. We only do this once per mount so it
  // doesn't reopen every time SWR re-hydrates the grade data in the
  // background.
  useEffect(() => {
    if (hasAutoOpenedRef.current) return;
    if (!gradeData) return;
    if (!submission || submission.length === 0) return;
    if (submission[0].submission_status !== 'GRADED') return;
    if (!props.assignment?.auto_grading) return;
    hasAutoOpenedRef.current = true;
    setIsGradeModalOpen(true);
  }, [gradeData, submission, props.assignment]);

  // No submission yet, OR the row exists in PENDING / NOT_SUBMITTED because
  // the student previously hit "Try again" and the retry endpoint reset the
  // row in place. In both cases the next action is the same: submit for
  // grading. The submit endpoint upserts on PENDING so a fresh submission
  // here reuses the existing row and preserves the attempt counter.
  const isAwaitingSubmission =
    !submission ||
    submission.length === 0 ||
    submission[0].submission_status === 'PENDING' ||
    submission[0].submission_status === 'NOT_SUBMITTED';
  // A formative assignment is handed in, not "submitted for grading"; nothing
  // downstream will ever mark it, so every label here says so.
  const isUngradedAssignment = !!props.assignment?.ungraded;
  const attemptNumber = submission?.[0]?.attempt_number ?? 1;
  const isRetryAttempt = isAwaitingSubmission && submission?.length > 0 && attemptNumber > 1;

  if (isAwaitingSubmission) {
    // Past the deadline the server 403s every write, including the flush that
    // "Submit for grading" performs. Offering the button anyway produced a
    // generic failure toast with no explanation of why.
    if (isAssignmentPastDue(props.assignment?.due_date)) {
      return (
        <div className="bg-rose-800 rounded-md px-4 nice-shadow flex flex-col p-2.5 text-white transition delay-150 duration-300 ease-in-out">
          <span className="text-[10px] font-bold mb-1 uppercase">{t('common.status')}</span>
          <div className="flex items-center space-x-2">
            <BookOpenCheck size={17} />
            <span className="text-xs font-bold">
              {t('assignments.past_due', { defaultValue: 'Deadline passed' })}
            </span>
          </div>
        </div>
      )
    }

    // While the submit runs the trigger itself reports it: saving every pending
    // answer and grading server-side takes seconds on a long assignment, and
    // the bar is what the learner is looking at.
    if (isSubmitting) {
      return (
        <div className="bg-cyan-800 rounded-md px-4 nice-shadow flex flex-col p-2.5 text-white transition delay-150 duration-300 ease-in-out">
          <span className="text-[10px] font-bold mb-1 uppercase">{t('common.status')}</span>
          <div className="flex items-center space-x-2">
            <Loader2 size={17} className="animate-spin" />
            <span className="text-xs font-bold">
              {t('assignments.submitting', { defaultValue: 'Submitting…' })}
            </span>
          </div>
        </div>
      )
    }

    return (
      <ConfirmationModal
        confirmationButtonText={t('assignments.submit_assignment')}
        pendingButtonText={t('assignments.submitting', { defaultValue: 'Submitting…' })}
        confirmationMessage={
          isUngradedAssignment
            ? t('assignments.hand_in_confirm', {
                defaultValue:
                  'Your work will be handed in to your teacher. It is not graded.',
              })
            : t('assignments.submit_assignment_confirm')
        }
        dialogTitle={
          isUngradedAssignment
            ? t('assignments.hand_in_title', { defaultValue: 'Hand in your work' })
            : t('assignments.submit_assignment_title')
        }
        dialogTrigger={
          <div className="bg-cyan-800 rounded-md px-4 nice-shadow flex flex-col p-2.5 text-white hover:cursor-pointer transition delay-150 duration-300 ease-in-out">
            <span className="text-[10px] font-bold mb-1 uppercase">
              {isRetryAttempt
                ? t('assignments.attempt_count', { current: attemptNumber })
                : t('common.status')}
            </span>
            <div className="flex items-center space-x-2">
              <BookOpenCheck size={17} />
              <span className="text-xs font-bold">
                {isUngradedAssignment
                  ? t('assignments.hand_in', { defaultValue: 'Hand in my work' })
                  : t('assignments.submit_for_grading')}
              </span>
            </div>
          </div>
        }
        functionToExecute={submitForGradingUI}
        status="info"
        openOnEvent={ASSIGNMENT_SUBMIT_EVENT}
      />
    )
  }

  if (submission[0].submission_status === 'SUBMITTED') {
    // Formative assignments never leave SUBMITTED (there is no grading queue
    // behind them), so "Grading in progress" would be a lie that never resolves.
    if (isUngradedAssignment) {
      const allowRetries = !!props.assignment?.allow_retries;
      const maxRetries = Number(props.assignment?.max_retries || 0);
      const currentAttempt = Number(submission?.[0]?.attempt_number || 1);
      const canRetry =
        allowRetries &&
        !isAssignmentPastDue(props.assignment?.due_date) &&
        (maxRetries === 0 || currentAttempt < maxRetries);

      return (
        <div className="flex items-center gap-2">
          <div className="bg-teal-700 rounded-md px-4 nice-shadow flex flex-col p-2.5 text-white transition delay-150 duration-300 ease-in-out">
            <span className="text-[10px] font-bold mb-1 uppercase">{t('common.status')}</span>
            <div className="flex items-center space-x-2">
              <CheckCircle size={17} />
              <span className="text-xs font-bold">
                {t('assignments.handed_in', { defaultValue: 'Handed in' })}
              </span>
            </div>
          </div>
          {canRetry && (
            <ConfirmationModal
              confirmationButtonText={t('assignments.retry_assignment')}
              // The generic warning talks about replacing a grade; here the
              // consequence is that the corrigé re-locks until the next hand-in.
              confirmationMessage={t('assignments.retry_assignment_confirm_ungraded', {
                defaultValue:
                  'Your current hand-in will be reset so you can start over, and the model answer locks again until you hand in the next attempt.',
              })}
              dialogTitle={t('assignments.retry_assignment_title')}
              dialogTrigger={
                <button
                  type="button"
                  disabled={isRetrying}
                  className="h-full inline-flex items-center gap-1.5 px-3 py-2.5 rounded-md bg-white/90 hover:bg-white disabled:opacity-50 text-teal-800 text-xs font-bold nice-shadow transition-colors"
                >
                  <RotateCcw size={14} />
                  {t('assignments.retry_assignment')}
                </button>
              }
              functionToExecute={retrySubmissionUI}
              status="warning"
            />
          )}
        </div>
      )
    }

    return (
      <div className="bg-amber-800 rounded-md px-4 nice-shadow flex flex-col p-2.5 text-white transition delay-150 duration-300 ease-in-out">
        <span className="text-[10px] font-bold mb-1 uppercase">{t('common.status')}</span>
        <div className="flex items-center space-x-2">
          <UserRoundPen size={17} />
          <span className="text-xs font-bold">{t('assignments.grading_in_progress')}</span>
        </div>
      </div>
    )
  }

  if (submission[0].submission_status === 'GRADED') {
    // Fallback string if the server response hasn't hydrated yet or is old.
    const displayGrade = gradeData?.display_grade
      ?? (gradeData ? `${gradeData.grade}/${gradeData.max_grade}` : '...');
    const pointsSummary = gradeData?.points_summary;
    const percentageDisplay = gradeData?.percentage_display;
    const passed = gradeData?.passed;
    const feedback = gradeData?.overall_feedback;
    const tasks = gradeData?.tasks as any[] | undefined;
    const isPassing = passed !== false;
    const pillBg = isPassing ? 'bg-teal-600' : 'bg-rose-600';
    const pillChip = isPassing ? 'bg-white text-teal-800' : 'bg-white text-rose-700';

    // Retry availability mirrors the backend's eligibility check: teacher
    // opted in (allow_retries) and attempt counter hasn't reached the cap
    // (max_retries=0 means unlimited). We compute it client-side too so the
    // "Try again" button is only rendered when it would actually succeed.
    const allowRetries = !!props.assignment?.allow_retries;
    const maxRetries = Number(props.assignment?.max_retries || 0);
    const currentAttempt = Number(submission?.[0]?.attempt_number || 1);
    const attemptsRemaining = maxRetries
      ? Math.max(0, maxRetries - currentAttempt)
      : null;
    // Past the deadline the server refuses a retry, and rightly so: retry wipes
    // the answers, grade and certificate, and every resubmit path is deadline
    // gated, so a retry here would destroy graded work with no way back. Mirror
    // that client-side rather than offering a button that 403s.
    const retryPastDue = isAssignmentPastDue(props.assignment?.due_date);
    const canRetry =
      allowRetries && !retryPastDue && (maxRetries === 0 || currentAttempt < maxRetries);

    return (
      <>
        {/* Compact pill: same footprint and alignment as the Next button */}
        <button
          type="button"
          onClick={() => setIsGradeModalOpen(true)}
          className={`${pillBg} rounded-md px-3 sm:px-4 nice-shadow flex flex-col items-start text-start p-2 sm:p-2.5 text-white hover:cursor-pointer transition delay-150 duration-300 ease-in-out`}
        >
          <span className="text-[10px] font-bold mb-1 uppercase text-white/90 flex items-center gap-1.5">
            <span>{t('common.status')}</span>
            {allowRetries && currentAttempt > 1 && (
              <span className="bg-white/20 text-white px-1.5 py-px rounded-full text-[9px] font-bold tracking-normal normal-case">
                {maxRetries
                  ? t('assignments.attempt_count_bounded', {
                      current: currentAttempt,
                      max: maxRetries,
                    })
                  : t('assignments.attempt_count', { current: currentAttempt })}
              </span>
            )}
          </span>
          <div className="flex items-center space-x-1.5">
            <CheckCircle size={15} className="shrink-0" />
            <span className="text-xs sm:text-sm font-semibold">{t('assignments.graded')}</span>
            <span className={`${pillChip} px-1.5 py-0.5 rounded-md text-[11px] font-bold`}>
              {displayGrade}
            </span>
            <ChevronRight size={15} className="shrink-0" />
          </div>
        </button>

        {/* Confetti for passing students. Fires once each time the modal
            opens because react-confetti with recycle={false} plays through
            and the conditional remount restarts it. */}
        {isGradeModalOpen && isPassing && gradeData && (
          <div className="fixed inset-0 pointer-events-none z-[300]">
            <ReactConfetti
              width={windowWidth}
              height={windowHeight}
              numberOfPieces={220}
              recycle={false}
              gravity={0.18}
              tweenDuration={6000}
              colors={['#10b981', '#14b8a6', '#06b6d4', '#fbbf24', '#f59e0b', '#ec4899']}
            />
          </div>
        )}

        {/* Detail modal: opens on click and auto-opens once when the
            assignment is auto-graded so students see their result right
            away. */}
        <Modal
          isDialogOpen={isGradeModalOpen}
          onOpenChange={(open: boolean) => setIsGradeModalOpen(open)}
          minWidth="sm"
          noPadding
          dialogContent={
            <div className="flex flex-col">
              {/* Hero */}
              <div className={`relative px-6 pt-8 pb-7 overflow-hidden ${
                isPassing
                  ? 'bg-gradient-to-br from-emerald-50 via-teal-50 to-cyan-50'
                  : 'bg-gradient-to-br from-rose-50 via-orange-50 to-amber-50'
              }`}>
                {/* Decorative blobs */}
                <div className={`absolute -top-12 -end-12 w-44 h-44 rounded-full blur-3xl opacity-40 ${
                  isPassing ? 'bg-emerald-300' : 'bg-rose-300'
                }`} />
                <div className={`absolute -bottom-16 -start-12 w-44 h-44 rounded-full blur-3xl opacity-40 ${
                  isPassing ? 'bg-cyan-300' : 'bg-amber-300'
                }`} />

                <div className="relative flex flex-col items-center text-center space-y-3">
                  <div className={`relative w-[72px] h-[72px] rounded-full flex items-center justify-center nice-shadow bg-white`}>
                    {isPassing ? (
                      <Trophy size={34} className="text-emerald-600" strokeWidth={2.2} />
                    ) : (
                      <XCircle size={36} className="text-rose-600" strokeWidth={2.2} />
                    )}
                    {isPassing && (
                      <>
                        <Sparkles size={16} className="absolute -top-1 -end-1 text-amber-500 drop-shadow" />
                        <Sparkles size={12} className="absolute -bottom-1 -start-1 text-amber-400 drop-shadow" />
                      </>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <p className={`text-[10px] font-bold uppercase tracking-[0.18em] ${
                      isPassing ? 'text-emerald-700' : 'text-rose-700'
                    }`}>
                      {isPassing
                        ? t('dashboard.assignments.submissions.preview.passing')
                        : t('dashboard.assignments.submissions.preview.not_passing')}
                    </p>
                    <h2 className="text-5xl font-black text-gray-900 tracking-tight leading-none">
                      {displayGrade}
                    </h2>
                    {(pointsSummary || percentageDisplay) && (
                      <p className="text-sm text-gray-500 font-medium pt-1">
                        {[percentageDisplay, pointsSummary].filter(Boolean).join(' · ')}
                      </p>
                    )}
                  </div>
                </div>
              </div>

              {/* Body */}
              <div className="px-6 pt-5 pb-6 space-y-5">
                {tasks && tasks.length > 0 && (
                  <div className="space-y-2.5">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
                      {t('assignments.task_breakdown')}
                    </p>
                    <div className="space-y-1.5">
                      {tasks.map((tb: any) => {
                        const pct = Math.max(0, Math.min(100, tb.percentage || 0));
                        // Use the server's per-task verdict. Hardcoding 60 here
                        // contradicted the real threshold (50 for most grading
                        // types, or the teacher's own pass_threshold_percentage),
                        // so a task at 50% rendered as failing in this modal while
                        // the hero above it said "Passing" and the page behind it
                        // showed a green "Task passed" card.
                        const passedTask = tb.submitted && (
                          typeof tb.passed === 'boolean' ? tb.passed : pct >= 60
                        );
                        return (
                          <div
                            key={tb.assignment_task_uuid}
                            className="relative overflow-hidden rounded-lg bg-gray-50 px-3 py-2.5"
                          >
                            {tb.submitted && (
                              <div
                                className={`absolute inset-y-0 start-0 transition-all ${
                                  passedTask ? 'bg-emerald-100/70' : 'bg-rose-100/70'
                                }`}
                                style={{ width: `${pct}%` }}
                              />
                            )}
                            <div className="relative flex items-center justify-between gap-3">
                              <span className="text-sm text-gray-700 truncate" title={tb.description || `Task ${tb.index}`}>
                                <span className="font-bold text-gray-400 me-1.5">{tb.index}.</span>
                                {tb.description || `Task ${tb.index}`}
                              </span>
                              <span className={`text-xs font-bold flex-none ${
                                !tb.submitted
                                  ? 'text-gray-400'
                                  : passedTask
                                    ? 'text-emerald-700'
                                    : 'text-rose-700'
                              }`}>
                                {tb.submitted ? tb.percentage_display : 'n/a'}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {feedback && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-gray-400">
                      <MessageSquare size={11} />
                      <span>{t('dashboard.assignments.submissions.feedback.label')}</span>
                    </div>
                    <div className="p-3 rounded-lg bg-gray-50 border border-gray-100">
                      <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">
                        {feedback}
                      </p>
                    </div>
                  </div>
                )}

                {!tasks?.length && !feedback && (
                  <p className="text-sm text-gray-400 text-center py-4">
                    {t('assignments.no_grade_details')}
                  </p>
                )}

                {allowRetries && (
                  <div className="pt-2">
                    {canRetry ? (
                      <div className="rounded-xl border border-fuchsia-100 bg-gradient-to-br from-fuchsia-50 via-pink-50 to-rose-50 p-4">
                        <div className="flex items-start gap-3">
                          <div className="w-9 h-9 rounded-full bg-white nice-shadow flex items-center justify-center text-fuchsia-600 shrink-0">
                            <RotateCcw size={16} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-bold text-gray-900">
                              {t('assignments.retry_assignment_title')}
                            </p>
                            <p className="text-xs text-gray-600 mt-1 leading-snug">
                              {t('assignments.retry_assignment_confirm')}
                            </p>
                            <p className="text-[11px] text-fuchsia-700 mt-2 font-semibold flex items-center gap-1.5">
                              {maxRetries === 0 ? (
                                <>
                                  <InfinityIcon size={11} />
                                  <span>
                                    {t('assignments.attempt_count', { current: currentAttempt })}
                                  </span>
                                </>
                              ) : attemptsRemaining === 1 ? (
                                <span>{t('assignments.retry_assignment_last')}</span>
                              ) : (
                                <span>
                                  {t('assignments.retry_assignment_remaining', { count: attemptsRemaining })}
                                </span>
                              )}
                            </p>
                          </div>
                        </div>
                        <ConfirmationModal
                          confirmationButtonText={t('assignments.retry_assignment')}
                          confirmationMessage={t('assignments.retry_assignment_confirm')}
                          dialogTitle={t('assignments.retry_assignment_title')}
                          dialogTrigger={
                            <button
                              type="button"
                              disabled={isRetrying}
                              className="mt-3 w-full inline-flex items-center justify-center gap-1.5 h-9 px-4 rounded-lg bg-gray-900 hover:bg-gray-800 disabled:opacity-50 text-white text-sm font-semibold transition-colors"
                            >
                              <RotateCcw size={14} />
                              {t('assignments.retry_assignment')}
                            </button>
                          }
                          functionToExecute={retrySubmissionUI}
                          status="warning"
                        />
                      </div>
                    ) : (
                      <div className="rounded-xl border border-gray-100 bg-gray-50 p-3">
                        <div className="flex items-center gap-2">
                          <RotateCcw size={14} className="text-gray-400 shrink-0" />
                          <p className="text-xs text-gray-500 font-medium">
                            {t('assignments.retry_no_attempts_left')} ·{' '}
                            {t('assignments.attempt_count_bounded', {
                              current: currentAttempt,
                              max: maxRetries,
                            })}
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          }
        />
      </>
    )
  }

  // Default return in case none of the conditions are met
  return null
}
