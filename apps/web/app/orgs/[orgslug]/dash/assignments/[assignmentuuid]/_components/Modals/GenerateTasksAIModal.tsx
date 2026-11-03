'use client'

import React from 'react'
import { useTranslation } from 'react-i18next'
import toast from 'react-hot-toast'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, CircleNotch, Clock, ClockCounterClockwise, FileArrowUp, Hash, ListChecks, PencilSimple, Plus, Sparkle, TextT, Trash, X, type Icon as PhosphorIcon } from '@phosphor-icons/react'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrg } from '@components/Contexts/OrgContext'
import { queryKeys } from '@/lib/query/keys'
import { getAPIUrl } from '@services/config/config'
import { apiFetch } from '@services/utils/ts/requests'
import { createAssignmentTask } from '@services/courses/assignments'
import {
  generateAIAssignment,
  fetchAIAssignmentHistory,
  deleteAIAssignmentHistory,
} from '@services/ai/generation'
import { QUIZ_RESPONSE_SINGLE, resolveQuizResponseType } from '@/lib/quiz/modes'

// ---------------------------------------------------------------------------
// "Generate tasks with AI": teacher-facing entry point on the assignment
// editor. Generates tasks grounded on the assignment's course content, lets
// the teacher preview + edit them, then saves each one to the current
// assignment via the existing `createAssignmentTask` client.
//
// Everything mirrors the surrounding LearnHouse design language (neutral palette, nice-shadow, rounded-lg,
// lucide icons, no AI-gradient styling).
// ---------------------------------------------------------------------------

type AssignmentTypeValue =
  | 'QUIZ'
  | 'FORM'
  | 'SHORT_ANSWER'
  | 'NUMBER_ANSWER'
  | 'FILE_SUBMISSION'

interface GeneratedTask {
  title: string
  description: string
  hint: string
  assignment_type: AssignmentTypeValue
  contents: any
  max_grade_value: number
}

interface AIPlan {
  title?: string
  description?: string
  grading_type?: string
  tasks: GeneratedTask[]
}

interface HistoryItem {
  ai_generation_uuid: string
  session_uuid?: string
  prompt: string
  plan: AIPlan
  creation_date?: string
}

const TYPE_META: Record<
  string,
  { label: string; labelKey?: string; Icon: PhosphorIcon }
> = {
  QUIZ: { label: 'Quiz', labelKey: 'dashboard.assignments.editor.task_type_labels.quiz', Icon: ListChecks },
  FORM: { label: 'Form', labelKey: 'dashboard.assignments.editor.task_type_labels.form', Icon: TextT },
  SHORT_ANSWER: { label: 'Short answer', labelKey: 'dashboard.assignments.editor.task_type_labels.short_answer', Icon: PencilSimple },
  NUMBER_ANSWER: { label: 'Number', labelKey: 'dashboard.assignments.editor.task_type_labels.number_answer', Icon: Hash },
  FILE_SUBMISSION: { label: 'File upload', labelKey: 'dashboard.assignments.editor.task_type_labels.file_submission', Icon: FileArrowUp },
}

