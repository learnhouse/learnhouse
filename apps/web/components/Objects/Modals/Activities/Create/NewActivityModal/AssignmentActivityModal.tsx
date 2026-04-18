import React from 'react'
import * as Form from '@radix-ui/react-form'
import { BarLoader } from 'react-spinners'
import { Backpack } from '@phosphor-icons/react'
import { useOrg } from '@components/Contexts/OrgContext'
import { getAPIUrl } from '@services/config/config'
import { mutate } from 'swr'
import { createAssignment } from '@services/courses/assignments'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { createActivity, deleteActivity } from '@services/courses/activities'
import toast from 'react-hot-toast'
import { useTranslation } from 'react-i18next'
import {
  ALargeSmall,
  Hash,
  Percent,
  ThumbsUp,
  GraduationCap,
  Check,
  Zap,
  Shield,
  Eye,
} from 'lucide-react'

function NewAssignment({ submitActivity, chapterId, course, closeModal }: any) {
  const { t } = useTranslation()
  const org = useOrg() as any
  const session = useLHSession() as any
  const withUnpublishedActivities = course
    ? course.withUnpublishedActivities
    : false
  const [activityName, setActivityName] = React.useState('')
  const [isSubmitting, setIsSubmitting] = React.useState(false)
  const [activityDescription, setActivityDescription] = React.useState('')
  const [dueDate, setDueDate] = React.useState('')
  const [gradingType, setGradingType] = React.useState('ALPHABET')
  const [autoGrading, setAutoGrading] = React.useState(false)
  const [antiCopyPaste, setAntiCopyPaste] = React.useState(false)
  const [showCorrectAnswers, setShowCorrectAnswers] = React.useState(false)

  const handleSubmit = async (e: any) => {
    e.preventDefault()
    setIsSubmitting(true)
    const activity = {
      name: activityName,
      chapter_id: chapterId,
      activity_type: 'TYPE_ASSIGNMENT',
      activity_sub_type: 'SUBTYPE_ASSIGNMENT_ANY',
      published: false,
      course_id: course?.courseStructure.id,
    }

    const activity_res = await createActivity(
      activity,
      chapterId,
      org?.id,
      session.data?.tokens?.access_token
    )
    const res = await createAssignment(
      {
        title: activityName,
        description: activityDescription,
        due_date: dueDate,
        grading_type: gradingType,
        auto_grading: autoGrading,
        anti_copy_paste: antiCopyPaste,
        show_correct_answers: showCorrectAnswers,
        course_id: course?.courseStructure.id,
        org_id: org?.id,
        chapter_id: chapterId,
        activity_id: activity_res?.id,
      },
      session.data?.tokens?.access_token
    )
    const toast_loading = toast.loading(
      t('dashboard.assignments.modals.create.toasts.creating')
    )

    if (res.success) {
      toast.dismiss(toast_loading)
      toast.success(t('dashboard.assignments.modals.create.toasts.success'))
    } else {
      toast.error(res.data.detail)
      await deleteActivity(
        activity_res.activity_uuid,
        session.data?.tokens?.access_token
      )
    }

    mutate(
      `${getAPIUrl()}courses/${course.courseStructure.course_uuid}/meta?with_unpublished_activities=${withUnpublishedActivities}`
    )
    mutate(
      (key) => typeof key === 'string' && key.includes('/courses/org_slug/')
    )
    mutate(
      (key) =>
        typeof key === 'string' && key.includes('/assignments/course/')
    )
    setIsSubmitting(false)
    closeModal()
  }

  const inputClass =
    'w-full h-9 px-3 text-sm rounded-lg bg-gray-50 border border-gray-200 outline-none focus:border-gray-300 focus:ring-1 focus:ring-gray-200 transition-colors'

  return (
    <Form.Root onSubmit={handleSubmit} className="space-y-4">
      <div
        className="relative flex items-center justify-center h-20 rounded-xl overflow-hidden"
        style={{
          backgroundImage:
            'repeating-linear-gradient(90deg, transparent, transparent 5px, rgba(253,230,138,0.25) 5px, rgba(253,230,138,0.25) 6px)',
        }}
      >
        <span className="flex items-center gap-2 bg-white nice-shadow rounded-full px-4 py-1.5 text-sm font-medium text-gray-600">
          <Backpack size={18} weight="duotone" className="text-amber-400" />
          {t('dashboard.courses.structure.activity.types.assignments')}
        </span>
      </div>

      {/* Basic info */}
      <div className="rounded-xl nice-shadow p-4 space-y-4">
        <Form.Field name="assignment-activity-title" className="space-y-1.5">
          <Form.Label className="text-sm font-medium text-gray-700">
            {t('dashboard.assignments.modals.create.form.title_label')}
          </Form.Label>
          <Form.Message match="valueMissing" className="text-xs text-red-500">
            {t('dashboard.assignments.modals.create.form.title_required')}
          </Form.Message>
          <Form.Control asChild>
            <input
              onChange={(e) => setActivityName(e.target.value)}
              type="text"
              required
              className={inputClass}
            />
          </Form.Control>
        </Form.Field>

        <Form.Field
          name="assignment-activity-description"
          className="space-y-1.5"
        >
          <Form.Label className="text-sm font-medium text-gray-700">
            {t('dashboard.assignments.modals.create.form.description_label')}
          </Form.Label>
          <Form.Message match="valueMissing" className="text-xs text-red-500">
            {t('dashboard.assignments.modals.create.form.description_required')}
          </Form.Message>
          <Form.Control asChild>
            <textarea
              onChange={(e) => setActivityDescription(e.target.value)}
              required
              rows={3}
              className="w-full px-3 py-2 text-sm rounded-lg bg-gray-50 border border-gray-200 outline-none focus:border-gray-300 focus:ring-1 focus:ring-gray-200 transition-colors resize-none"
            />
          </Form.Control>
        </Form.Field>

        <Form.Field
          name="assignment-activity-due-date"
          className="space-y-1.5"
        >
          <Form.Label className="text-sm font-medium text-gray-700">
            {t('dashboard.assignments.modals.create.form.due_date_label')}
          </Form.Label>
          <Form.Message match="valueMissing" className="text-xs text-red-500">
            {t('dashboard.assignments.modals.create.form.due_date_required')}
          </Form.Message>
          <Form.Control asChild>
            <input
              onChange={(e) => setDueDate(e.target.value)}
              type="date"
              required
              className={inputClass}
            />
          </Form.Control>
        </Form.Field>
      </div>

      {/* Grading type */}
      <div className="rounded-xl nice-shadow p-4 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-gray-700">
            {t('dashboard.assignments.modals.create.form.grading_type_label')}
          </p>
          <p className="text-[10px] text-gray-400">
            {t('dashboard.assignments.modals.create.form.grading_type_hint')}
          </p>
        </div>
        <GradingTypeSelector
          value={gradingType}
          onChange={setGradingType}
          translationPrefix="dashboard.assignments.modals.create.form"
        />
      </div>

      {/* Grading options */}
      <div className="rounded-xl nice-shadow p-4 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-gray-700">
            {t('dashboard.assignments.modals.create.form.grading_options_label')}
          </p>
          <p className="text-[10px] text-gray-400">
            {t('dashboard.assignments.modals.create.form.grading_options_hint')}
          </p>
        </div>
        <div className="space-y-2">
          <SmallToggleRow
            icon={<Zap size={16} className="text-amber-500" />}
            label={t('dashboard.assignments.modals.create.form.auto_grading_label')}
            description={t('dashboard.assignments.modals.create.form.auto_grading_description')}
            checked={autoGrading}
            onChange={setAutoGrading}
          />
          <SmallToggleRow
            icon={<Shield size={16} className="text-cyan-500" />}
            label={t('dashboard.assignments.modals.create.form.anti_copy_paste_label')}
            description={t('dashboard.assignments.modals.create.form.anti_copy_paste_description')}
            checked={antiCopyPaste}
            onChange={setAntiCopyPaste}
          />
          <SmallToggleRow
            icon={<Eye size={16} className="text-indigo-500" />}
            label={t('dashboard.assignments.modals.create.form.show_correct_answers_label')}
            description={t('dashboard.assignments.modals.create.form.show_correct_answers_description')}
            checked={showCorrectAnswers}
            onChange={setShowCorrectAnswers}
          />
        </div>
      </div>

      <div className="flex justify-end">
        <Form.Submit asChild>
          <button
            type="submit"
            disabled={isSubmitting}
            className="inline-flex items-center justify-center h-9 px-5 text-sm font-medium text-white bg-black rounded-lg hover:bg-gray-800 transition-colors disabled:opacity-50"
          >
            {isSubmitting ? (
              <BarLoader
                cssOverride={{ borderRadius: 60 }}
                width={60}
                color="#ffffff"
              />
            ) : (
              t('dashboard.assignments.modals.create.form.submit')
            )}
          </button>
        </Form.Submit>
      </div>
    </Form.Root>
  )
}

