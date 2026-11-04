import { useAssignments } from '@components/Contexts/Assignments/AssignmentContext';
import { useAssignmentSubmission, useAssignmentTaskSubmissions } from '@components/Contexts/Assignments/AssignmentSubmissionContext';
import { useCourse } from '@components/Contexts/CourseContext';
import { useOrg } from '@components/Contexts/OrgContext';
import { getAssignmentSolutionFileDir, getTaskRefFileDir } from '@services/media/media';
import TaskFileObject from 'app/orgs/[orgslug]/dash/assignments/[assignmentuuid]/_components/TaskEditor/Subs/TaskTypes/TaskFileObject';
import TaskQuizObject from 'app/orgs/[orgslug]/dash/assignments/[assignmentuuid]/_components/TaskEditor/Subs/TaskTypes/TaskQuizObject'
import TaskFormObject from 'app/orgs/[orgslug]/dash/assignments/[assignmentuuid]/_components/TaskEditor/Subs/TaskTypes/TaskFormObject'
import TaskCodeObject from 'app/orgs/[orgslug]/dash/assignments/[assignmentuuid]/_components/TaskEditor/Subs/TaskTypes/TaskCodeObject'
import TaskShortAnswerObject from 'app/orgs/[orgslug]/dash/assignments/[assignmentuuid]/_components/TaskEditor/Subs/TaskTypes/TaskShortAnswerObject'
import TaskNumberAnswerObject from 'app/orgs/[orgslug]/dash/assignments/[assignmentuuid]/_components/TaskEditor/Subs/TaskTypes/TaskNumberAnswerObject'
import toast from 'react-hot-toast';
import { AlarmClockOff, BookOpenCheck, Calendar, Check, CheckCircle2, Circle, ClipboardCheck, ClipboardList, Download, Hourglass, Lightbulb, ListChecks, Lock, MessageSquare, PencilLine, RotateCcw, Send, Trophy, X } from 'lucide-react';
import Link from 'next/link';
import React, { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next';
import { sortTasksByOrder } from '@/lib/assignments/taskOrder'
import { ASSIGNMENT_SUBMIT_EVENT, taskSubmissionHasAnswer } from './assignmentUI'

type ParsedDueDate = { at: Date; hasTime: boolean }

// Parse the assignment due date the SAME way the server does in
// `_is_assignment_past_due` (apps/api/.../assignments.py):
//   - the value is a free-form ISO-ish string; unparseable/empty means "no
//     deadline" so a malformed value never locks a student out,
//   - the server compares against a NAIVE `datetime.now()` and drops any
//     timezone offset, so the wall-clock parts are what matter. We therefore
//     build a LOCAL Date from those parts instead of letting `new Date(...)`
//     treat a bare "2026-06-12" as UTC midnight; that shift alone could mark
//     an assignment overdue a day early (or late) depending on the viewer's
//     offset, disagreeing with the 403 the server actually enforces.
export function parseDueDate(raw?: string | null): ParsedDueDate | null {
  if (!raw || !String(raw).trim()) return null
  const value = String(raw).trim()
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/)
  if (!match) return null
  const [, year, month, day, hours, minutes, seconds] = match
  const hasTime = hours !== undefined
  const at = new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hours ?? 0),
    Number(minutes ?? 0),
    Number(seconds ?? 0)
  )
  if (Number.isNaN(at.getTime())) return null
  return { at, hasTime }
}

// Exported so the "Submit for grading" affordance (rendered outside this
// component) can gate on the exact same rule instead of re-deriving it.
export function isAssignmentPastDue(raw?: string | null, now: number = Date.now()): boolean {
  const parsed = parseDueDate(raw)
  if (!parsed) return false
  const cutoff = new Date(parsed.at)
  // A date-only deadline means "end of that day" server-side (the cutoff is
  // shifted to the following midnight), so the due date itself is still on time.
  if (!parsed.hasTime) cutoff.setDate(cutoff.getDate() + 1)
  return cutoff.getTime() < now
}