const ALL_TYPES: AssignmentTypeValue[] = [
  'QUIZ',
  'FORM',
  'SHORT_ANSWER',
  'NUMBER_ANSWER',
  'FILE_SUBMISSION',
]

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function GenerateTasksAIModal({
  assignment_uuid,
  closeModal,
}: {
  assignment_uuid: string
  closeModal: (_open: boolean) => void
}) {
  const { t } = useTranslation()
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token
  const org = useOrg() as any
  const queryClient = useQueryClient()

  // Resolve the assignment's course_uuid (used to ground the generation).
  // Shares react-query cache with AssignmentProvider so this is usually a
  // cache hit, no extra round trip.
  const { data: assignment } = useQuery({
    queryKey: queryKeys.assignments.detail(assignment_uuid),
    queryFn: () =>
      apiFetch(`${getAPIUrl()}assignments/${assignment_uuid}`, access_token),
    enabled: !!(assignment_uuid && access_token),
    staleTime: 60_000,
  })
  const course_uuid: string | undefined = assignment?.course_uuid

  const [tab, setTab] = React.useState<'generate' | 'history'>('generate')

  // --- Generate form state ---
  const [prompt, setPrompt] = React.useState('')
  const [numTasks, setNumTasks] = React.useState(3)
  const [allowedTypes, setAllowedTypes] = React.useState<Set<AssignmentTypeValue>>(
    new Set(ALL_TYPES)
  )
  const [isGenerating, setIsGenerating] = React.useState(false)
  const [sessionUuid, setSessionUuid] = React.useState<string | undefined>(undefined)

  // --- Preview / editing state ---
  const [plan, setPlan] = React.useState<AIPlan | null>(null)
  const [tasks, setTasks] = React.useState<GeneratedTask[]>([])
  const [isSaving, setIsSaving] = React.useState(false)

  // --- History state ---
  const [history, setHistory] = React.useState<HistoryItem[]>([])
  const [isLoadingHistory, setIsLoadingHistory] = React.useState(false)

  const toggleType = (type: AssignmentTypeValue) => {
    setAllowedTypes((prev) => {
      const next = new Set(prev)
      if (next.has(type)) {
        // Keep at least one type selected.
        if (next.size > 1) next.delete(type)
      } else {
        next.add(type)
      }
      return next
    })
  }

  async function runGenerate(refine = false) {
    if (!org?.id) {
      toast.error(t('dashboard.assignments.editor.generate_ai_modal.org_not_ready'))
      return
    }
    if (!course_uuid) {
      toast.error(t('dashboard.assignments.editor.generate_ai_modal.not_linked'))
      return
    }
    if (!prompt.trim()) {
      toast.error(t('dashboard.assignments.editor.generate_ai_modal.describe_prompt'))
      return
    }
    setIsGenerating(true)
    try {
      const allowed_task_types =
        allowedTypes.size < ALL_TYPES.length ? Array.from(allowedTypes) : undefined
      const res = await generateAIAssignment(
        {
          org_id: org.id,
          course_uuid,
          prompt: prompt.trim(),
          num_tasks: numTasks,
          allowed_task_types,
          // Passing the session_uuid back enables multi-turn refinement.
          session_uuid: refine ? sessionUuid : undefined,
        },
        access_token
      )
      if (res.success && res.data?.plan) {
        setSessionUuid(res.data.session_uuid)
        setPlan(res.data.plan)
        setTasks(clone(res.data.plan.tasks ?? []))
        toast.success(
          refine ? t('dashboard.assignments.editor.generate_ai_modal.refined') : t('dashboard.assignments.editor.generate_ai_modal.generated', { count: res.data.plan.tasks?.length ?? 0 })
        )
      } else {
        toast.error(t('dashboard.assignments.editor.generate_ai_modal.generation_failed'))
      }
    } catch {
      toast.error(t('dashboard.assignments.editor.generate_ai_modal.generation_failed'))
    } finally {
      setIsGenerating(false)
    }
  }

  async function loadHistory() {
    if (!org?.id) return
    setIsLoadingHistory(true)
    try {
      const res = await fetchAIAssignmentHistory(org.id, access_token)
      if (res.success && Array.isArray(res.data)) {
        setHistory(res.data as HistoryItem[])
      } else {
        setHistory([])
      }
    } catch {
      setHistory([])
    } finally {
      setIsLoadingHistory(false)
    }
  }

  function loadFromHistory(item: HistoryItem) {
    setPrompt(item.prompt || '')
    setSessionUuid(item.session_uuid)
    setPlan(item.plan)
    setTasks(clone(item.plan?.tasks ?? []))
    setTab('generate')
    toast.success(t('dashboard.assignments.editor.generate_ai_modal.loaded_previous'))
  }

  async function removeHistory(uuid: string, e: React.MouseEvent) {
    e.stopPropagation()
    try {
      await deleteAIAssignmentHistory(uuid, access_token)
      setHistory((prev) => prev.filter((h) => h.ai_generation_uuid !== uuid))
    } catch (_e) {
      toast.error(t('dashboard.assignments.editor.generate_ai_modal.delete_history_failed'))
    }
  }

  React.useEffect(() => {
    if (tab === 'history') loadHistory()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab])

  // --- Task editing helpers ---
  const updateTask = (index: number, patch: Partial<GeneratedTask>) => {
    setTasks((prev) => prev.map((t, i) => (i === index ? { ...t, ...patch } : t)))
  }

  const updateContents = (index: number, mutate: (_contents: any) => void) => {
    setTasks((prev) =>
      prev.map((t, i) => {
        if (i !== index) return t
        const contents = clone(t.contents ?? {})
        mutate(contents)
        return { ...t, contents }
      })
    )
  }

  const removeTask = (index: number) => {
    setTasks((prev) => prev.filter((_, i) => i !== index))
  }

  async function saveAll() {
    if (tasks.length === 0) return
    setIsSaving(true)
    let saved = 0
    let failed = 0
    // Tasks that didn't persist this round. On a partial failure we keep only
    // these in the preview, so pressing Save again retries just the failures
    // instead of re-posting the ones that already succeeded (which duplicated
    // them).
    const remaining: typeof tasks = []
    try {
      for (const task of tasks) {
        const body = {
          title: task.title,
          description: task.description,
          hint: task.hint,
          reference_file: '',
          assignment_type: task.assignment_type,
          contents: task.contents ?? {},
          max_grade_value: task.max_grade_value ?? 100,
        }
        // createAssignmentTask returns { success: false } on non-200 (it does not throw).
        const res = await createAssignmentTask(body, assignment_uuid, access_token)
        if (res?.success === false) {
          failed += 1
          remaining.push(task)
        } else {
          saved += 1
        }
      }
      // Refresh the task list the editor page renders (react-query key used by
      // AssignmentProvider / Tasks list).
      queryClient.invalidateQueries({ queryKey: queryKeys.assignments.tasks(assignment_uuid) })
      queryClient.invalidateQueries({ queryKey: queryKeys.assignments.detail(assignment_uuid) })
      if (saved > 0) {
        toast.success(t('dashboard.assignments.editor.generate_ai_modal.added_count', { count: saved }))
      }
      if (failed > 0) {
        toast.error(t('dashboard.assignments.editor.generate_ai_modal.save_failed_count', { count: failed }))
      }
      // Only close when everything saved; otherwise keep ONLY the failed tasks
      // in the preview so a retry re-posts just those, never the saved ones.
      if (failed === 0) {
        closeModal(false)
      } else {
        setTasks(remaining)
      }
    } catch {
      toast.error(t('dashboard.assignments.editor.generate_ai_modal.save_failed_some'))
    } finally {
      setIsSaving(false)
    }
  }

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------
  return (
    <div className="flex flex-col gap-4">
      {/* Tabs */}
      <div className="flex items-center gap-1 p-1 bg-gray-100 rounded-lg w-fit">
        <button
          type="button"
          onClick={() => setTab('generate')}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
            tab === 'generate' ? 'bg-white text-gray-900 nice-shadow' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          <Sparkle weight="duotone" size={13} />
          {t('dashboard.assignments.editor.generate_ai_modal.generate')}
        </button>
        <button
          type="button"
          onClick={() => setTab('history')}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
            tab === 'history' ? 'bg-white text-gray-900 nice-shadow' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          <ClockCounterClockwise weight="duotone" size={13} />
          {t('dashboard.assignments.editor.generate_ai_modal.history')}
        </button>
      </div>

      {tab === 'history' ? (
        <HistoryList
          history={history}
          isLoading={isLoadingHistory}
          onLoad={loadFromHistory}
          onRemove={removeHistory}
        />
      ) : (
        <div className="flex flex-col gap-4">
          {/* Prompt panel */}
          <div className="flex flex-col gap-3 p-4 rounded-lg border border-gray-100 nice-shadow bg-white">
            <div>
              <label className="text-xs font-semibold text-gray-700 mb-1.5 block">
                {t('dashboard.assignments.editor.generate_ai_modal.what_cover')}
              </label>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={3}
                placeholder={t('dashboard.assignments.editor.generate_ai_modal.prompt_placeholder')}
                className="w-full px-3 py-2 text-sm text-gray-700 border border-gray-200 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-gray-900/10 focus:border-gray-300"
              />
              <p className="mt-1 text-[11px] text-gray-400">
                {t('dashboard.assignments.editor.generate_ai_modal.grounded_hint')}
              </p>
            </div>

            <div className="flex flex-wrap items-end gap-4">
              <div>
                <label className="text-xs font-semibold text-gray-700 mb-1.5 block">
                  {t('dashboard.assignments.editor.generate_ai_modal.num_tasks')}
                </label>
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={numTasks}
                  onChange={(e) =>
                    setNumTasks(Math.min(10, Math.max(1, parseInt(e.target.value || '1', 10))))
                  }
                  className="w-20 px-3 py-2 text-sm text-gray-700 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-900/10"
                />
              </div>
              <div className="flex-1 min-w-[240px]">
                <label className="text-xs font-semibold text-gray-700 mb-1.5 block">
                  {t('dashboard.assignments.editor.generate_ai_modal.allowed_types')}
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {ALL_TYPES.map((type) => {
                    const meta = TYPE_META[type]
                    const Icon = meta.Icon
                    const active = allowedTypes.has(type)
                    return (
                      <button
                        key={type}
                        type="button"
                        onClick={() => toggleType(type)}
                        className={`flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium rounded-full border transition-colors ${
                          active
                            ? 'bg-gray-900 text-white border-gray-900'
                            : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300'
                        }`}
                      >
                        <Icon weight="duotone" size={12} />
                        {meta.labelKey ? t(meta.labelKey) : meta.label}
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => runGenerate(false)}
                disabled={isGenerating}
                className="flex items-center gap-1.5 px-4 py-2 bg-gray-900 text-white text-xs font-semibold rounded-lg hover:bg-black transition-colors disabled:opacity-50"
              >
                {isGenerating ? <CircleNotch weight="duotone" size={14} className="animate-spin" /> : <Sparkle weight="duotone" size={14} />}
                {plan ? t('dashboard.assignments.editor.generate_ai_modal.regenerate') : t('dashboard.assignments.editor.generate_ai_modal.generate')}
              </button>
              {plan && (
                <button
                  type="button"
                  onClick={() => runGenerate(true)}
                  disabled={isGenerating}
                  className="flex items-center gap-1.5 px-4 py-2 bg-white text-gray-700 text-xs font-semibold rounded-lg border border-gray-200 hover:border-gray-300 transition-colors disabled:opacity-50"
                  title={t('dashboard.assignments.editor.generate_ai_modal.refine_title')}
                >
                  {t('dashboard.assignments.editor.generate_ai_modal.refine')}
                </button>
              )}
            </div>
          </div>

          {/* Preview */}
          {isGenerating && !plan && (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-gray-400">
              <CircleNotch weight="duotone" size={16} className="animate-spin" />
              {t('dashboard.assignments.editor.generate_ai_modal.generating')}
            </div>
          )}

          {plan && (
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-gray-900">
                    {plan.title || t('dashboard.assignments.editor.generate_ai_modal.preview')}
                  </p>
                  {plan.description && (
                    <p className="text-xs text-gray-500">{plan.description}</p>
                  )}
                </div>
                <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">
                  {t('dashboard.assignments.editor.generate_ai_modal.task_count', { count: tasks.length })}
                </span>
              </div>

              {tasks.map((task, index) => (
                <TaskPreviewCard
                  key={index}
                  task={task}
                  index={index}
                  onUpdateTask={updateTask}
                  onUpdateContents={updateContents}
                  onRemove={removeTask}
                />
              ))}

              {tasks.length === 0 && (
                <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50/50 px-4 py-8 text-center text-xs text-gray-400">
                  {t('dashboard.assignments.editor.generate_ai_modal.no_tasks_left')}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => closeModal(false)}
                  className="px-4 py-2 text-xs font-semibold text-gray-600 rounded-lg hover:bg-gray-100 transition-colors"
                >
                  {t('common.cancel')}
                </button>
                <button
                  type="button"
                  onClick={saveAll}
                  disabled={isSaving || tasks.length === 0}
                  className="flex items-center gap-1.5 px-4 py-2 bg-gray-900 text-white text-xs font-semibold rounded-lg hover:bg-black transition-colors disabled:opacity-50"
                >
                  {isSaving ? <CircleNotch weight="duotone" size={14} className="animate-spin" /> : <Plus weight="duotone" size={14} />}
                  {t('dashboard.assignments.editor.generate_ai_modal.add_to_assignment')}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ------------------------------------------------------------------
// History list
// ------------------------------------------------------------------
function HistoryList({
  history,
  isLoading,
  onLoad,
  onRemove,
}: {
  history: HistoryItem[]
  isLoading: boolean
  onLoad: (_item: HistoryItem) => void
  onRemove: (_uuid: string, _e: React.MouseEvent) => void
}) {
  const { t } = useTranslation()
  if (isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 py-10 text-sm text-gray-400">
        <CircleNotch weight="duotone" size={16} className="animate-spin" />
        {t('dashboard.assignments.editor.generate_ai_modal.loading_history')}
      </div>
    )
  }
  if (history.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50/50 px-4 py-10 text-center text-xs text-gray-400">
        {t('dashboard.assignments.editor.generate_ai_modal.no_history')}
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-2">
      {history.map((item) => (
        <button
          key={item.ai_generation_uuid}
          type="button"
          onClick={() => onLoad(item)}
          className="group text-start rounded-lg border border-gray-100 bg-white nice-shadow px-3.5 py-3 hover:border-gray-200 transition-all"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-gray-800 truncate">
                {item.plan?.title || item.prompt || t('dashboard.assignments.editor.generate_ai_modal.untitled_generation')}
              </p>
              <p className="mt-0.5 text-xs text-gray-500 line-clamp-2">{item.prompt}</p>
              <div className="mt-1.5 flex items-center gap-2 text-[11px] text-gray-400">
                <span className="inline-flex items-center gap-1">
                  <ListChecks weight="duotone" size={11} />
                  {t('dashboard.assignments.editor.generate_ai_modal.task_count', { count: item.plan?.tasks?.length ?? 0 })}
                </span>
                {item.creation_date && (
                  <span className="inline-flex items-center gap-1">
                    <Clock weight="duotone" size={11} />
                    {new Date(item.creation_date).toLocaleDateString()}
                  </span>
                )}
              </div>
            </div>
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => onRemove(item.ai_generation_uuid, e)}
              className="flex-none p-1.5 rounded-md text-gray-300 hover:text-rose-500 hover:bg-rose-50 transition-colors"
              title={t('common.delete')}
            >
              <Trash weight="duotone" size={14} />
            </span>
          </div>
        </button>
      ))}
    </div>
  )
}

// ------------------------------------------------------------------
// Per-task editable preview card
// ------------------------------------------------------------------
function TaskPreviewCard({
  task,
  index,
  onUpdateTask,
  onUpdateContents,
  onRemove,
}: {
  task: GeneratedTask
  index: number
  onUpdateTask: (_index: number, _patch: Partial<GeneratedTask>) => void
  onUpdateContents: (_index: number, _mutate: (_contents: any) => void) => void
  onRemove: (_index: number) => void
}) {
  const { t } = useTranslation()
  const meta = TYPE_META[task.assignment_type] ?? { label: task.assignment_type, Icon: TextT }
  const Icon = meta.Icon

  return (
    <div className="rounded-lg border border-gray-100 bg-white nice-shadow overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-50 bg-gray-50/40">
        <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
          <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-gray-200 text-gray-600 font-bold">
            {index + 1}
          </span>
          <Icon weight="duotone" size={13} className="text-gray-400" />
          <span>{meta.labelKey ? t(meta.labelKey) : meta.label}</span>
        </div>
        <button
          type="button"
          onClick={() => onRemove(index)}
          className="p-1 rounded-md text-gray-300 hover:text-rose-500 hover:bg-rose-50 transition-colors"
          title={t('dashboard.assignments.editor.generate_ai_modal.remove_from_preview')}
        >
          <X weight="duotone" size={14} />
        </button>
      </div>

      {/* Common fields */}
      <div className="p-4 flex flex-col gap-3">
        <div>
          <label className="text-[11px] font-semibold text-gray-500 mb-1 block">{t('dashboard.assignments.editor.task_editor.general.title')}</label>
          <input
            value={task.title}
            onChange={(e) => onUpdateTask(index, { title: e.target.value })}
            className="w-full px-3 py-1.5 text-sm font-semibold text-gray-800 border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-gray-900/10"
          />
        </div>
        <div>
          <label className="text-[11px] font-semibold text-gray-500 mb-1 block">{t('dashboard.assignments.editor.task_editor.general.description')}</label>
          <textarea
            value={task.description}
            onChange={(e) => onUpdateTask(index, { description: e.target.value })}
            rows={2}
            className="w-full px-3 py-1.5 text-sm text-gray-700 border border-gray-200 rounded-md resize-none focus:outline-none focus:ring-2 focus:ring-gray-900/10"
          />
        </div>
        <div className="flex gap-3">
          <div className="flex-1">
            <label className="text-[11px] font-semibold text-gray-500 mb-1 block">{t('dashboard.assignments.editor.task_editor.general.hint')}</label>
            <input
              value={task.hint}
              onChange={(e) => onUpdateTask(index, { hint: e.target.value })}
              className="w-full px-3 py-1.5 text-sm text-gray-700 border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-gray-900/10"
            />
          </div>
          <div className="w-28">
            <label className="text-[11px] font-semibold text-gray-500 mb-1 block">{t('dashboard.assignments.editor.generate_ai_modal.max_grade')}</label>
            <input
              type="number"
              min={1}
              value={task.max_grade_value}
              onChange={(e) =>
                onUpdateTask(index, { max_grade_value: parseInt(e.target.value || '0', 10) })
              }
              className="w-full px-3 py-1.5 text-sm text-gray-700 border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-gray-900/10"
            />
          </div>
        </div>

        {/* Type-specific content */}
        <TaskContentEditor index={index} task={task} onUpdateContents={onUpdateContents} />
      </div>
    </div>
  )
}

// ------------------------------------------------------------------
// Type-specific content editors (mirror the shapes the server expects)
// ------------------------------------------------------------------
function TaskContentEditor({
  index,
  task,
  onUpdateContents,
}: {
  index: number
  task: GeneratedTask
  onUpdateContents: (_index: number, _mutate: (_contents: any) => void) => void
}) {
  const { t } = useTranslation()
  const c = task.contents ?? {}
  const inputCls =
    'w-full px-2.5 py-1.5 text-sm text-gray-700 border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-gray-900/10'

  if (task.assignment_type === 'QUIZ') {
    const questions: any[] = Array.isArray(c.questions) ? c.questions : []
    return (
      <div className="flex flex-col gap-3 pt-1">
        {questions.map((q, qi) => (
          <div key={qi} className="rounded-md border border-gray-100 bg-gray-50/40 p-3 flex flex-col gap-2">
            <input
              value={q.questionText ?? ''}
              onChange={(e) =>
                onUpdateContents(index, (contents) => {
                  contents.questions[qi].questionText = e.target.value
                })
              }
              placeholder={t('dashboard.assignments.editor.generate_ai_modal.question')}
              className={inputCls + ' font-semibold'}
            />
            <span className="w-fit px-2 py-0.5 rounded-md bg-gray-100 text-gray-500 text-[11px] font-bold">
              {resolveQuizResponseType(
                q.response_type,
                (q.options ?? []).filter((o: any) => !!o.assigned_right_answer).length
              ) === QUIZ_RESPONSE_SINGLE
                ? t('dashboard.assignments.editor.generate_ai_modal.single_answer')
                : t('dashboard.assignments.editor.generate_ai_modal.multiple_answers')}
            </span>
            <div className="flex flex-col gap-1.5">
              {(q.options ?? []).map((o: any, oi: number) => (
                <div key={oi} className="flex items-center gap-2">
                  <span className="w-5 text-center text-xs font-bold text-gray-400">
                    {String.fromCharCode(65 + oi)}
                  </span>
                  <input
                    value={o.text ?? ''}
                    onChange={(e) =>
                      onUpdateContents(index, (contents) => {
                        contents.questions[qi].options[oi].text = e.target.value
                      })
                    }
                    placeholder={t('dashboard.assignments.editor.generate_ai_modal.option')}
                    className={inputCls}
                  />
                  <button
                    type="button"
                    onClick={() =>
                      onUpdateContents(index, (contents) => {
                        const question = contents.questions[qi]
                        const opt = question.options[oi]
                        const wasCorrect = !!opt.assigned_right_answer
                        opt.assigned_right_answer = !wasCorrect
                        // Keep the key consistent with the question's response
                        // mode: on a pick-one question, marking an option
                        // correct un-marks whatever was correct before.
                        const isSingle =
                          resolveQuizResponseType(
                            question.response_type,
                            (question.options ?? []).filter(
                              (o: any) => !!o.assigned_right_answer
                            ).length
                          ) === QUIZ_RESPONSE_SINGLE
                        if (isSingle && !wasCorrect) {
                          question.options.forEach((other: any, i: number) => {
                            if (i !== oi) other.assigned_right_answer = false
                          })
                        }
                      })
                    }
                    className={`flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-bold transition-colors ${
                      o.assigned_right_answer
                        ? 'bg-lime-100 text-lime-700'
                        : 'bg-rose-50 text-rose-500'
                    }`}
                    title={t('dashboard.assignments.editor.generate_ai_modal.toggle_correct')}
                  >
                    {o.assigned_right_answer ? <Check weight="duotone" size={12} /> : <X weight="duotone" size={12} />}
                    {o.assigned_right_answer ? t('dashboard.assignments.editor.generate_ai_modal.correct') : t('dashboard.assignments.editor.generate_ai_modal.wrong')}
                  </button>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (task.assignment_type === 'FORM') {
    const questions: any[] = Array.isArray(c.questions) ? c.questions : []
    return (
      <div className="flex flex-col gap-3 pt-1">
        {questions.map((q, qi) => (
          <div key={qi} className="rounded-md border border-gray-100 bg-gray-50/40 p-3 flex flex-col gap-2">
            <input
              value={q.questionText ?? ''}
              onChange={(e) =>
                onUpdateContents(index, (contents) => {
                  contents.questions[qi].questionText = e.target.value
                })
              }
              placeholder={t('dashboard.assignments.editor.generate_ai_modal.form_prompt_placeholder')}
              className={inputCls + ' font-semibold'}
            />
            {(q.blanks ?? []).map((b: any, bi: number) => (
              <div key={bi} className="flex items-center gap-2">
                <input
                  value={b.placeholder ?? ''}
                  onChange={(e) =>
                    onUpdateContents(index, (contents) => {
                      contents.questions[qi].blanks[bi].placeholder = e.target.value
                    })
                  }
                  placeholder={t('dashboard.assignments.editor.generate_ai_modal.blank_placeholder')}
                  className={inputCls}
                />
                <input
                  value={b.correctAnswer ?? ''}
                  onChange={(e) =>
                    onUpdateContents(index, (contents) => {
                      contents.questions[qi].blanks[bi].correctAnswer = e.target.value
                    })
                  }
                  placeholder={t('dashboard.assignments.editor.generate_ai_modal.correct_answer')}
                  className={inputCls + ' font-semibold text-emerald-700'}
                />
              </div>
            ))}
          </div>
        ))}
      </div>
    )
  }

  if (task.assignment_type === 'SHORT_ANSWER') {
    const answers: string[] = Array.isArray(c.correct_answers) ? c.correct_answers : []
    return (
      <div className="flex flex-col gap-2 pt-1">
        <input
          value={c.prompt ?? ''}
          onChange={(e) =>
            onUpdateContents(index, (contents) => {
              contents.prompt = e.target.value
            })
          }
          placeholder={t('dashboard.assignments.editor.generate_ai_modal.prompt')}
          className={inputCls + ' font-semibold'}
        />
        <div className="flex flex-col gap-1.5">
          <span className="text-[11px] font-semibold text-gray-500">{t('dashboard.assignments.editor.task_editor.short_answer.answers_label')}</span>
          {answers.map((a, ai) => (
            <input
              key={ai}
              value={a}
              onChange={(e) =>
                onUpdateContents(index, (contents) => {
                  contents.correct_answers[ai] = e.target.value
                })
              }
              className={inputCls + ' text-emerald-700 font-medium'}
            />
          ))}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold text-gray-500">{t('dashboard.assignments.editor.generate_ai_modal.match_mode')}</span>
          <select
            value={c.match_mode ?? 'case_insensitive'}
            onChange={(e) =>
              onUpdateContents(index, (contents) => {
                contents.match_mode = e.target.value
              })
            }
            className="px-2.5 py-1.5 text-sm text-gray-700 border border-gray-200 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-gray-900/10"
          >
            <option value="case_insensitive">{t('dashboard.assignments.editor.generate_ai_modal.match_case_insensitive')}</option>
            <option value="exact">{t('dashboard.assignments.editor.generate_ai_modal.match_exact')}</option>
            <option value="contains">{t('dashboard.assignments.editor.generate_ai_modal.match_contains')}</option>
            <option value="regex">{t('dashboard.assignments.editor.generate_ai_modal.match_regex')}</option>
          </select>
        </div>
      </div>
    )
  }

  if (task.assignment_type === 'NUMBER_ANSWER') {
    return (
      <div className="flex flex-col gap-2 pt-1">
        <input
          value={c.prompt ?? ''}
          onChange={(e) =>
            onUpdateContents(index, (contents) => {
              contents.prompt = e.target.value
            })
          }
          placeholder={t('dashboard.assignments.editor.generate_ai_modal.prompt')}
          className={inputCls + ' font-semibold'}
        />
        <div className="flex items-center gap-2">
          <div className="flex-1">
            <label className="text-[11px] font-semibold text-gray-500 mb-1 block">{t('dashboard.assignments.editor.task_editor.number_answer.correct_value_label')}</label>
            <input
              type="number"
              value={c.correct_value ?? 0}
              onChange={(e) =>
                onUpdateContents(index, (contents) => {
                  contents.correct_value = parseFloat(e.target.value || '0')
                })
              }
              className={inputCls + ' text-emerald-700 font-semibold'}
            />
          </div>
          <div className="flex-1">
            <label className="text-[11px] font-semibold text-gray-500 mb-1 block">{t('dashboard.assignments.editor.task_editor.number_answer.tolerance_label')}</label>
            <input
              type="number"
              value={c.tolerance ?? 0}
              onChange={(e) =>
                onUpdateContents(index, (contents) => {
                  contents.tolerance = parseFloat(e.target.value || '0')
                })
              }
              className={inputCls}
            />
          </div>
          <div className="w-24">
            <label className="text-[11px] font-semibold text-gray-500 mb-1 block">{t('dashboard.assignments.editor.generate_ai_modal.unit')}</label>
            <input
              value={c.unit ?? ''}
              onChange={(e) =>
                onUpdateContents(index, (contents) => {
                  contents.unit = e.target.value
                })
              }
              className={inputCls}
            />
          </div>
        </div>
      </div>
    )
  }

  // FILE_SUBMISSION: no content to edit.
  return (
    <p className="text-xs text-gray-400 italic pt-1">
      {t('dashboard.assignments.editor.generate_ai_modal.file_hint')}
    </p>
  )
}

export default GenerateTasksAIModal
