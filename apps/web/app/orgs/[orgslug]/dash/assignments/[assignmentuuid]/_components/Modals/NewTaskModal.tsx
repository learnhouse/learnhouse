import { useAssignmentsTaskDispatch } from '@components/Contexts/Assignments/AssignmentsTaskContext';
import { useLHSession } from '@components/Contexts/LHSessionContext';
import { createAssignmentTask } from '@services/courses/assignments'
import {
  Code,
  FileArrowUp,
  Hash,
  ListChecks,
  PencilSimple,
  TextAa,
} from '@phosphor-icons/react'
import React from 'react'
import toast from 'react-hot-toast';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/keys';
import { useTranslation } from 'react-i18next';
import { useLHAnalytics, AnalyticsEvent } from '@services/analytics';

// Light color themes for each task type. `stripeRgb` is used to build the
// repeating-linear-gradient pattern that gives each card its subtle wallpaper
// effect (same technique as AssignmentActivityModal).
type TaskTypeConfig = {
  value: string
  Icon: React.ComponentType<{ size?: number; weight?: any; className?: string }>
  labelKey: string
  descKey: string
  iconColor: string
  titleColor: string
  bgClass: string
  stripeRgb: string
}

const TASK_TYPES: TaskTypeConfig[] = [
  {
    value: 'QUIZ',
    Icon: ListChecks,
    labelKey: 'dashboard.assignments.editor.task_types.quiz.title',
    descKey: 'dashboard.assignments.editor.task_types.quiz.description',
    iconColor: 'text-sky-500',
    titleColor: 'text-sky-900',
    bgClass: 'bg-sky-50',
    stripeRgb: '186, 230, 253',
  },
  {
    value: 'FILE_SUBMISSION',
    Icon: FileArrowUp,
    labelKey: 'dashboard.assignments.editor.task_types.file_submission.title',
    descKey: 'dashboard.assignments.editor.task_types.file_submission.description',
    iconColor: 'text-violet-500',
    titleColor: 'text-violet-900',
    bgClass: 'bg-violet-50',
    stripeRgb: '221, 214, 254',
  },
  {
    value: 'FORM',
    Icon: TextAa,
    labelKey: 'dashboard.assignments.editor.task_types.form.title',
    descKey: 'dashboard.assignments.editor.task_types.form.description',
    iconColor: 'text-rose-500',
    titleColor: 'text-rose-900',
    bgClass: 'bg-rose-50',
    stripeRgb: '254, 205, 211',
  },
  {
    value: 'CODE',
    Icon: Code,
    labelKey: 'dashboard.assignments.editor.task_types.code.title',
    descKey: 'dashboard.assignments.editor.task_types.code.description',
    iconColor: 'text-emerald-500',
    titleColor: 'text-emerald-900',
    bgClass: 'bg-emerald-50',
    stripeRgb: '187, 247, 208',
  },
  {
    value: 'SHORT_ANSWER',
    Icon: PencilSimple,
    labelKey: 'dashboard.assignments.editor.task_types.short_answer.title',
    descKey: 'dashboard.assignments.editor.task_types.short_answer.description',
    iconColor: 'text-cyan-500',
    titleColor: 'text-cyan-900',
    bgClass: 'bg-cyan-50',
    stripeRgb: '207, 250, 254',
  },
  {
    value: 'NUMBER_ANSWER',
    Icon: Hash,
    labelKey: 'dashboard.assignments.editor.task_types.number_answer.title',
    descKey: 'dashboard.assignments.editor.task_types.number_answer.description',
    iconColor: 'text-amber-500',
    titleColor: 'text-amber-900',
    bgClass: 'bg-amber-50',
    stripeRgb: '253, 230, 138',
  },
]

function NewTaskModal({ closeModal, assignment_uuid }: any) {
  const { t } = useTranslation()
  const session = useLHSession() as any;
  const access_token = session?.data?.tokens?.access_token;
  const assignmentTaskStateHook = useAssignmentsTaskDispatch() as any
  const queryClient = useQueryClient()
  const { track } = useLHAnalytics('dashboard')

  function showReminderToast() {
    // Check if the reminder has already been shown using sessionStorage
    if (sessionStorage.getItem("TasksReminderShown") !== "true") {
      setTimeout(() => {
        toast(t('dashboard.assignments.editor.toasts.reminder'),
          { icon: '✋', duration: 10000, style: { minWidth: 600 } });
        // Mark the reminder as shown in sessionStorage
        sessionStorage.setItem("TasksReminderShown", "true");
      }, 3000);
    }
  }

  async function createTask(type: string) {
    const task_object = {
      title: "Untitled Task",
      description: "",
      hint: "",
      reference_file: "",
      assignment_type: type,
      contents: {},
      max_grade_value: 100,
    }
    const existingTasks = queryClient.getQueryData<any[]>(queryKeys.assignments.tasks(assignment_uuid))
    const res = await createAssignmentTask(task_object, assignment_uuid, access_token)
    toast.success(t('dashboard.assignments.editor.toasts.task_created'))
    track(AnalyticsEvent.AssignmentTaskCreated, {
      task_type: type,
      existing_task_count: Array.isArray(existingTasks) ? existingTasks.length : 0,
    })
    showReminderToast()
    queryClient.invalidateQueries({ queryKey: queryKeys.assignments.tasks(assignment_uuid) })
    assignmentTaskStateHook({ type: 'setSelectedAssignmentTaskUUID', payload: res.data.assignment_task_uuid })
    closeModal(false)
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 py-1">
      {TASK_TYPES.map((type) => {
        const IconComponent = type.Icon
        return (
          <button
            key={type.value}
            type="button"
            onClick={() => createTask(type.value)}
            className={`relative flex sm:flex-col items-center gap-3 sm:gap-0 text-start sm:text-center p-4 sm:p-5 rounded-2xl nice-shadow cursor-pointer transition-all hover:-translate-y-0.5 hover:shadow-lg active:translate-y-0 overflow-hidden ${type.bgClass}`}
            style={{
              backgroundImage: `repeating-linear-gradient(135deg, transparent, transparent 5px, rgba(${type.stripeRgb},0.35) 5px, rgba(${type.stripeRgb},0.35) 6px)`,
            }}
          >
            <div className={`w-12 h-12 sm:w-14 sm:h-14 shrink-0 rounded-2xl bg-white nice-shadow flex items-center justify-center sm:mb-3 ${type.iconColor}`}>
              <IconComponent size={26} weight="duotone" />
            </div>
            <div className="min-w-0">
              <p className={`text-sm font-bold ${type.titleColor}`}>
                {t(type.labelKey)}
              </p>
              <p className="text-xs text-neutral-600 leading-snug mt-0.5 sm:mt-1 sm:max-w-[180px] sm:mx-auto">
                {t(type.descKey)}
              </p>
            </div>
          </button>
        )
      })}
    </div>
  )
}

export default NewTaskModal
