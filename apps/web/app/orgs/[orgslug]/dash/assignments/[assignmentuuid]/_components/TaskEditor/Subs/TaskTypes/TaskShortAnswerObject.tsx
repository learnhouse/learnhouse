'use client'
import { useAssignments } from '@components/Contexts/Assignments/AssignmentContext'
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

/**
 * Compare a student's free-text answer against an array of accepted answers
 * using the configured match mode. Returns true on the first match.
 *
 * All modes trim whitespace. regex mode wraps the pattern in `^...$` so a
 * teacher writing `hello` doesn't accidentally match "hello world".
 */
function checkShortAnswer(
  answer: string,
  acceptedAnswers: string[],
  mode: MatchMode
): boolean {
  const trimmed = (answer ?? '').trim()
  if (!trimmed) return false
  for (const raw of acceptedAnswers) {
    const expected = (raw ?? '').trim()
    if (!expected) continue
    if (mode === 'exact') {
      if (trimmed === expected) return true
    } else if (mode === 'case_insensitive') {
      if (trimmed.toLowerCase() === expected.toLowerCase()) return true
    } else if (mode === 'contains') {
      if (trimmed.toLowerCase().includes(expected.toLowerCase())) return true
    } else if (mode === 'regex') {
      try {
        const re = new RegExp(`^${expected}$`, 'i')
        if (re.test(trimmed)) return true
      } catch {
        // Invalid regex — treat as non-match rather than throwing in the student view
      }
    }
  }
  return false
}

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

  // --- SUBMIT (student) ---
  async function submitFC() {
    if (!assignmentTaskUUID) return
    const maxPoints = assignmentTaskOutsideProvider?.max_grade_value ?? 100
    const passed = checkShortAnswer(
      studentAnswer,
      contents.correct_answers,
      contents.match_mode
    )
    const grade = passed ? maxPoints : 0
    const values = {
      assignment_task_submission_uuid:
        userSubmissions?.assignment_task_submission_uuid || null,
      task_submission: {
        answer: studentAnswer,
        passed,
      },
      grade,
      task_submission_grade_feedback: passed
        ? t('dashboard.assignments.editor.task_editor.short_answer.correct')
        : t('dashboard.assignments.editor.task_editor.short_answer.incorrect'),
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
        {view === 'student' && (
          <>
            {contents.prompt && (
              <p className="text-sm text-slate-700 whitespace-pre-wrap">{contents.prompt}</p>
            )}
            <input
              value={studentAnswer}
              onChange={(e) => setStudentAnswer(e.target.value)}
              placeholder={t(
                'dashboard.assignments.editor.task_editor.short_answer.your_answer_placeholder'
              )}
              className="w-full px-3 py-2 text-sm border-2 border-gray-200 rounded-md bg-white focus:border-blue-400 focus:ring-2 focus:ring-blue-200 outline-none"
            />
            {userSubmissions && userSubmissions.grade !== undefined && userSubmissions.grade !== null && (
              <div
                className={`flex items-start space-x-2 p-3 rounded-md text-sm ${
                  userSubmissions.grade > 0
                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                    : 'bg-rose-50 text-rose-700 border border-rose-200'
                }`}
              >
                {userSubmissions.grade > 0 ? (
                  <CheckCircle2 size={16} className="flex-none mt-0.5" />
                ) : (
                  <XCircle size={16} className="flex-none mt-0.5" />
                )}
                <div className="flex-1">
                  <p className="font-semibold">
                    {userSubmissions.grade > 0
                      ? t('dashboard.assignments.editor.task_editor.short_answer.correct')
                      : t('dashboard.assignments.editor.task_editor.short_answer.incorrect')}
                  </p>
                  {contents.explanation && userSubmissions.grade > 0 && (
                    <p className="text-xs mt-1 text-emerald-600/80 whitespace-pre-wrap">
                      {contents.explanation}
                    </p>
                  )}
                </div>
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
