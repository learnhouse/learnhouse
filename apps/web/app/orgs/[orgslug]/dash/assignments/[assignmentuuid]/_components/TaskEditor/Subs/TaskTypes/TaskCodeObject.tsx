'use client'
import { useAssignments } from '@components/Contexts/Assignments/AssignmentContext'
import {
  useAssignmentSubmission,
  useAssignmentTaskSubmissions,
} from '@components/Contexts/Assignments/AssignmentSubmissionContext'
import {
  useAssignmentsTask,
  useAssignmentsTaskDispatch,
} from '@components/Contexts/Assignments/AssignmentsTaskContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import AssignmentBoxUI from '@components/Objects/Activities/Assignment/AssignmentBoxUI'
import {
  getAssignmentTask,
  getAssignmentTaskSubmissionsUser,
  handleAssignmentTaskSubmission,
  updateAssignmentTask,
} from '@services/courses/assignments'
import { getAPIUrl } from '@services/config/config'
import {
  PLAYGROUND_LANGUAGES,
  getLanguageById,
} from '@components/Objects/Editor/Extensions/CodePlayground/languages'
import {
  Plus,
  Minus,
  Play,
  Loader2,
  CheckCircle2,
  XCircle,
  Eye,
  EyeOff,
  ChevronDown,
  ChevronRight,
  ShieldCheck,
  Lock,
  Settings2,
} from 'lucide-react'
import React, { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { v4 as uuidv4 } from 'uuid'
import { useTranslation } from 'react-i18next'
import dynamic from 'next/dynamic'
import { useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query/keys'
import { applyManualGrade } from './applyManualGrade'

const CodeMirror = dynamic(() => import('@uiw/react-codemirror'), {
  ssr: false,
  loading: () => <div className="h-[200px] bg-neutral-900 animate-pulse rounded-md" />,
})

async function getTheme() {
  const { tokyoNight } = await import('@uiw/codemirror-theme-tokyo-night')
  return tokyoNight
}

async function getLanguageExtension(codemirrorLang: string) {
  switch (codemirrorLang) {
    case 'python': { const { python } = await import('@codemirror/lang-python'); return python() }
    case 'javascript': { const { javascript } = await import('@codemirror/lang-javascript'); return javascript() }
    case 'java': { const { java } = await import('@codemirror/lang-java'); return java() }
    case 'cpp': { const { cpp } = await import('@codemirror/lang-cpp'); return cpp() }
    case 'rust': { const { rust } = await import('@codemirror/lang-rust'); return rust() }
    case 'go': { const { go } = await import('@codemirror/lang-go'); return go() }
    case 'php': { const { php } = await import('@codemirror/lang-php'); return php() }
    case 'sql': { const { sql } = await import('@codemirror/lang-sql'); return sql() }
    case 'perl': { const { StreamLanguage } = await import('@codemirror/language'); const { perl } = await import('@codemirror/legacy-modes/mode/perl'); return StreamLanguage.define(perl) }
    case 'r': { const { StreamLanguage } = await import('@codemirror/language'); const { r } = await import('@codemirror/legacy-modes/mode/r'); return StreamLanguage.define(r) }
    case 'haskell': { const { StreamLanguage } = await import('@codemirror/language'); const { haskell } = await import('@codemirror/legacy-modes/mode/haskell'); return StreamLanguage.define(haskell) }
    case 'lua': { const { StreamLanguage } = await import('@codemirror/language'); const { lua } = await import('@codemirror/legacy-modes/mode/lua'); return StreamLanguage.define(lua) }
    case 'clojure': { const { StreamLanguage } = await import('@codemirror/language'); const { clojure } = await import('@codemirror/legacy-modes/mode/clojure'); return StreamLanguage.define(clojure) }
    case 'shell': { const { StreamLanguage } = await import('@codemirror/language'); const { shell } = await import('@codemirror/legacy-modes/mode/shell'); return StreamLanguage.define(shell) }
    case 'pascal': { const { StreamLanguage } = await import('@codemirror/language'); const { pascal } = await import('@codemirror/legacy-modes/mode/pascal'); return StreamLanguage.define(pascal) }
    case 'fortran': { const { StreamLanguage } = await import('@codemirror/language'); const { fortran } = await import('@codemirror/legacy-modes/mode/fortran'); return StreamLanguage.define(fortran) }
    case 'powershell': { const { StreamLanguage } = await import('@codemirror/language'); const { powerShell } = await import('@codemirror/legacy-modes/mode/powershell'); return StreamLanguage.define(powerShell) }
    default: { const { javascript } = await import('@codemirror/lang-javascript'); return javascript() }
  }
}

type CodeTestCase = {
  id: string
  label: string
  stdin: string
  expectedStdout: string
  hidden: boolean
  weight: number
}

type CodeTaskContents = {
  language_id: number
  starter_code: string
  solution_code: string
  grading_mode: 'equal_weight' | 'binary' | 'custom_weights'
  test_cases: CodeTestCase[]
  // Student-facing behavior. All default to the classic behavior so existing
  // code tasks keep working unchanged after this upgrade.
  allow_student_run?: boolean             // student can click Run Tests (default true)
  show_test_details_on_fail?: boolean     // reveal Expected/Got on a failed test (default true)
  show_hidden_test_count?: boolean        // show "N hidden tests" badge (default true)
  require_passing_to_submit?: boolean     // student must pass visible tests to save (default false)
  // DEPRECATED / INERT: the API strips `solution_code` from the task contents
  // for EVERY student, unconditionally and by design, so a learner can never
  // receive the reference solution and this flag can never have an effect.
  // The teacher-facing toggle was removed (it silently did nothing), but the
  // field is kept on the type so existing stored contents round-trip unchanged.
  show_solution_after_submit?: boolean
}

type CodeTestResult = {
  id: string
  label: string
  passed: boolean
  actual_stdout: string | null
  expected_stdout: string | null
  stderr: string | null
  compile_output: string | null
  status: { id: number; description: string } | null
  time: string | null
  memory: number | null
}

type TaskCodeObjectProps = {
  view: 'teacher' | 'student' | 'grading'
  assignmentTaskUUID?: string
  user_id?: string
  onGraded?: () => void
}

const cmStyles: React.CSSProperties = {
  fontSize: '14px',
  fontFamily: "'JetBrains Mono', 'Fira Code', 'SF Mono', Menlo, monospace",
}
// rtl-ok: CodeMirror is dir="ltr" regardless of UI language — code reads
// left-to-right by language spec, and the editor computes gutter, cursor and
// selection geometry physically. The gutter border stays physical to match.
const cmClassName = [
  '[&_.cm-editor]:!bg-[#1a1b26]',
  '[&_.cm-gutters]:!bg-[#1a1b26]',
  '[&_.cm-gutters]:!border-r-transparent',
  '[&_.cm-activeLineGutter]:!bg-[#24283b]',
  '[&_.cm-activeLine]:!bg-[#24283b]',
  '[&_.cm-editor]:!outline-none',
  '[&_.cm-focused]:!outline-none',
  '[&_.cm-scroller]:!overflow-auto',
  '[&_.cm-line]:!px-4',
].join(' ')

const DEFAULT_CONTENTS: CodeTaskContents = {
  language_id: 71,
  starter_code: '# Write your code here\n',
  solution_code: '',
  grading_mode: 'equal_weight',
  test_cases: [
    { id: 'tc_' + uuidv4(), label: 'Test 1', stdin: '', expectedStdout: '', hidden: false, weight: 1 },
  ],
  allow_student_run: true,
  show_test_details_on_fail: true,
  show_hidden_test_count: true,
  require_passing_to_submit: false,
  show_solution_after_submit: false,
}

// Helper: merge a contents blob from the API with the student-behavior
// defaults so missing fields fall back to the pre-upgrade behavior.
function normalizeCodeContents(raw: any): CodeTaskContents {
  return {
    language_id: raw?.language_id ?? 71,
    starter_code: raw?.starter_code ?? '',
    solution_code: raw?.solution_code ?? '',
    grading_mode: raw?.grading_mode ?? 'equal_weight',
    test_cases: raw?.test_cases ?? [],
    allow_student_run: raw?.allow_student_run ?? true,
    show_test_details_on_fail: raw?.show_test_details_on_fail ?? true,
    show_hidden_test_count: raw?.show_hidden_test_count ?? true,
    require_passing_to_submit: raw?.require_passing_to_submit ?? false,
    show_solution_after_submit: raw?.show_solution_after_submit ?? false,
  }
}

function TaskCodeObject({ view, assignmentTaskUUID, user_id, onGraded }: TaskCodeObjectProps) {
  const { t } = useTranslation()
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token
  const assignmentTaskState = useAssignmentsTask() as any
  const assignmentTaskStateHook = useAssignmentsTaskDispatch() as any
  const assignment = useAssignments() as any
  const taskSubmissionsMap = useAssignmentTaskSubmissions()
  const queryClient = useQueryClient()

  // Student lock, derived exactly like the sibling task types (see
  // TaskShortAnswerObject) and like AssignmentBoxUI's own `canStudentSave`:
  // once the learner has SUBMITTED for grading (or been GRADED) auto-save is
  // switched off, so anything they keep typing is silently discarded on
  // reload. The editor must therefore become read-only at that point.
  const assignmentSubmission = useAssignmentSubmission() as any
  const latestSubmissionStatus =
    Array.isArray(assignmentSubmission) && assignmentSubmission.length > 0
      ? assignmentSubmission[0]?.submission_status
      : null
  const submissionIsGraded = latestSubmissionStatus === 'GRADED'
  const canStudentSave =
    !submissionIsGraded && latestSubmissionStatus !== 'SUBMITTED'

  // Editor state
  const [contents, setContents] = useState<CodeTaskContents>(DEFAULT_CONTENTS)
  const [code, setCode] = useState('')

  // CodeMirror extensions
  const [cmExtensions, setCmExtensions] = useState<any[]>([])
  const [cmTheme, setCmTheme] = useState<any>(null)

  // Execution state
  const [isRunning, setIsRunning] = useState(false)
  const [results, setResults] = useState<CodeTestResult[]>([])
  const [showResults, setShowResults] = useState(false)

  // Submission state (student/grading)
  const [userSubmissions, setUserSubmissions] = useState<any>(null)
  const [initialCode, setInitialCode] = useState('')
  const [userSubmissionObject, setUserSubmissionObject] = useState<any>(null)
  // Hydrate the task definition (starter code) and the saved submission each at
  // most once, so later query refetches never reset the editor to starter/saved
  // code over the learner's in-progress edits (which would stop auto-save).
  const defHydratedForRef = React.useRef<string | null>(null)
  const subHydratedForRef = React.useRef<string | null>(null)
  // Tracks whether the learner has edited the code yet, so an early edit made
  // before the saved submission hydrates isn't clobbered by hydration.
  const interactedRef = React.useRef(false)

  // Teacher UI state
  const [showSolution, setShowSolution] = useState(false)

  // Task data from API (student/grading views)
  const [assignmentTaskOutsideProvider, setAssignmentTaskOutsideProvider] = useState<any>(null)

  // Load CodeMirror theme + language
  useEffect(() => {
    const lang = getLanguageById(contents.language_id)
    if (!lang) return
    Promise.all([getLanguageExtension(lang.codemirrorLang), getTheme()]).then(
      ([langExt, theme]) => {
        setCmExtensions([langExt])
        setCmTheme(theme)
      }
    )
  }, [contents.language_id])

  // Anti-copy-paste: if the assignment has anti_copy_paste enabled, inject a
  // CodeMirror extension that blocks paste events and shows a toast. Only
  // applied in the student view — teachers and graders can paste freely.
  const antiPasteEnabled =
    view === 'student' && !!assignment?.assignment_object?.anti_copy_paste

  const [pasteBlockerExt, setPasteBlockerExt] = useState<any[]>([])
  useEffect(() => {
    if (!antiPasteEnabled) {
      setPasteBlockerExt([])
      return
    }
    // Dynamic import keeps the view module out of the bundle unless needed
    import('@codemirror/view').then(({ EditorView }) => {
      setPasteBlockerExt([
        EditorView.domEventHandlers({
          paste: (event: ClipboardEvent) => {
            event.preventDefault()
            event.stopPropagation()
            toast.error(t('dashboard.assignments.editor.task_editor.general.paste_blocked'))
            return true
          },
        }),
      ])
    })
  }, [antiPasteEnabled, t])

  const studentCmExtensions = antiPasteEnabled
    ? [...cmExtensions, ...pasteBlockerExt]
    : cmExtensions

  // --- TEACHER VIEW ---
  useEffect(() => {
    if (view === 'teacher' && assignmentTaskState?.assignmentTask?.contents) {
      const c = assignmentTaskState.assignmentTask.contents
      if (c.language_id !== undefined) {
        setContents(normalizeCodeContents(c))
        setCode(c.starter_code ?? '')
      }
    }
  }, [view, assignmentTaskState])

  // --- STUDENT VIEW ---
  // Task data and the user's submission are fetched once at the assignment
  // level (AssignmentContext.assignment_tasks + AssignmentTaskSubmissionsContext).
  // Looking them up here avoids N per-task /assignments/task and
  // /submissions/me round trips on activity load.

  // --- GRADING VIEW ---
  async function getAssignmentTaskUI() {
    if (assignmentTaskUUID) {
      const res = await getAssignmentTask(assignmentTaskUUID, access_token)
      if (res.success) {
        setAssignmentTaskOutsideProvider(res.data)
        const c = res.data.contents
        if (c) {
          setContents(normalizeCodeContents(c))
          setCode(c.starter_code ?? '')
          setInitialCode(c.starter_code ?? '')
        }
      }
    }
  }

  async function getAssignmentTaskSubmissionFromIdentifiedUserUI() {
    if (assignmentTaskUUID && user_id) {
      const res = await getAssignmentTaskSubmissionsUser(
        assignmentTaskUUID,
        user_id,
        assignment.assignment_object.assignment_uuid,
        access_token
      )
      if (res.success && res.data) {
        setUserSubmissions(res.data)
        setUserSubmissionObject(res.data)
        if (res.data.task_submission?.source_code) {
          setCode(res.data.task_submission.source_code)
          setInitialCode(res.data.task_submission.source_code)
        }
        if (res.data.task_submission?.results) {
          setResults(res.data.task_submission.results)
        }
      }
    }
  }

  // Hydrate student view from already-fetched assignment context + batch
  // submissions map. Re-runs when either context payload arrives.
  useEffect(() => {
    if (view !== 'student' || !assignmentTaskUUID) return
    // Definition (starter code) — hydrate once. Re-running would reset the
    // editor to starter code over the learner's edits.
    if (defHydratedForRef.current !== assignmentTaskUUID) {
      const task = assignment?.assignment_tasks?.find(
        (t: any) => t.assignment_task_uuid === assignmentTaskUUID
      )
      if (task) {
        setAssignmentTaskOutsideProvider(task)
        const c = task.contents
        if (c) {
          setContents(normalizeCodeContents(c))
          // Only seed the editor with starter code when no saved submission has
          // been applied yet. If the submission already hydrated (in a prior
          // run), resetting to starter would wipe the learner's saved code.
          if (subHydratedForRef.current !== assignmentTaskUUID) {
            setCode(c.starter_code ?? '')
            setInitialCode(c.starter_code ?? '')
          }
        }
        defHydratedForRef.current = assignmentTaskUUID
      }
    }
    // Saved submission — hydrate once, when the batch first resolves. Runs even
    // if the learner already started typing: the submission uuid + baseline
    // (initialCode) are always adopted so a save targets the right row and dirty
    // detection works, while their in-progress code is preserved.
    if (taskSubmissionsMap !== null && subHydratedForRef.current !== assignmentTaskUUID) {
      const sub = taskSubmissionsMap?.[assignmentTaskUUID] ?? null
      if (sub) {
        setUserSubmissions(sub)
        if (sub.task_submission?.source_code) {
          setInitialCode(sub.task_submission.source_code)
          if (!interactedRef.current) {
            setCode(sub.task_submission.source_code)
          }
        }
        if (sub.task_submission?.results && !interactedRef.current) {
          setResults(sub.task_submission.results)
        }
      }
      subHydratedForRef.current = assignmentTaskUUID
    }
  }, [view, assignmentTaskUUID, assignment?.assignment_tasks, taskSubmissionsMap])

  // Grading view still uses per-task fetches — there's only ever one task
  // open at a time in the grading modal so the N+1 cost doesn't apply.
  useEffect(() => {
    if (view === 'grading') {
      getAssignmentTaskUI()
      getAssignmentTaskSubmissionFromIdentifiedUserUI()
    }
  }, [view, assignmentTaskUUID, assignment, access_token])

  // --- SAVE (teacher) ---
  async function saveFC() {
    if (!assignmentTaskState?.assignmentTask?.assignment_task_uuid) return
    const updatedContents: CodeTaskContents = {
      ...contents,
      starter_code: code,
    }
    const values = { contents: updatedContents }
    const res = await updateAssignmentTask(
      values,
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

  // Student-gating helpers: derived from the student-behavior flags.
  // `visibleTestCases` are the only ones a learner can see, run and reason
  // about — the API strips the hidden ones' stdin/expectedStdout before the
  // task ever reaches them.
  const visibleTestCases = contents.test_cases.filter((tc) => !tc.hidden)
  // `visibleResults` is the subset of run results that are NOT hidden test
  // cases — those are the only ones the student can see and reason about.
  const visibleResults = results.filter((r) => {
    const tc = contents.test_cases.find((t) => t.id === r.id)
    return !tc?.hidden
  })
  const allVisiblePassing =
    visibleResults.length > 0 && visibleResults.every((r) => r.passed)
  // Only enforce the "must pass" gate when the teacher turned it on AND there
  // is at least one visible test to pass. A task made of hidden tests only
  // could otherwise never satisfy the gate, locking the learner out forever.
  const submissionGatedByPassing =
    contents.require_passing_to_submit === true && visibleTestCases.length > 0
  const submissionBlocked = submissionGatedByPassing && !allVisiblePassing

  // --- SUBMIT (student) ---
  async function submitFC(opts?: { silent?: boolean }) {
    if (!assignmentTaskUUID) return true
    // Enforce "must pass all visible tests" gate if the teacher enabled it.
    // This is a POLICY refusal, not a failure: returning `false` would make
    // useAutoSave treat it as a transient error and retry every few seconds
    // forever (permanent amber "Couldn't save — retrying…" chip) and would
    // also fail the assignment-wide flushAll(), blocking submission of the
    // WHOLE assignment. `'blocked'` is handled by useAutoSave as terminal —
    // no retry, no error state. Genuine network/server failures below still
    // return `false` so they keep being retried.
    if (submissionBlocked) {
      if (!opts?.silent) toast.error(t('dashboard.assignments.editor.task_editor.code.must_pass_toast'))
      return 'blocked' as const
    }
    const values = {
      assignment_task_submission_uuid: userSubmissions?.assignment_task_submission_uuid || null,
      task_submission: {
        source_code: code,
        language_id: contents.language_id,
        results: results,
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
      setInitialCode(code)
      // Keep the shared 60s batch cache in sync with what we just saved, even on
      // a silent auto-save. Patching the cached entry in place (no refetch)
      // avoids the stale-hydration bug: a remount that reads the batch would
      // otherwise get the pre-save submission and overwrite the newer code.
      queryClient.setQueryData(
        queryKeys.assignments.taskSubmission(assignment.assignment_object.assignment_uuid),
        (old: any) => (old ? { ...old, [assignmentTaskUUID]: res.data } : old)
      )
      if (!opts?.silent) {
        toast.success(t('dashboard.assignments.editor.toasts.task_saved'))
      }
      return true
    } else {
      if (!opts?.silent) toast.error(t('dashboard.assignments.editor.toasts.task_save_error'))
      return false
    }
  }

  // --- RUN CODE ---
  async function runCode() {
    if (isRunning) return
    // The API strips `stdin` / `expectedStdout` from every HIDDEN test case
    // before sending the task contents to a student (deliberate: hidden tests
    // must stay secret). Sending them back would post
    // {stdin: undefined, expected_stdout: undefined}, which JSON.stringify
    // drops entirely — and the server's TestCase model requires both — so the
    // WHOLE batch 422'd and the learner got zero results, including for the
    // visible tests. Students therefore only ever run the visible tests; the
    // hidden ones are executed server-side at grading time.
    const testCasesToRun =
      view === 'student' ? visibleTestCases : contents.test_cases
    if (testCasesToRun.length === 0) {
      toast.error(
        view === 'student'
          ? t('dashboard.assignments.editor.task_editor.code.no_runnable_tests', {
              defaultValue: 'This task has no tests you can run — your code is checked at grading time.',
            })
          : 'No test cases defined'
      )
      return
    }
    setIsRunning(true)
    setShowResults(true)
    try {
      const resp = await fetch(`${getAPIUrl()}code/execute-batch`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${access_token}`,
        },
        body: JSON.stringify({
          language_id: contents.language_id,
          source_code: code,
          test_cases: testCasesToRun.map((tc) => ({
            id: tc.id,
            label: tc.label,
            stdin: tc.stdin,
            expected_stdout: tc.expectedStdout,
          })),
        }),
      })

      if (!resp.ok) {
        const errText = await resp.text().catch(() => '')
        console.error('Judge0 error response:', resp.status, errText)
        toast.error(`Code execution failed (${resp.status})`)
        return
      }

      const data = await resp.json()
      // Match every result back to its test case BY ID — after filtering, array
      // indices no longer line up with contents.test_cases.
      const newResults: CodeTestResult[] = (data.results ?? []).map((r: any) => {
        const tc = testCasesToRun.find((t) => t.id === r.id)
        return {
          id: r.id ?? tc?.id,
          label: r.label ?? tc?.label ?? '',
          passed: r.passed,
          actual_stdout: r.actual_stdout,
          expected_stdout: r.expected_stdout,
          stderr: r.stderr,
          compile_output: r.compile_output,
          status: r.status,
          time: r.time,
          memory: r.memory,
        }
      })
      setResults(newResults)
    } catch (err) {
      console.error('Code execution error:', err)
      toast.error('Code execution failed')
    } finally {
      setIsRunning(false)
    }
  }

  // --- MANUAL GRADE (grading view) ---
  async function gradeCustomFC(grade: number, feedback?: string) {
    if (!userSubmissions) return
    await applyManualGrade({
      grade,
      feedback,
      maxPoints: assignmentTaskOutsideProvider?.max_grade_value || 100,
      assignmentTaskUUID,
      assignmentUUID: assignment.assignment_object.assignment_uuid,
      accessToken: access_token,
      username: session?.data?.user?.username,
      assignmentTaskSubmissionUUID: userSubmissions.assignment_task_submission_uuid,
      taskSubmissionPayload: userSubmissions,
      onSuccess: () => { getAssignmentTaskSubmissionFromIdentifiedUserUI(); onGraded?.(); },
    })
  }

  // --- GRADE (grading view) ---
  async function gradeFC() {
    if (!assignmentTaskUUID || !userSubmissions) return
    setIsRunning(true)
    try {
      const resp = await fetch(`${getAPIUrl()}code/execute-batch`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${access_token}`,
        },
        body: JSON.stringify({
          // Grading intentionally runs ALL test cases, hidden ones included:
          // this view is instructor-only and its contents are NOT stripped, so
          // stdin/expectedStdout are present. Do not filter here.
          language_id: contents.language_id,
          source_code: code,
          test_cases: contents.test_cases.map((tc) => ({
            id: tc.id,
            label: tc.label,
            stdin: tc.stdin,
            expected_stdout: tc.expectedStdout,
          })),
        }),
      })

      if (!resp.ok) {
        toast.error('Code execution failed during grading')
        return
      }

      const data = await resp.json()
      const gradeResults: CodeTestResult[] = data.results
      setResults(gradeResults)
      setShowResults(true)

      const maxPoints = assignmentTaskOutsideProvider?.max_grade_value || 100
      const passedCount = gradeResults.filter((r: any) => r.passed).length
      const totalCount = gradeResults.length
      let finalGrade: number

      if (contents.grading_mode === 'binary') {
        finalGrade = passedCount === totalCount ? maxPoints : 0
      } else if (contents.grading_mode === 'custom_weights') {
        const totalWeight = contents.test_cases.reduce((s, tc) => s + tc.weight, 0)
        const passedWeight = contents.test_cases.reduce((s, tc) => {
          const result = gradeResults.find((r: any) => r.id === tc.id)
          return s + (result?.passed ? tc.weight : 0)
        }, 0)
        finalGrade = totalWeight > 0 ? Math.round((passedWeight / totalWeight) * maxPoints) : 0
      } else {
        finalGrade = totalCount > 0 ? Math.round((passedCount / totalCount) * maxPoints) : 0
      }

      const feedback = `Auto graded: ${passedCount}/${totalCount} tests passed — ${finalGrade}/${maxPoints} points`

      const values = {
        assignment_task_submission_uuid: userSubmissions.assignment_task_submission_uuid,
        task_submission: {
          source_code: code,
          language_id: contents.language_id,
          results: gradeResults,
        },
        grade: finalGrade,
        task_submission_grade_feedback: feedback,
        manually_graded: false,
      }

      const res = await handleAssignmentTaskSubmission(
        values,
        assignmentTaskUUID,
        assignment.assignment_object.assignment_uuid,
        access_token
      )
      if (res.success) {
        getAssignmentTaskSubmissionFromIdentifiedUserUI()
        toast.success(`Task graded: ${finalGrade}/${maxPoints} points`)
      } else {
        toast.error('Error grading task')
      }
    } catch (err) {
      console.error('Grading error:', err)
      toast.error('Error during grading')
    } finally {
      setIsRunning(false)
    }
  }

  // --- TEST CASE HELPERS (teacher) ---
  function addTestCase() {
    setContents((prev) => ({
      ...prev,
      test_cases: [
        ...prev.test_cases,
        { id: 'tc_' + uuidv4(), label: `Test ${prev.test_cases.length + 1}`, stdin: '', expectedStdout: '', hidden: false, weight: 1 },
      ],
    }))
  }

  function removeTestCase(index: number) {
    setContents((prev) => ({
      ...prev,
      test_cases: prev.test_cases.filter((_, i) => i !== index),
    }))
  }

  function updateTestCase(index: number, field: keyof CodeTestCase, value: any) {
    setContents((prev) => ({
      ...prev,
      test_cases: prev.test_cases.map((tc, i) => (i === index ? { ...tc, [field]: value } : tc)),
    }))
  }

  const selectedLang = getLanguageById(contents.language_id)
  const hiddenTestCount = contents.test_cases.filter((tc) => tc.hidden).length

  return (
    <AssignmentBoxUI
      type="code"
      view={view}
      saveFC={saveFC}
      submitFC={submitFC}
      taskUUID={assignmentTaskUUID}
      gradeFC={gradeFC}
      gradeCustomFC={gradeCustomFC}
      currentPoints={userSubmissionObject?.grade}
      currentFeedback={userSubmissionObject?.task_submission_grade_feedback}
      maxPoints={assignmentTaskOutsideProvider?.max_grade_value || assignmentTaskState?.assignmentTask?.max_grade_value}
      dirtyValue={code}
      savedValue={initialCode}
      autoGradable={true}
    >
      <div className="flex flex-col space-y-4">
        {/* === TEACHER VIEW === */}
        {view === 'teacher' && (
          <>
            {/* Language & Grading Mode */}
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="flex flex-col space-y-1 flex-1">
                <label className="text-xs font-semibold text-slate-500">Language</label>
                <select
                  value={contents.language_id}
                  onChange={(e) => {
                    const langId = Number(e.target.value)
                    const lang = getLanguageById(langId)
                    setContents((prev) => ({
                      ...prev,
                      language_id: langId,
                      starter_code: lang?.defaultCode || prev.starter_code,
                    }))
                    setCode(lang?.defaultCode || code)
                  }}
                  className="px-3 py-1.5 text-sm border border-gray-200 rounded-md bg-white"
                >
                  {PLAYGROUND_LANGUAGES.map((lang) => (
                    <option key={lang.id} value={lang.id}>
                      {lang.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col space-y-1 flex-1">
                <label className="text-xs font-semibold text-slate-500">Grading Mode</label>
                <select
                  value={contents.grading_mode}
                  onChange={(e) =>
                    setContents((prev) => ({ ...prev, grading_mode: e.target.value as any }))
                  }
                  className="px-3 py-1.5 text-sm border border-gray-200 rounded-md bg-white"
                >
                  <option value="equal_weight">Equal Weight</option>
                  <option value="binary">Binary (All or Nothing)</option>
                  <option value="custom_weights">Custom Weights</option>
                </select>
              </div>
            </div>

            {/* Starter Code */}
            <div className="flex flex-col space-y-1">
              <label className="text-xs font-semibold text-slate-500">Starter Code</label>
              <div dir="ltr" className={`rounded-md overflow-hidden ${cmClassName}`}>
                {cmTheme && (
                  <CodeMirror
                    value={code}
                    onChange={(val) => setCode(val)}
                    extensions={cmExtensions}
                    theme={cmTheme}
                    style={cmStyles}
                    height="200px"
                    basicSetup={{ lineNumbers: true, foldGutter: false }}
                  />
                )}
              </div>
            </div>

            {/* Solution Code (collapsible) */}
            <div className="flex flex-col space-y-1">
              <button
                onClick={() => setShowSolution(!showSolution)}
                className="flex items-center space-x-1 text-xs font-semibold text-slate-500 hover:text-slate-700"
              >
                {showSolution ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                <span>Solution Code (optional, for instructor reference)</span>
              </button>
              {showSolution && (
                <div dir="ltr" className={`rounded-md overflow-hidden ${cmClassName}`}>
                  {cmTheme && (
                    <CodeMirror
                      value={contents.solution_code}
                      onChange={(val) => setContents((prev) => ({ ...prev, solution_code: val }))}
                      extensions={cmExtensions}
                      theme={cmTheme}
                      style={cmStyles}
                      height="200px"
                      basicSetup={{ lineNumbers: true, foldGutter: false }}
                    />
                  )}
                </div>
              )}
            </div>

            {/* Test Cases */}
            <div className="flex flex-col space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-slate-500">Test Cases</label>
                <button
                  onClick={addTestCase}
                  className="flex items-center space-x-1 text-xs font-semibold text-emerald-600 hover:text-emerald-700"
                >
                  <Plus size={14} />
                  <span>Add Test Case</span>
                </button>
              </div>
              {contents.test_cases.map((tc, index) => (
                <div
                  key={tc.id}
                  className="flex flex-col space-y-2 p-3 border border-gray-200 rounded-md bg-white"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2 flex-1">
                      <input
                        value={tc.label}
                        onChange={(e) => updateTestCase(index, 'label', e.target.value)}
                        placeholder="Test label"
                        className="px-2 py-1 text-sm border border-gray-200 rounded-md flex-1"
                      />
                      <button
                        onClick={() => updateTestCase(index, 'hidden', !tc.hidden)}
                        className={`flex items-center space-x-1 px-2 py-1 text-xs rounded-md ${
                          tc.hidden
                            ? 'bg-amber-100 text-amber-700'
                            : 'bg-slate-100 text-slate-500'
                        }`}
                        title={tc.hidden ? 'Hidden from students' : 'Visible to students'}
                      >
                        {tc.hidden ? <EyeOff size={12} /> : <Eye size={12} />}
                        <span>{tc.hidden ? 'Hidden' : 'Visible'}</span>
                      </button>
                      {contents.grading_mode === 'custom_weights' && (
                        <input
                          type="number"
                          value={tc.weight}
                          onChange={(e) => updateTestCase(index, 'weight', Math.max(1, Number(e.target.value)))}
                          className="w-16 px-2 py-1 text-sm border border-gray-200 rounded-md text-center"
                          min={1}
                          title="Weight"
                        />
                      )}
                    </div>
                    <button
                      onClick={() => removeTestCase(index)}
                      className="w-6 h-6 flex items-center justify-center rounded-md bg-slate-100 text-slate-400 hover:bg-red-100 hover:text-red-500 ms-2"
                    >
                      <Minus size={12} />
                    </button>
                  </div>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <div className="flex flex-col space-y-1 flex-1">
                      <label className="text-[10px] font-semibold text-slate-400 uppercase">Stdin</label>
                      <textarea
                        value={tc.stdin}
                        onChange={(e) => updateTestCase(index, 'stdin', e.target.value)}
                        placeholder="Input"
                        rows={2}
                        className="px-2 py-1 text-sm border border-gray-200 rounded-md font-mono resize-y"
                      />
                    </div>
                    <div className="flex flex-col space-y-1 flex-1">
                      <label className="text-[10px] font-semibold text-slate-400 uppercase">Expected Stdout</label>
                      <textarea
                        value={tc.expectedStdout}
                        onChange={(e) => updateTestCase(index, 'expectedStdout', e.target.value)}
                        placeholder="Expected output"
                        rows={2}
                        className="px-2 py-1 text-sm border border-gray-200 rounded-md font-mono resize-y"
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Student behavior options */}
            <div className="flex flex-col space-y-2">
              <div className="flex items-center space-x-1.5 text-slate-500">
                <Settings2 size={13} />
                <p className="text-xs font-semibold">{t('dashboard.assignments.editor.task_editor.code.student_behavior_label')}</p>
              </div>
              <div className="flex flex-col space-y-1.5">
                <CodeOptionToggle
                  icon={<Play size={13} />}
                  label={t('dashboard.assignments.editor.task_editor.code.allow_student_run_label')}
                  description={t('dashboard.assignments.editor.task_editor.code.allow_student_run_description')}
                  checked={contents.allow_student_run !== false}
                  onChange={(v) => setContents((prev) => ({ ...prev, allow_student_run: v }))}
                />
                <CodeOptionToggle
                  icon={<Eye size={13} />}
                  label={t('dashboard.assignments.editor.task_editor.code.show_test_details_label')}
                  description={t('dashboard.assignments.editor.task_editor.code.show_test_details_description')}
                  checked={contents.show_test_details_on_fail !== false}
                  onChange={(v) => setContents((prev) => ({ ...prev, show_test_details_on_fail: v }))}
                />
                <CodeOptionToggle
                  icon={<EyeOff size={13} />}
                  label={t('dashboard.assignments.editor.task_editor.code.show_hidden_count_label')}
                  description={t('dashboard.assignments.editor.task_editor.code.show_hidden_count_description')}
                  checked={contents.show_hidden_test_count !== false}
                  onChange={(v) => setContents((prev) => ({ ...prev, show_hidden_test_count: v }))}
                />
                <CodeOptionToggle
                  icon={<ShieldCheck size={13} />}
                  label={t('dashboard.assignments.editor.task_editor.code.require_passing_label')}
                  description={t('dashboard.assignments.editor.task_editor.code.require_passing_description')}
                  checked={contents.require_passing_to_submit === true}
                  onChange={(v) => setContents((prev) => ({ ...prev, require_passing_to_submit: v }))}
                />
                {/* The "Reveal solution after submit" toggle used to live here.
                    It was removed because it could never do anything: the API
                    strips `solution_code` from the task contents for EVERY
                    student, unconditionally and by design. It only appeared to
                    work when a teacher previewed the task (teachers get the
                    unstripped contents), so it misled teachers into believing
                    learners would see the reference solution. Do not re-add it
                    without also changing the server-side stripping. */}
              </div>
            </div>

            {/* Run Tests (teacher) */}
            <div className="flex items-center space-x-2">
              <button
                onClick={runCode}
                disabled={isRunning}
                className="flex items-center space-x-1.5 px-3 py-1.5 text-sm font-semibold bg-slate-700 text-white rounded-md hover:bg-slate-800 disabled:opacity-50"
              >
                {isRunning ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
                <span>{isRunning ? 'Running...' : 'Run Tests'}</span>
              </button>
            </div>

            {/* Results (teacher) */}
            {showResults && results.length > 0 && <TestResultsPanel results={results} testCases={contents.test_cases} view="grading" />}
          </>
        )}

        {/* === STUDENT VIEW === */}
        {view === 'student' && (
          <>
            {/* Language badge */}
            <div className="flex items-center space-x-2">
              <span className="px-2 py-0.5 text-xs font-semibold bg-slate-100 text-slate-600 rounded-full">
                {selectedLang?.name || 'Unknown'}
              </span>
              {/* Hidden-test badge only if the task allows showing the count */}
              {hiddenTestCount > 0 && contents.show_hidden_test_count !== false && (
                <span className="px-2 py-0.5 text-xs font-semibold bg-amber-100 text-amber-700 rounded-full">
                  {hiddenTestCount} hidden test{hiddenTestCount > 1 ? 's' : ''}
                </span>
              )}
            </div>

            {/* Code Editor — locked once the submission is SUBMITTED/GRADED.
                Auto-save is switched off at that point (AssignmentBoxUI's
                `canStudentSave`), so any further typing would be silently lost
                on reload and would not reach the grader. Mirrors the read-only
                treatment of the other task types. */}
            <div dir="ltr" className={`rounded-md overflow-hidden ${cmClassName}`}>
              {cmTheme && (
                <CodeMirror
                  value={code}
                  onChange={(val) => {
                    if (!canStudentSave) return
                    interactedRef.current = true
                    setCode(val)
                  }}
                  extensions={studentCmExtensions}
                  theme={cmTheme}
                  style={cmStyles}
                  height="300px"
                  readOnly={!canStudentSave}
                  editable={canStudentSave}
                  basicSetup={{ lineNumbers: true, foldGutter: false }}
                />
              )}
            </div>
            {!canStudentSave && (
              <div className="flex items-center space-x-1.5 text-[10px] text-slate-500 bg-slate-100 rounded-md px-2 py-1 w-fit">
                <Lock size={11} />
                <span>
                  {submissionIsGraded
                    ? t('dashboard.assignments.editor.task_editor.code.locked_graded_hint', {
                        defaultValue: 'This submission has been graded — your code is read-only.',
                      })
                    : t('dashboard.assignments.editor.task_editor.code.locked_submitted_hint', {
                        defaultValue: 'You have submitted this assignment — your code is read-only.',
                      })}
                </span>
              </div>
            )}
            {antiPasteEnabled && (
              <div className="flex items-center space-x-1.5 text-[10px] text-amber-600 bg-amber-50 rounded-md px-2 py-1 w-fit">
                <span>🔒</span>
                <span>{t('dashboard.assignments.editor.task_editor.general.paste_blocked_hint')}</span>
              </div>
            )}

            {/* Run Button — only if the task allows students to run */}
            {contents.allow_student_run !== false && (
              <div className="flex items-center space-x-2">
                <button
                  onClick={runCode}
                  disabled={isRunning}
                  className="flex items-center space-x-1.5 px-3 py-1.5 text-sm font-semibold bg-emerald-600 text-white rounded-md hover:bg-emerald-700 disabled:opacity-50"
                >
                  {isRunning ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
                  <span>{isRunning ? 'Running...' : 'Run Tests'}</span>
                </button>
              </div>
            )}

            {/* Submission gating notice — when the teacher requires passing
                all visible tests before save. */}
            {submissionGatedByPassing && !allVisiblePassing && (
              <div className="flex items-center space-x-1.5 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2.5 py-1.5 w-fit">
                <ShieldCheck size={13} />
                <span>{t('dashboard.assignments.editor.task_editor.code.must_pass_hint')}</span>
              </div>
            )}

            {/* Results — hidden tests are never run client-side, so they are
                listed as "not shown" rather than counted as failures. */}
            {showResults && (
              <TestResultsPanel
                results={results}
                testCases={contents.test_cases}
                view="student"
                showDetailsOnFail={contents.show_test_details_on_fail !== false}
                maskedTestCases={contents.test_cases.filter(
                  (tc) => tc.hidden && !results.some((r) => r.id === tc.id)
                )}
                showMaskedCount={contents.show_hidden_test_count !== false}
              />
            )}

            {/* The student-side "reference solution" panel used to live here.
                It was removed together with its teacher toggle: `solution_code`
                is stripped server-side for every student, so the panel could
                never render for a learner. */}
          </>
        )}

        {/* === GRADING VIEW === */}
        {view === 'grading' && (
          <>
            {/* Language badge */}
            <div className="flex items-center space-x-2">
              <span className="px-2 py-0.5 text-xs font-semibold bg-slate-100 text-slate-600 rounded-full">
                {selectedLang?.name || 'Unknown'}
              </span>
              <span className="px-2 py-0.5 text-xs font-semibold bg-blue-100 text-blue-700 rounded-full">
                {contents.grading_mode === 'binary' ? 'Binary' : contents.grading_mode === 'custom_weights' ? 'Custom Weights' : 'Equal Weight'}
              </span>
            </div>

            {/* Student's Code (read-only) */}
            <div className="flex flex-col space-y-1">
              <label className="text-xs font-semibold text-slate-500">Student&apos;s Code</label>
              <div dir="ltr" className={`rounded-md overflow-hidden ${cmClassName}`}>
                {cmTheme && (
                  <CodeMirror
                    value={code}
                    extensions={cmExtensions}
                    theme={cmTheme}
                    style={cmStyles}
                    height="300px"
                    readOnly={true}
                    editable={false}
                    basicSetup={{ lineNumbers: true, foldGutter: false }}
                  />
                )}
              </div>
            </div>

            {/* Solution Code (collapsible) */}
            {contents.solution_code && (
              <div className="flex flex-col space-y-1">
                <button
                  onClick={() => setShowSolution(!showSolution)}
                  className="flex items-center space-x-1 text-xs font-semibold text-slate-500 hover:text-slate-700"
                >
                  {showSolution ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  <span>Reference Solution</span>
                </button>
                {showSolution && (
                  <div dir="ltr" className={`rounded-md overflow-hidden ${cmClassName}`}>
                    {cmTheme && (
                      <CodeMirror
                        value={contents.solution_code}
                        extensions={cmExtensions}
                        theme={cmTheme}
                        style={cmStyles}
                        height="200px"
                        readOnly={true}
                        editable={false}
                        basicSetup={{ lineNumbers: true, foldGutter: false }}
                      />
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Run & Grade */}
            {isRunning && (
              <div className="flex items-center space-x-2 text-sm text-slate-500">
                <Loader2 size={14} className="animate-spin" />
                <span>Running tests...</span>
              </div>
            )}

            {/* Results */}
            {results.length > 0 && <TestResultsPanel results={results} testCases={contents.test_cases} view="grading" />}
          </>
        )}
      </div>
    </AssignmentBoxUI>
  )
}

function TestResultsPanel({
  results,
  testCases,
  view,
  showDetailsOnFail = true,
  maskedTestCases = [],
  showMaskedCount = true,
}: {
  results: CodeTestResult[]
  testCases: CodeTestCase[]
  view: 'student' | 'grading'
  showDetailsOnFail?: boolean
  // Test cases that were NOT run client-side (hidden ones, whose stdin /
  // expected output the API withholds from students). They are rendered as
  // masked/unknown rows so a learner doesn't read them as failures.
  maskedTestCases?: CodeTestCase[]
  showMaskedCount?: boolean
}) {
  const passedCount = results.filter((r) => r.passed).length
  const totalCount = results.length
  const maskedShown = showMaskedCount ? maskedTestCases : []

  return (
    <div className="flex flex-col space-y-2 p-3 bg-slate-50 rounded-md border border-slate-200">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-slate-600">
          Results: {passedCount}/{totalCount} passed
        </span>
        <span
          className={`px-2 py-0.5 text-xs font-bold rounded-full ${
            passedCount === totalCount
              ? 'bg-emerald-100 text-emerald-700'
              : 'bg-red-100 text-red-700'
          }`}
        >
          {passedCount === totalCount
            ? maskedShown.length > 0
              ? 'Visible Tests Passed'
              : 'All Passed'
            : 'Some Failed'}
        </span>
      </div>
      <div className="flex flex-col space-y-1.5">
        {results.map((result) => {
          const tc = testCases.find((t) => t.id === result.id)
          const isHidden = tc?.hidden && view === 'student'
          // Teachers always see details. In the student view, failure details
          // are hidden when the task disables details OR the test is hidden.
          const detailsSuppressed = view === 'student' && !showDetailsOnFail
          return (
            <div
              key={result.id}
              className={`flex flex-col p-2 rounded-md text-sm ${
                result.passed ? 'bg-emerald-50 border border-emerald-200' : 'bg-red-50 border border-red-200'
              }`}
            >
              <div className="flex items-center space-x-2">
                {result.passed ? (
                  <CheckCircle2 size={14} className="text-emerald-600 flex-none" />
                ) : (
                  <XCircle size={14} className="text-red-600 flex-none" />
                )}
                <span className="font-medium text-slate-700">{result.label}</span>
                {result.time && (
                  <span className="text-[10px] text-slate-400 ms-auto">{result.time}s</span>
                )}
              </div>
              {!result.passed && !isHidden && !detailsSuppressed && (
                <div className="mt-1.5 ps-6 text-xs space-y-0.5">
                  {result.expected_stdout !== null && (
                    <div>
                      <span className="text-slate-400">Expected: </span>
                      <code className="text-slate-600 bg-white px-1 rounded">{result.expected_stdout}</code>
                    </div>
                  )}
                  {result.actual_stdout !== null && (
                    <div>
                      <span className="text-slate-400">Got: </span>
                      <code className="text-red-600 bg-white px-1 rounded">{result.actual_stdout}</code>
                    </div>
                  )}
                  {result.stderr && (
                    <div>
                      <span className="text-slate-400">Error: </span>
                      <code className="text-red-600 bg-white px-1 rounded text-[11px] break-all">{result.stderr}</code>
                    </div>
                  )}
                  {result.compile_output && (
                    <div>
                      <span className="text-slate-400">Compile: </span>
                      <code className="text-red-600 bg-white px-1 rounded text-[11px] break-all">{result.compile_output}</code>
                    </div>
                  )}
                </div>
              )}
              {isHidden && !result.passed && (
                <div className="mt-1 ps-6 text-xs text-slate-400 italic">
                  Details hidden — this is a hidden test case
                </div>
              )}
            </div>
          )
        })}
        {/* Hidden tests the student can't run: shown as unknown, never as
            failures. They are executed server-side when the assignment is
            graded. */}
        {maskedShown.map((tc) => (
          <div
            key={tc.id}
            className="flex flex-col p-2 rounded-md text-sm bg-slate-100 border border-slate-200"
          >
            <div className="flex items-center space-x-2">
              <EyeOff size={14} className="text-slate-400 flex-none" />
              <span className="font-medium text-slate-500">{tc.label}</span>
            </div>
            <div className="mt-1 ps-6 text-xs text-slate-400 italic">
              Hidden test — run when your work is graded
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function CodeOptionToggle({
  icon,
  label,
  description,
  checked,
  onChange,
}: {
  icon: React.ReactNode
  label: string
  description: string
  checked: boolean
  onChange: (_next: boolean) => void
}) {
  return (
    <div className="flex items-start justify-between gap-2 p-2 rounded-md bg-white border border-slate-200">
      <div className="flex items-start gap-2 flex-1 min-w-0">
        <div className="mt-0.5 flex-none text-slate-500">{icon}</div>
        <div className="flex flex-col min-w-0">
          <p className="text-[11px] font-bold text-slate-700">{label}</p>
          <p className="text-[10px] text-slate-500 leading-snug mt-0.5">{description}</p>
        </div>
      </div>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        aria-pressed={checked}
        className={`relative flex-none inline-flex h-4 w-7 items-center rounded-full transition-colors ${
          checked ? 'bg-slate-700' : 'bg-slate-200 hover:bg-slate-300'
        }`}
      >
        <span
          className={`inline-block h-3 w-3 transform rounded-full bg-white shadow transition-transform ${
            checked ? 'translate-x-3.5 rtl:-translate-x-3.5' : 'translate-x-0.5 rtl:-translate-x-0.5'
          }`}
        />
      </button>
    </div>
  )
}

export default TaskCodeObject