const GRADING_TYPE_OPTIONS: {
  value: string
  labelKey: string
  descriptionKey: string
  icon: React.ReactNode
  color: string
  selectedBorder: string
  selectedBg: string
  illustration: string
}[] = [
  { value: 'ALPHABET', labelKey: 'grading_types.alphabet', descriptionKey: 'grading_type_descriptions.alphabet', icon: <ALargeSmall size={18} />, color: 'text-violet-600', selectedBorder: 'border-violet-400', selectedBg: 'bg-violet-50', illustration: 'A  B  C' },
  { value: 'NUMERIC', labelKey: 'grading_types.numeric', descriptionKey: 'grading_type_descriptions.numeric', icon: <Hash size={18} />, color: 'text-blue-600', selectedBorder: 'border-blue-400', selectedBg: 'bg-blue-50', illustration: '0 — 100' },
  { value: 'PERCENTAGE', labelKey: 'grading_types.percentage', descriptionKey: 'grading_type_descriptions.percentage', icon: <Percent size={18} />, color: 'text-emerald-600', selectedBorder: 'border-emerald-400', selectedBg: 'bg-emerald-50', illustration: '85%' },
  { value: 'PASS_FAIL', labelKey: 'grading_types.pass_fail', descriptionKey: 'grading_type_descriptions.pass_fail', icon: <ThumbsUp size={18} />, color: 'text-amber-600', selectedBorder: 'border-amber-400', selectedBg: 'bg-amber-50', illustration: 'P / F' },
  { value: 'GPA_SCALE', labelKey: 'grading_types.gpa_scale', descriptionKey: 'grading_type_descriptions.gpa_scale', icon: <GraduationCap size={18} />, color: 'text-rose-600', selectedBorder: 'border-rose-400', selectedBg: 'bg-rose-50', illustration: '0.0 — 4.0' },
]

