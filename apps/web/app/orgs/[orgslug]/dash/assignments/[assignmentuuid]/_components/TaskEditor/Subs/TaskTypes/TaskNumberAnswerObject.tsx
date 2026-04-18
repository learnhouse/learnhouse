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
import { CheckCircle2, XCircle } from 'lucide-react'
import React, { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { useTranslation } from 'react-i18next'

type NumberAnswerContents = {
  prompt: string
  correct_value: number
  tolerance: number      // absolute ± tolerance in the same units as correct_value
  unit?: string          // optional display unit like "m/s²" or "kg"
  explanation?: string
}

type TaskNumberAnswerObjectProps = {
  view: 'teacher' | 'student' | 'grading'
  assignmentTaskUUID?: string
  user_id?: string
}

const DEFAULT_CONTENTS: NumberAnswerContents = {
  prompt: '',
  correct_value: 0,
  tolerance: 0,
  unit: '',
  explanation: '',
}

// NOTE: numeric grading runs server-side via _check_number_answer in
// assignments.py. The student's answer is stored as-is on save; the backend
// re-parses and compares against correct_value ± tolerance during finalize.

function normalizeContents(raw: any): NumberAnswerContents {
  return {
    prompt: raw?.prompt ?? '',
    correct_value: Number.isFinite(raw?.correct_value) ? raw.correct_value : 0,
    tolerance: Number.isFinite(raw?.tolerance) ? raw.tolerance : 0,
    unit: raw?.unit ?? '',
    explanation: raw?.explanation ?? '',
  }
}

function TaskNumberAnswerObject({
  view,
  assignmentTaskUUID,
  user_id,
}: TaskNumberAnswerObjectProps) {
  const { t } = useTranslation()
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token
  const assignmentTaskState = useAssignmentsTask() as any
  const assignmentTaskStateHook = useAssignmentsTaskDispatch() as any
  const assignment = useAssignments() as any
  // Same reveal gate as the other task types: teacher must opt in, and the
  // submission must already be GRADED before any correct-answer hint appears.
  const assignmentSubmission = useAssignmentSubmission() as any
  const submissionIsGraded = Array.isArray(assignmentSubmission)
    && assignmentSubmission.length > 0
    && assignmentSubmission[0].submission_status === 'GRADED'
  const showCorrectAnswers = view === 'student'
    && submissionIsGraded
    && !!assignment?.assignment_object?.show_correct_answers

  const [contents, setContents] = useState<NumberAnswerContents>(DEFAULT_CONTENTS)
  const [studentAnswer, setStudentAnswer] = useState<string>('')
  const [initialAnswer, setInitialAnswer] = useState<string>('')
  const [showSavingDisclaimer, setShowSavingDisclaimer] = useState(false)

  const [userSubmissions, setUserSubmissions] = useState<any>(null)
  const [userSubmissionObject, setUserSubmissionObject] = useState<any>(null)
  const [assignmentTaskOutsideProvider, setAssignmentTaskOutsideProvider] =
    useState<any>(null)

  // --- TEACHER VIEW ---
  useEffect(() => {
    if (view === 'teacher' && assignmentTaskState?.assignmentTask?.contents) {
      const c = assignmentTaskState.assignmentTask.contents
      if (c.prompt !== undefined || c.correct_value !== undefined) {
        setContents(normalizeContents(c))
      }
    }
  }, [view, assignmentTaskState])

  // --- STUDENT / GRADING VIEW ---
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
      setStudentAnswer(String(saved))
      setInitialAnswer(String(saved))
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
      setStudentAnswer(String(saved))
      setInitialAnswer(String(saved))
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
    const res = await updateAssignmentTask(
      { contents },
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
  // Matches the QUIZ / FORM pattern: persist the draft answer only. Grading
  // is done server-side via _server_verified_task_grade when the assignment
  // is finalized — either by the auto-grade path on submission or by the
  // teacher clicking "Set final grade". Keeping the client out of the
  // grading loop also means DevTools tampering can't inflate the score.
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

  const gradedPassed = userSubmissionObject?.grade > 0

  // For display in grading view: e.g. "9.81 ± 0.05 m/s²"
  const acceptedRange =
    contents.tolerance > 0
      ? `${contents.correct_value} ± ${contents.tolerance}${contents.unit ? ' ' + contents.unit : ''}`
      : `${contents.correct_value}${contents.unit ? ' ' + contents.unit : ''}`

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
                {t('dashboard.assignments.editor.task_editor.number_answer.prompt_label')}
              </label>
              <textarea
                value={contents.prompt}
                onChange={(e) =>
                  setContents((prev) => ({ ...prev, prompt: e.target.value }))
                }
                placeholder={t(
                  'dashboard.assignments.editor.task_editor.number_answer.prompt_placeholder'
                )}
                rows={2}
                className="px-3 py-2 text-sm border border-gray-200 rounded-md bg-white resize-y"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col space-y-1">
                <label className="text-xs font-semibold text-slate-500">
                  {t('dashboard.assignments.editor.task_editor.number_answer.correct_value_label')}
                </label>
                <input
                  type="number"
                  step="any"
                  value={contents.correct_value}
                  onChange={(e) =>
                    setContents((prev) => ({
                      ...prev,
                      correct_value: Number.parseFloat(e.target.value) || 0,
                    }))
                  }
                  className="px-3 py-1.5 text-sm border border-gray-200 rounded-md bg-white"
                />
              </div>
              <div className="flex flex-col space-y-1">
                <label className="text-xs font-semibold text-slate-500">
                  {t('dashboard.assignments.editor.task_editor.number_answer.tolerance_label')}
                </label>
                <input
                  type="number"
                  step="any"
                  min={0}
                  value={contents.tolerance}
                  onChange={(e) =>
                    setContents((prev) => ({
                      ...prev,
                      tolerance: Math.max(0, Number.parseFloat(e.target.value) || 0),
                    }))
                  }
                  className="px-3 py-1.5 text-sm border border-gray-200 rounded-md bg-white"
                />
              </div>
            </div>

            <div className="flex flex-col space-y-1">
              <label className="text-xs font-semibold text-slate-500">
                {t('dashboard.assignments.editor.task_editor.number_answer.unit_label')}
              </label>
              <input
                value={contents.unit ?? ''}
                onChange={(e) =>
                  setContents((prev) => ({ ...prev, unit: e.target.value }))
                }
                placeholder={t(
                  'dashboard.assignments.editor.task_editor.number_answer.unit_placeholder'
                )}
                className="px-3 py-1.5 text-sm border border-gray-200 rounded-md bg-white"
              />
              <p className="text-[10px] text-slate-400">
                {t('dashboard.assignments.editor.task_editor.number_answer.unit_hint')}
              </p>
            </div>

            <div className="flex flex-col space-y-1">
              <label className="text-xs font-semibold text-slate-500">
                {t('dashboard.assignments.editor.task_editor.number_answer.explanation_label')}
              </label>
              <textarea
                value={contents.explanation ?? ''}
                onChange={(e) =>
                  setContents((prev) => ({ ...prev, explanation: e.target.value }))
                }
                placeholder={t(
                  'dashboard.assignments.editor.task_editor.number_answer.explanation_placeholder'
                )}
                rows={2}
                className="px-3 py-2 text-sm border border-gray-200 rounded-md bg-white resize-y"
              />
            </div>

            <div className="flex items-center space-x-1.5 text-[11px] text-slate-500 bg-slate-50 rounded-md px-2.5 py-1.5">
              <span>{t('dashboard.assignments.editor.task_editor.number_answer.preview_label')}:</span>
              <span className="font-mono font-semibold text-slate-700">
                {acceptedRange}
              </span>
            </div>
          </>
        )}

        {/* === STUDENT VIEW === */}
        {/* Saving is just persisting a draft — no Correct/Incorrect feedback
            here. The student sees their grade after the whole assignment is
            graded (visible in the activity header badge). */}
        {view === 'student' && (
          <>
            {contents.prompt && (
              <p className="text-sm text-slate-700 whitespace-pre-wrap">{contents.prompt}</p>
            )}
            <div className="flex items-center space-x-2">
              <input
                type="text"
                inputMode="decimal"
                value={studentAnswer}
                onChange={(e) => !submissionIsGraded && setStudentAnswer(e.target.value)}
                readOnly={submissionIsGraded}
                placeholder={t(
                  'dashboard.assignments.editor.task_editor.number_answer.your_answer_placeholder'
                )}
                className="w-full max-w-[200px] px-3 py-2 text-sm border-2 border-gray-200 rounded-md bg-white focus:border-blue-400 focus:ring-2 focus:ring-blue-200 outline-none font-mono"
              />
              {contents.unit && (
                <span className="text-sm font-medium text-slate-500">{contents.unit}</span>
              )}
            </div>
            {showCorrectAnswers && (
              <div className="flex flex-col space-y-1.5 p-3 rounded-md bg-emerald-50 border border-emerald-200">
                <div className="flex items-center space-x-1.5 text-xs font-semibold text-emerald-700">
                  <CheckCircle2 size={13} />
                  <span>{t('dashboard.assignments.editor.task_editor.number_answer.accepted_range_label')}</span>
                </div>
                <div className="text-sm font-mono text-emerald-800">{acceptedRange}</div>
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
                {t('dashboard.assignments.editor.task_editor.number_answer.student_answer_label')}
              </label>
              <div className="px-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-md font-mono">
                {studentAnswer ? (
                  <>
                    {studentAnswer}
                    {contents.unit && <span className="text-slate-500 ml-1.5 font-sans">{contents.unit}</span>}
                  </>
                ) : (
                  <span className="text-gray-400 italic font-sans">
                    {t('dashboard.assignments.editor.task_editor.number_answer.no_answer')}
                  </span>
                )}
              </div>
            </div>
            <div className="flex flex-col space-y-1">
              <label className="text-xs font-semibold text-slate-500">
                {t('dashboard.assignments.editor.task_editor.number_answer.accepted_range_label')}
              </label>
              <div className="px-3 py-2 text-sm bg-emerald-50 border border-emerald-200 rounded-md font-mono text-emerald-700">
                {acceptedRange}
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
                  ? t('dashboard.assignments.editor.task_editor.number_answer.correct')
                  : t('dashboard.assignments.editor.task_editor.number_answer.incorrect')}
              </span>
            </div>
          </>
        )}
      </div>
    </AssignmentBoxUI>
  )
}

export default TaskNumberAnswerObject