function AssignmentStudentActivity() {
  const { t, i18n } = useTranslation()
  const assignments = useAssignments() as any;
  const _course = useCourse() as any;
  const org = useOrg() as any;
  const submission = useAssignmentSubmission() as any;
  const taskSubmissionsMap = useAssignmentTaskSubmissions() as Record<string, any> | null;

  // Per-task grading is rendered inline only after the whole assignment has
  // been graded; that's when raw task grades are guaranteed to reflect the
  // server-verified value (auto-grade or teacher override). Before that,
  // task.grade is the placeholder 0 from save-progress.
  const isGraded = Array.isArray(submission) && submission.length > 0 && submission[0].submission_status === 'GRADED';

  // Attempt indicator. Only worth showing when the teacher actually enabled
  // retries and the student has burned at least one attempt; otherwise it's
  // noise.
  const allowRetries = !!assignments?.assignment_object?.allow_retries;
  const maxRetries = Number(assignments?.assignment_object?.max_retries || 0);
  const currentAttempt = Number(
    (Array.isArray(submission) && submission[0]?.attempt_number) || 1
  );
  const showAttemptBadge = allowRetries && currentAttempt > 1;

  // Keep per-task pass/fail aligned with the overall grade threshold on the
  // server (50% for NUMERIC / PERCENTAGE / PASS_FAIL, 60% for ALPHABET /
  // GPA_SCALE). Otherwise a student with 55% on a numeric-graded task sees
  // "Not Passed" inline while the same score is "Pass" at the assignment
  // level, exactly the mismatch the teacher tried to avoid.
  // Formative assignment: handed in, never marked. The server refuses to grade
  // it at all, so every grade affordance below is hidden rather than left
  // showing a score that can never arrive.
  const isUngraded = !!assignments?.assignment_object?.ungraded;

  // Model answer ("corrigé"). `has_solution` is sent even while locked so this
  // view can promise the reward; `solution` / `solution_file` are only present
  // once the server has actually unlocked them for this learner.
  const hasSolution = !!assignments?.assignment_object?.has_solution;
  const solutionUnlocked = !!assignments?.assignment_object?.solution_unlocked;
  const solutionText = (assignments?.assignment_object?.solution || '').trim();
  const solutionFile = assignments?.assignment_object?.solution_file;
  const solutionRevealsOnSubmission =
    assignments?.assignment_object?.solution_reveal === 'ON_SUBMISSION';

  const gradingType = assignments?.assignment_object?.grading_type;
  // Honor the teacher-configured passing threshold; fall back to the
  // grading-type default when unset so existing assignments are unchanged.
  const configuredThreshold = assignments?.assignment_object?.pass_threshold_percentage;
  const passingThreshold =
    typeof configuredThreshold === 'number'
      ? configuredThreshold
      : gradingType === 'ALPHABET' || gradingType === 'GPA_SCALE'
        ? 60
        : 50;

  // Deadline state. Past the due date the server rejects EVERY write with a 403
  // (see `_is_assignment_past_due`), so the learner needs to be told before
  // auto-save starts failing behind their back.
  const dueDateRaw = assignments?.assignment_object?.due_date as string | undefined;
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    if (!parseDueDate(dueDateRaw)) return;
    if (isAssignmentPastDue(dueDateRaw, Date.now())) return;
    // Re-evaluate while the page stays open so a deadline that passes mid-session
    // flips the UI instead of leaving a stale "still open" state.
    const interval = setInterval(() => {
      setNow(Date.now());
      if (isAssignmentPastDue(dueDateRaw, Date.now())) clearInterval(interval);
    }, 60_000);
    return () => clearInterval(interval);
  }, [dueDateRaw]);
  const isPastDue = useMemo(() => isAssignmentPastDue(dueDateRaw, now), [dueDateRaw, now]);

  // Render the raw ISO-ish string as a readable, localized date. Falls back to
  // the raw value when it can't be parsed (same tolerance as the server).
  const dueDateLabel = useMemo(() => {
    const parsed = parseDueDate(dueDateRaw);
    if (!parsed) return dueDateRaw ?? '';
    const locale = i18n.language === 'fr' ? 'fr-FR' : 'en-US';
    return parsed.hasTime
      ? parsed.at.toLocaleString(locale, {
          year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
        })
      : parsed.at.toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' });
  }, [dueDateRaw, i18n.language]);

  const tasks: any[] = useMemo(() => (assignments ? sortTasksByOrder(assignments?.assignment_tasks) : []), [assignments])
  const totalPoints = tasks.reduce((sum, task) => sum + (Number(task.max_grade_value) || 0), 0)
  const answeredCount = tasks.filter((task) =>
    taskSubmissionHasAnswer(taskSubmissionsMap?.[task.assignment_task_uuid])
  ).length
  const earnedPoints = tasks.reduce(
    (sum, task) => sum + (Number(taskSubmissionsMap?.[task.assignment_task_uuid]?.grade) || 0),
    0
  )
  const scorePercentage = totalPoints > 0 ? Math.round((earnedPoints / totalPoints) * 100) : 0
  const scorePassed = scorePercentage >= passingThreshold

  const submissionStatus = Array.isArray(submission) && submission.length > 0 ? submission[0]?.submission_status : null
  const isSubmitted = submissionStatus === 'SUBMITTED'
  const isAwaitingSubmission = !isSubmitted && !isGraded

  // One status for the whole assignment, in the learner's words.
  const status = isGraded
    ? { label: t('assignments.graded'), tone: 'bg-emerald-50 text-emerald-700', Icon: CheckCircle2 }
    : isSubmitted
      ? isUngraded
        ? { label: t('assignments.handed_in', { defaultValue: 'Handed in' }), tone: 'bg-emerald-50 text-emerald-700', Icon: CheckCircle2 }
        : { label: t('assignments.status_submitted', { defaultValue: 'Submitted' }), tone: 'bg-amber-50 text-amber-700', Icon: Hourglass }
      : isPastDue
        ? { label: t('assignments.past_due', { defaultValue: 'Deadline passed' }), tone: 'bg-rose-50 text-rose-700', Icon: AlarmClockOff }
        : answeredCount > 0
          ? { label: t('assignments.status_in_progress', { defaultValue: 'In progress' }), tone: 'bg-sky-50 text-sky-700', Icon: PencilLine }
          : { label: t('assignments.status_not_started', { defaultValue: 'Not started' }), tone: 'bg-neutral-100 text-neutral-600', Icon: Circle }

  const progress = tasks.length > 0 ? Math.round((answeredCount / tasks.length) * 100) : 0
  const metaItem = 'flex items-center gap-1.5'

  return (
    <div className='flex flex-col gap-4 md:gap-5'>
      {/* Overview: what this is, when it's due, how far along the learner is. */}
      <div className='rounded-2xl bg-white nice-shadow overflow-hidden'>
        <div className='flex flex-col gap-4 p-4 sm:p-5'>
          <div className='flex items-start justify-between gap-3'>
            <div className='flex items-center gap-3 min-w-0'>
              <span className='flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-teal-50 text-teal-700'>
                <ClipboardList size={19} />
              </span>
              <div className='min-w-0'>
                <p className='text-[11px] font-semibold uppercase tracking-wider text-neutral-400'>{t('activities.assignment')}</p>
                <p className='text-sm font-semibold text-neutral-900 tabular-nums'>
                  {t('assignments.answered_progress', { answered: answeredCount, total: tasks.length, defaultValue: '{{answered}} of {{total}} answered' })}
                </p>
              </div>
            </div>
            <span className={`flex flex-none items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${status.tone}`}>
              <status.Icon size={13} />
              {status.label}
            </span>
          </div>

          <div className='h-1.5 w-full overflow-hidden rounded-full bg-neutral-100'>
            <div
              className={`h-full rounded-full transition-[width] duration-500 ${isGraded || isSubmitted ? 'bg-emerald-500' : 'bg-teal-500'}`}
              style={{ width: `${isGraded || isSubmitted ? 100 : progress}%` }}
            />
          </div>

          <div className='flex flex-wrap items-center gap-x-4 gap-y-2 text-xs font-medium text-neutral-500'>
            {dueDateRaw && (
              <span className={`${metaItem} ${isPastDue && isAwaitingSubmission ? 'text-rose-600' : ''}`}>
                <Calendar size={13} />
                {t('assignments.due_on', { date: dueDateLabel, defaultValue: 'Due {{date}}' })}
              </span>
            )}
            <span className={metaItem}>
              <ListChecks size={13} />
              {t('assignments.tasks_count', { count: tasks.length, defaultValue: '{{count}} tasks' })}
            </span>
            {!isUngraded && totalPoints > 0 && (
              <span className={`${metaItem} tabular-nums`}>
                <Trophy size={13} />
                {totalPoints} {t('assignments.points')}
              </span>
            )}
            {isUngraded && (
              <span className={metaItem}>
                <ClipboardCheck size={13} />
                {t('assignments.ungraded_badge', { defaultValue: 'Not graded' })}
              </span>
            )}
            {showAttemptBadge && (
              <span className={metaItem}>
                <RotateCcw size={13} />
                {maxRetries
                  ? t('assignments.attempt_count_bounded', { current: currentAttempt, max: maxRetries })
                  : t('assignments.attempt_count', { current: currentAttempt })}
              </span>
            )}
          </div>
        </div>

        {assignments?.assignment_object?.description && (
          <div className='border-t border-neutral-100 px-4 sm:px-5 py-4'>
            <p className='text-sm leading-relaxed text-neutral-700 whitespace-pre-wrap'>{assignments.assignment_object.description}</p>
          </div>
        )}
      </div>

      {/* Overdue notice. The server 403s every save/submit once the deadline has
          passed, so say it plainly instead of letting auto-save fail silently. */}
      {isPastDue && !isGraded && !isSubmitted && (
        <div className='flex items-start gap-3 rounded-2xl border border-rose-200/70 bg-rose-50/70 p-4'>
          <AlarmClockOff size={18} className='mt-0.5 shrink-0 text-rose-500' />
          <div className='flex flex-col gap-0.5'>
            <p className='text-sm font-semibold text-rose-700'>
              {t('assignments.past_due_title', { defaultValue: 'Deadline passed' })}
            </p>
            <p className='text-sm leading-relaxed text-rose-600/90'>
              {t('assignments.past_due_description', {
                date: dueDateLabel,
                defaultValue: 'This assignment was due on {{date}}. Answers can no longer be saved or submitted for grading.',
              })}
            </p>
          </div>
        </div>
      )}

      {/* Score summary once the work is graded. */}
      {isGraded && !isUngraded && totalPoints > 0 && (
        <div className={`flex items-center gap-4 rounded-2xl p-4 sm:p-5 nice-shadow ${scorePassed ? 'bg-emerald-50/70' : 'bg-rose-50/70'}`}>
          <div className='relative h-16 w-16 flex-none'>
            <svg viewBox='0 0 36 36' className='h-16 w-16 -rotate-90'>
              <circle cx='18' cy='18' r='15.5' fill='none' strokeWidth='3.5' className='stroke-white' />
              <circle
                cx='18' cy='18' r='15.5' fill='none' strokeWidth='3.5' strokeLinecap='round'
                className={scorePassed ? 'stroke-emerald-500' : 'stroke-rose-500'}
                strokeDasharray={`${(Math.max(0, Math.min(100, scorePercentage)) / 100) * 97.4} 97.4`}
              />
            </svg>
            <span className='absolute inset-0 flex items-center justify-center text-sm font-bold text-neutral-900 tabular-nums'>{scorePercentage}%</span>
          </div>
          <div className='min-w-0'>
            <p className={`text-xs font-semibold uppercase tracking-wider ${scorePassed ? 'text-emerald-700' : 'text-rose-700'}`}>
              {scorePassed ? t('assignments.task_passed') : t('assignments.task_not_passed')}
            </p>
            <p className='text-lg font-bold text-neutral-900 tabular-nums'>
              {earnedPoints} / {totalPoints} {t('assignments.points')}
            </p>
            <p className='text-xs text-neutral-500'>{t('assignments.your_score', { defaultValue: 'Your score' })}</p>
          </div>
        </div>
      )}

      {/* Model answer ("corrigé"). Locked, this is only a promise: the text and
          the document are withheld by the API until the learner hands their
          work in, so there is nothing here to read early. */}
      {hasSolution && !solutionUnlocked && (
        <div className='flex items-start gap-3 rounded-2xl bg-neutral-50 p-4 border border-neutral-200/70'>
          <Lock size={16} className='mt-0.5 shrink-0 text-neutral-400' />
          <div className='flex flex-col gap-0.5'>
            <p className='text-sm font-semibold text-neutral-700'>
              {t('assignments.solution_locked_title', { defaultValue: 'Model answer locked' })}
            </p>
            <p className='text-sm leading-relaxed text-neutral-500'>
              {solutionRevealsOnSubmission
                ? t('assignments.solution_locked_on_submission', { defaultValue: 'Hand your work in and the model answer unlocks right away.' })
                : t('assignments.solution_locked_after_grading', { defaultValue: 'The model answer unlocks once your work has been graded.' })}
            </p>
          </div>
        </div>
      )}

      {solutionUnlocked && (solutionText || solutionFile) && (
        <div className='flex flex-col gap-3 rounded-2xl border border-teal-200/70 bg-teal-50/60 p-4 sm:p-5'>
          <div className='flex items-center gap-2 text-teal-800'>
            <BookOpenCheck size={16} className='text-teal-600' />
            <h3 className='text-sm font-semibold'>
              {t('assignments.solution_title', { defaultValue: 'Model answer' })}
            </h3>
          </div>
          {solutionText && (
            <p className='text-sm leading-relaxed text-neutral-700 whitespace-pre-wrap'>{solutionText}</p>
          )}
          {solutionFile && (
            <Link
              href={getAssignmentSolutionFileDir(
                org?.org_uuid,
                assignments?.course_object.course_uuid,
                assignments?.activity_object.activity_uuid,
                assignments?.assignment_object.assignment_uuid,
                solutionFile
              )}
              target='_blank'
              download={true}
              className='flex h-10 w-fit items-center gap-2 rounded-xl bg-white px-3.5 text-sm font-semibold text-teal-800 nice-shadow'>
              <Download size={14} />
              {t('assignments.solution_download', { defaultValue: 'Download the model answer' })}
            </Link>
          )}
        </div>
      )}

      {tasks.map((task: any, index: number) => {
        const taskSubmission = taskSubmissionsMap ? taskSubmissionsMap[task.assignment_task_uuid] : null;
        const taskGrade = taskSubmission?.grade ?? 0;
        const taskMax = task.max_grade_value || 0;
        const taskFeedback = (taskSubmission?.task_submission_grade_feedback || '').trim();
        const taskPercentage = taskMax > 0 ? Math.round((taskGrade / taskMax) * 100) : 0;
        const taskPassed = taskPercentage >= passingThreshold;
        const answered = taskSubmissionHasAnswer(taskSubmission);
        const showResult = isGraded && !isUngraded && !!taskSubmission;

        return (
          <section
            key={task.assignment_task_uuid}
            aria-labelledby={`task-${task.assignment_task_uuid}`}
            className='rounded-2xl bg-white nice-shadow'
          >
            <header className='flex items-start gap-3 px-4 sm:px-5 pt-4 sm:pt-5'>
              <span
                className={`mt-0.5 flex h-7 w-7 flex-none items-center justify-center rounded-full text-xs font-bold tabular-nums ${
                  showResult
                    ? taskPassed ? 'bg-emerald-500 text-white' : 'bg-rose-500 text-white'
                    : answered ? 'bg-teal-600 text-white' : 'bg-neutral-100 text-neutral-600'
                }`}
              >
                {showResult ? (taskPassed ? <Check size={14} strokeWidth={3} /> : <X size={14} strokeWidth={3} />) : index + 1}
              </span>
              <div className='min-w-0 flex-1'>
                <p className='text-[11px] font-semibold uppercase tracking-wider text-neutral-400'>
                  {t('assignments.task')} {index + 1}
                </p>
                <h3 id={`task-${task.assignment_task_uuid}`} className='text-base font-semibold leading-snug text-neutral-900 break-words'>
                  {task.description}
                </h3>
                {(task.hint || task.reference_file) && (
                  <div className='mt-2 flex flex-wrap gap-2'>
                    {task.hint && (
                      <button
                        type='button'
                        onClick={() => toast(task.hint, { icon: '💡' })}
                        className='flex h-8 items-center gap-1.5 rounded-full bg-amber-50 px-3 text-xs font-semibold text-amber-800 transition-colors hover:bg-amber-100'>
                        <Lightbulb size={13} />
                        {t('assignments.hint')}
                      </button>
                    )}
                    {task.reference_file && (
                      <Link
                        href={getTaskRefFileDir(
                          org?.org_uuid,
                          assignments?.course_object.course_uuid,
                          assignments?.activity_object.activity_uuid,
                          assignments?.assignment_object.assignment_uuid,
                          task.assignment_task_uuid,
                          task.reference_file
                        )}
                        target='_blank'
                        download={true}
                        className='flex h-8 items-center gap-1.5 rounded-full bg-sky-50 px-3 text-xs font-semibold text-sky-800 transition-colors hover:bg-sky-100'>
                        <Download size={13} />
                        {t('assignments.reference_document')}
                      </Link>
                    )}
                  </div>
                )}
              </div>
              {!isUngraded && taskMax > 0 && (
                <span className={`flex-none rounded-full px-2.5 py-1 text-xs font-semibold tabular-nums ${
                  showResult
                    ? taskPassed ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'
                    : 'bg-neutral-100 text-neutral-600'
                }`}>
                  {showResult ? `${taskGrade}/${taskMax}` : taskMax} {t('assignments.points')}
                </span>
              )}
            </header>

            {showResult && taskFeedback && (
              <div className='mx-4 sm:mx-5 mt-3 flex items-start gap-2 rounded-xl bg-neutral-50 p-3'>
                <MessageSquare size={14} className='mt-0.5 shrink-0 text-neutral-400' />
                <p className='text-sm leading-relaxed text-neutral-700 whitespace-pre-wrap'>{taskFeedback}</p>
              </div>
            )}

            {/* Key by attempt number so a retry (which wipes the server-side
                answers) remounts the editors fresh; they re-hydrate from the
                now-empty submission instead of keeping the previous attempt's
                answers as a stale saved baseline (which would submit empty ->
                0% on the next attempt). */}
            <div className='px-4 sm:px-5 pt-4 pb-4 sm:pb-5'>
              {task.assignment_type === 'QUIZ' && <TaskQuizObject key={`${task.assignment_task_uuid}-${currentAttempt}`} view='student' assignmentTaskUUID={task.assignment_task_uuid} />}
              {task.assignment_type === 'FILE_SUBMISSION' && <TaskFileObject key={`${task.assignment_task_uuid}-${currentAttempt}`} view='student' assignmentTaskUUID={task.assignment_task_uuid} />}
              {task.assignment_type === 'FORM' && <TaskFormObject key={`${task.assignment_task_uuid}-${currentAttempt}`} view='student' assignmentTaskUUID={task.assignment_task_uuid} />}
              {task.assignment_type === 'CODE' && <TaskCodeObject key={`${task.assignment_task_uuid}-${currentAttempt}`} view='student' assignmentTaskUUID={task.assignment_task_uuid} />}
              {task.assignment_type === 'SHORT_ANSWER' && <TaskShortAnswerObject key={`${task.assignment_task_uuid}-${currentAttempt}`} view='student' assignmentTaskUUID={task.assignment_task_uuid} />}
              {task.assignment_type === 'NUMBER_ANSWER' && <TaskNumberAnswerObject key={`${task.assignment_task_uuid}-${currentAttempt}`} view='student' assignmentTaskUUID={task.assignment_task_uuid} />}
            </div>
          </section>
        )
      })}

      {/* Where the work ends: hand it in, or see where it stands. The button
          opens the same confirmation as the activity bar's submit control. */}
      {tasks.length > 0 && isAwaitingSubmission && !isPastDue && (
        <div className='flex flex-col sm:flex-row sm:items-center gap-4 rounded-2xl bg-neutral-900 p-4 sm:p-5 text-white'>
          <div className='min-w-0 flex-1'>
            <p className='text-base font-semibold'>{t('assignments.handin_ready_title', { defaultValue: 'Ready to hand in?' })}</p>
            <p className='mt-0.5 text-sm text-neutral-300'>
              {t('assignments.answered_progress', { answered: answeredCount, total: tasks.length, defaultValue: '{{answered}} of {{total}} answered' })}
              {' · '}
              {t('assignments.handin_ready_body', { defaultValue: 'Your answers save automatically.' })}
            </p>
          </div>
          <button
            type='button'
            onClick={() => window.dispatchEvent(new Event(ASSIGNMENT_SUBMIT_EVENT))}
            className='lh-press flex h-11 flex-none items-center justify-center gap-2 rounded-xl bg-white px-5 text-sm font-semibold text-neutral-900 transition-colors hover:bg-neutral-100'>
            <Send size={15} />
            {isUngraded ? t('assignments.hand_in', { defaultValue: 'Hand in my work' }) : t('assignments.submit_for_grading')}
          </button>
        </div>
      )}
      {isSubmitted && !isUngraded && (
        <div className='flex items-start gap-3 rounded-2xl bg-amber-50/70 p-4 sm:p-5'>
          <Hourglass size={18} className='mt-0.5 shrink-0 text-amber-600' />
          <div>
            <p className='text-sm font-semibold text-amber-800'>{t('assignments.grading_in_progress')}</p>
            <p className='text-sm text-amber-700/90'>
              {t('assignments.awaiting_grade_body', { defaultValue: "Your work is with your teacher. Your score will show here once it's graded." })}
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

export default AssignmentStudentActivity