function GradingTypeSelector({ value, onChange, translationPrefix }: { value: string; onChange: (v: string) => void; translationPrefix: string }) {
  const { t } = useTranslation()
  return (
    <div className="grid grid-cols-3 gap-2">
      {GRADING_TYPE_OPTIONS.map((gt) => {
        const isSelected = value === gt.value
        return (
          <button
            key={gt.value}
            type="button"
            onClick={() => onChange(gt.value)}
            className={`relative flex flex-col items-center text-center p-3 rounded-xl border-2 transition-all cursor-pointer ${
              isSelected
                ? `${gt.selectedBorder} ${gt.selectedBg}`
                : 'border-gray-100 bg-white hover:border-gray-200 hover:bg-gray-50/50'
            }`}
          >
            {isSelected && (
              <div className={`absolute top-1.5 right-1.5 w-3.5 h-3.5 rounded-full flex items-center justify-center ${gt.color} bg-white nice-shadow`}>
                <Check size={8} strokeWidth={3} />
              </div>
            )}
            <div className={`text-sm font-mono font-bold mb-1.5 tracking-wider ${isSelected ? gt.color : 'text-gray-300'}`}>
              {gt.illustration}
            </div>
            <div className={`mb-0.5 ${isSelected ? gt.color : 'text-gray-400'}`}>
              {gt.icon}
            </div>
            <p className={`text-[11px] font-bold ${isSelected ? 'text-gray-900' : 'text-gray-500'}`}>
              {t(`${translationPrefix}.${gt.labelKey}`)}
            </p>
            <p className='text-[9px] text-gray-400 mt-0.5 leading-tight'>
              {t(`${translationPrefix}.${gt.descriptionKey}`)}
            </p>
          </button>
        )
      })}
    </div>
  )
}

function SmallToggleRow({
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
  onChange: (next: boolean) => void
}) {
  return (
    <div className="flex items-start justify-between gap-3 p-2.5 rounded-lg border border-gray-100 bg-white">
      <div className="flex items-start gap-2 flex-1 min-w-0">
        <div className="mt-0.5 flex-none">{icon}</div>
        <div className="flex flex-col min-w-0">
          <p className="text-xs font-bold text-gray-900">{label}</p>
          <p className="text-[10px] text-gray-500 leading-snug mt-0.5">{description}</p>
        </div>
      </div>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        aria-pressed={checked}
        className={`relative flex-none inline-flex h-5 w-9 items-center rounded-full transition-colors ${
          checked ? 'bg-gray-900' : 'bg-gray-200 hover:bg-gray-300'
        }`}
      >
        <span
          className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
            checked ? 'translate-x-5' : 'translate-x-1'
          }`}
        />
      </button>
    </div>
  )
}

export default NewAssignment
