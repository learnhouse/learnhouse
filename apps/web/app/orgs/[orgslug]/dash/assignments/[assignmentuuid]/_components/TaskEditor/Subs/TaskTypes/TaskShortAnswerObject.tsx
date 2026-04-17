'use client'
import { useAssignments } from '@components/Contexts/Assignments/AssignmentContext'
import { useAssignmentSubmission } from '@components/Contexts/Assignments/AssignmentSubmissionContext'
import {
  useAssignmentsTask,
  useAssignmentsTaskDispatch,
} from '@components/Contexts/Assignments/AssignmentsTaskContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import AssignmentBoxUI from '@components/Objects/Activities/Assignment/AssignmentBoxUI'
import {
  getAssignmentTask,
  getAssignmentTaskSubmissionsMe,
  getAssignmentTaskSubmissionsUser,
  handleAssignmentTaskSubmission,
  updateAssignmentTask,
} from '@services/courses/assignments'
import { CheckCircle2, Plus, X, XCircle } from 'lucide-react'
import React, { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { useTranslation } from 'react-i18next'

type MatchMode = 'exact' | 'case_insensitive' | 'contains' | 'regex'

type ShortAnswerContents = {
  prompt: string
  correct_answers: string[]
  match_mode: MatchMode
  explanation?: string
}

type TaskShortAnswerObjectProps = {
  view: 'teacher' | 'student' | 'grading'
  assignmentTaskUUID?: string
  user_id?: string
}

const DEFAULT_CONTENTS: ShortAnswerContents = {
  prompt: '',
  correct_answers: [''],
  match_mode: 'case_insensitive',
  explanation: '',
}

// NOTE: the student's answer is NOT checked in the browser. Grading runs
// server-side via _check_short_answer in assignments.py so students can't
// tamper with the grade via DevTools and so the "save draft" pattern works
// (save repeatedly without giving away whether the answer is correct).

function normalizeContents(raw: any): ShortAnswerContents {
  return {
    prompt: raw?.prompt ?? '',
    correct_answers:
      Array.isArray(raw?.correct_answers) && raw.correct_answers.length > 0
        ? raw.correct_answers
        : [''],
    match_mode: (raw?.match_mode as MatchMode) ?? 'case_insensitive',
    explanation: raw?.explanation ?? '',
  }
}

function TaskShortAnswerObject({
  view,
  assignmentTaskUUID,
  user_id,
}: TaskShortAnswerObjectProps) {
  const { t } = useTranslation()
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token
  const assignmentTaskState = useAssignmentsTask() as any
  const assignmentTaskStateHook = useAssignmentsTaskDispatch() as any
  const assignment = useAssignments() as any
  // Student-only reveal: after the submission is GRADED and the teacher
  // opted into showing correct answers, inline the accepted answer list
  // next to the student's input.
  const assignmentSubmission = useAssignmentSubmission() as any
  const submissionIsGraded = Array.isArray(assignmentSubmission)
    && assignmentSubmission.length > 0
    && assignmentSubmission[0].submission_status === 'GRADED'
  const showCorrectAnswers = view === 'student'
    && submissionIsGraded
    && !!assignment?.assignment_object?.show_correct_answers

  const [contents, setContents] = useState<ShortAnswerContents>(DEFAULT_CONTENTS)
  const [studentAnswer, setStudentAnswer] = useState<string>('')
  const [initialAnswer, setInitialAnswer] = useState<string>('')
  const [showSavingDisclaimer, setShowSavingDisclaimer] = useState(false)

  const [userSubmissions, setUserSubmissions] = useState<any>(null)
  const [userSubmissionObject, setUserSubmissionObject] = useState<any>(null)
  const [assignmentTaskOutsideProvider, setAssignmentTaskOutsideProvider] =
    useState<any>(null)

  // --- TEACHER VIEW: load existing contents into local state ------------
  useEffect(() => {
    if (view === 'teacher' && assignmentTaskState?.assignmentTask?.contents) {
      const c = assignmentTaskState.assignmentTask.contents
      if (c.prompt !== undefined || Array.isArray(c.correct_answers)) {
        setContents(normalizeContents(c))
      }
    }
  }, [view, assignmentTaskState])

  // --- STUDENT / GRADING VIEW: load task definition + user submission ---
  async function loadTaskDefinition() {
    if (!assignmentTaskUUID) return
    const res = await getAssignmentTask(assignmentTaskUUID, access_token)
    if (res.success) {
      setAssignmentTaskOutsideProvider(res.data)
      if (res.data.contents) {
        setContents(normalizeContents(res.data.contents))
      }
    }
  }

  async function loadOwnSubmission() {
    if (!assignmentTaskUUID) return
    const res = await getAssignmentTaskSubmissionsMe(
      assignmentTaskUUID,
      assignment.assignment_object.assignment_uuid,
      access_token
    )
    if (res.success && res.data) {
      setUserSubmissions(res.data)
      const saved = res.data.task_submission?.answer ?? ''
      setStudentAnswer(saved)
      setInitialAnswer(saved)
    }
  }

  async function loadUserSubmission() {
    if (!assignmentTaskUUID || !user_id) return
    const res = await getAssignmentTaskSubmissionsUser(
      assignmentTaskUUID,
      user_id,
      assignment.assignment_object.assignment_uuid,
      access_token
    )
    if (res.success && res.data) {
      setUserSubmissions(res.data)
      setUserSubmissionObject(res.data)
      const saved = res.data.task_submission?.answer ?? ''
      setStudentAnswer(saved)
      setInitialAnswer(saved)
    }
  }

  useEffect(() => {
    if (view === 'student') {
      loadTaskDefinition()
      loadOwnSubmission()
    } else if (view === 'grading') {
      loadTaskDefinition()
      loadUserSubmission()
    }
  }, [view, assignmentTaskUUID, assignment, access_token])

  useEffect(() => {
    if (view === 'student') {
      setShowSavingDisclaimer(studentAnswer !== initialAnswer)
    }
  }, [studentAnswer, initialAnswer, view])

  // --- SAVE (teacher) ---
  async function saveFC() {
    if (!assignmentTaskState?.assignmentTask?.assignment_task_uuid) return
    // Drop empty correct_answers so the teacher can't accidentally save a
    // task with one all-blank entry that would never match.
    const cleanedAnswers = contents.correct_answers
      .map((a) => a.trim())
      .filter((a) => a.length > 0)
    if (cleanedAnswers.length === 0) {
      toast.error(t('dashboard.assignments.editor.task_editor.short_answer.no_answers_error'))
      return
    }
    const updatedContents: ShortAnswerContents = {
      ...contents,
      correct_answers: cleanedAnswers,
    }
    const res = await updateAssignmentTask(
      { contents: updatedContents },
      assignmentTaskState.assignmentTask.assignment_task_uuid,
      assignment.assignment_object.assignment_uuid,
      access_token
    )
    if (res.success) {
      assignmentTaskStateHook({ type: 'reload' })
      toast.success(t('dashboard.assignments.editor.toasts.task_updated'))
    } else {
      toast.error(t('dashboard.assignments.editor.toasts.task_update_error'))
    }
  }

  // --- SAVE PROGRESS (student) ---
  // Matches the QUIZ / FORM pattern: just persist the student's answer. We
  // deliberately send grade=0 and no feedback — the actual grading happens
  // server-side when the student submits the whole assignment for grading
  // (which triggers _server_verified_task_grade in the backend), or when
  // the teacher clicks "Set final grade" in the EvaluateAssignment modal.
  // This lets the student save drafts without being told whether they got
  // it right, and prevents client-side tampering (the backend re-grades
  // from the stored answer no matter what the client sends).
  async function submitFC() {
    if (!assignmentTaskUUID) return
    const values = {
      assignment_task_submission_uuid:
        userSubmissions?.assignment_task_submission_uuid || null,
      task_submission: {
        answer: studentAnswer,
      },
      grade: 0,
      task_submission_grade_feedback: '',
    }
    const res = await handleAssignmentTaskSubmission(
      values,
      assignmentTaskUUID,
      assignment.assignment_object.assignment_uuid,
      access_token
    )
    if (res.success) {
      setUserSubmissions(res.data)
      setInitialAnswer(studentAnswer)
      setShowSavingDisclaimer(false)
      toast.success(t('dashboard.assignments.editor.toasts.task_saved'))
    } else {
      toast.error(t('dashboard.assignments.editor.toasts.task_save_error'))
    }
  }

  // --- TEACHER helpers ---
  function addAnswer() {
    setContents((prev) => ({
      ...prev,
      correct_answers: [...prev.correct_answers, ''],
    }))
  }

  function removeAnswer(index: number) {
    setContents((prev) => ({
      ...prev,
      correct_answers: prev.correct_answers.filter((_, i) => i !== index),
    }))
  }

  function updateAnswer(index: number, value: string) {
    setContents((prev) => ({
      ...prev,
      correct_answers: prev.correct_answers.map((a, i) => (i === index ? value : a)),
    }))
  }

  // --- GRADING helpers ---
  const gradedPassed = userSubmissionObject?.grade > 0

  return (
    <AssignmentBoxUI
      type="form"
      view={view}
      saveFC={saveFC}
      submitFC={submitFC}
      currentPoints={userSubmissionObject?.grade}
      maxPoints={
        assignmentTaskOutsideProvider?.max_grade_value ||
        assignmentTaskState?.assignmentTask?.max_grade_value
      }
      showSavingDisclaimer={showSavingDisclaimer}
    >
      <div className="flex flex-col space-y-4">
        {/* === TEACHER VIEW === */}
        {view === 'teacher' && (
          <>
            <div className="flex flex-col space-y-1">
              <label className="text-xs font-semibold text-slate-500">
                {t('dashboard.assignments.editor.task_editor.short_answer.prompt_label')}
              </label>
              <textarea
                value={contents.prompt}
                onChange={(e) =>
                  setContents((prev) => ({ ...prev, prompt: e.target.value }))
                }
                placeholder={t(
                  'dashboard.assignments.editor.task_editor.short_answer.prompt_placeholder'
                )}
                rows={2}
                className="px-3 py-2 text-sm border border-gray-200 rounded-md bg-white resize-y"
              />
            </div>

            <div className="flex flex-col space-y-1">
              <label className="text-xs font-semibold text-slate-500">
                {t('dashboard.assignments.editor.task_editor.short_answer.match_mode_label')}
              </label>
              <select
                value={contents.match_mode}
                onChange={(e) =>
                  setContents((prev) => ({
                    ...prev,
                    match_mode: e.target.value as MatchMode,
                  }))
                }
                className="px-3 py-1.5 text-sm border border-gray-200 rounded-md bg-white"
              >
                <option value="case_insensitive">
                  {t('dashboard.assignments.editor.task_editor.short_answer.match_modes.case_insensitive')}
                </option>
                <option value="exact">
                  {t('dashboard.assignments.editor.task_editor.short_answer.match_modes.exact')}
                </option>
                <option value="contains">
                  {t('dashboard.assignments.editor.task_editor.short_answer.match_modes.contains')}
                </option>
                <option value="regex">
                  {t('dashboard.assignments.editor.task_editor.short_answer.match_modes.regex')}
                </option>
              </select>
            </div>

            <div className="flex flex-col space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-slate-500">
                  {t('dashboard.assignments.editor.task_editor.short_answer.answers_label')}
                </label>
                <button
                  onClick={addAnswer}
                  type="button"
                  className="flex items-center space-x-1 text-xs font-semibold text-emerald-600 hover:text-emerald-700"
                >
                  <Plus size={14} />
                  <span>{t('dashboard.assignments.editor.task_editor.short_answer.add_answer')}</span>
                </button>
              </div>
              {contents.correct_answers.map((answer, index) => (
                <div key={index} className="flex items-center space-x-2">
                  <input
                    value={answer}
                    onChange={(e) => updateAnswer(index, e.target.value)}
                    placeholder={t(
                      'dashboard.assignments.editor.task_editor.short_answer.answer_placeholder'
                    )}
                    className="flex-1 px-3 py-1.5 text-sm border border-gray-200 rounded-md bg-white"
                  />
                  {contents.correct_answers.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeAnswer(index)}
                      className="w-7 h-7 flex items-center justify-center rounded-md bg-slate-100 text-slate-400 hover:bg-red-100 hover:text-red-500"
                    >
                      <X size={13} />
                    </button>
                  )}
                </div>
              ))}
            </div>

            <div className="flex flex-col space-y-1">
              <label className="text-xs font-semibold text-slate-500">
                {t('dashboard.assignments.editor.task_editor.short_answer.explanation_label')}
              </label>
              <textarea
                value={contents.explanation ?? ''}
                onChange={(e) =>
                  setContents((prev) => ({ ...prev, explanation: e.target.value }))
                }
                placeholder={t(
                  'dashboard.assignments.editor.task_editor.short_answer.explanation_placeholder'
                )}
                rows={2}
                className="px-3 py-2 text-sm border border-gray-200 rounded-md bg-white resize-y"
              />
            </div>
          </>
        )}

        {/* === STUDENT VIEW === */}
        {/* No Correct/Incorrect banner here — saving is just persisting a
            draft. The student learns their grade after the whole assignment
            is submitted + graded (visible in the activity header badge). */}
        {view === 'student' && (
          <>
            {contents.prompt && (
              <p className="text-sm text-slate-700 whitespace-pre-wrap">{contents.prompt}</p>
            )}
            <input
              value={studentAnswer}
              onChange={(e) => !submissionIsGraded && setStudentAnswer(e.target.value)}
              readOnly={submissionIsGraded}
              placeholder={t(
                'dashboard.assignments.editor.task_editor.short_answer.your_answer_placeholder'
              )}
              className="w-full px-3 py-2 text-sm border-2 border-gray-200 rounded-md bg-white focus:border-blue-400 focus:ring-2 focus:ring-blue-200 outline-none"
            />
            {showCorrectAnswers && contents.correct_answers.length > 0 && (
              <div className="flex flex-col space-y-1.5 p-3 rounded-md bg-emerald-50 border border-emerald-200">
                <div className="flex items-center space-x-1.5 text-xs font-semibold text-emerald-700">
                  <CheckCircle2 size={13} />
                  <span>{t('dashboard.assignments.editor.task_editor.short_answer.accepted_answers_label')}</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {contents.correct_answers.map((answer, i) => (
                    <span
                      key={i}
                      className="px-2 py-0.5 text-xs font-medium bg-white text-emerald-700 rounded-md"
                    >
                      {answer}
                    </span>
                  ))}
                </div>
                {contents.explanation && (
                  <p className="text-xs text-emerald-800/80 mt-1 whitespace-pre-wrap">{contents.explanation}</p>
                )}
              </div>
            )}
          </>
        )}

        {/* === GRADING VIEW === */}
        {view === 'grading' && (
          <>
            {contents.prompt && (
              <p className="text-sm text-slate-700 whitespace-pre-wrap">{contents.prompt}</p>
            )}
            <div className="flex flex-col space-y-1">
              <label className="text-xs font-semibold text-slate-500">
                {t('dashboard.assignments.editor.task_editor.short_answer.student_answer_label')}
              </label>
              <div className="px-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-md">
                {studentAnswer || (
                  <span className="text-gray-400 italic">
                    {t('dashboard.assignments.editor.task_editor.short_answer.no_answer')}
                  </span>
                )}
              </div>
            </div>
            <div className="flex flex-col space-y-1">
              <label className="text-xs font-semibold text-slate-500">
                {t('dashboard.assignments.editor.task_editor.short_answer.accepted_answers_label')}
              </label>
              <div className="flex flex-wrap gap-1.5">
                {contents.correct_answers.map((answer, i) => (
                  <span
                    key={i}
                    className="px-2 py-0.5 text-xs font-medium bg-emerald-100 text-emerald-700 rounded-md"
                  >
                    {answer}
                  </span>
                ))}
              </div>
            </div>
            <div
              className={`flex items-center space-x-2 p-2.5 rounded-md text-xs font-semibold ${
                gradedPassed
                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                  : 'bg-rose-50 text-rose-700 border border-rose-200'
              }`}
            >
              {gradedPassed ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
              <span>
                {gradedPassed
                  ? t('dashboard.assignments.editor.task_editor.short_answer.correct')
                  : t('dashboard.assignments.editor.task_editor.short_answer.incorrect')}
              </span>
            </div>
          </>
        )}
      </div>
    </AssignmentBoxUI>
  )
}

export default TaskShortAnswerObject
