import React from 'react'
import {
  ArrowCounterClockwise,
  ClipboardText,
  Eye,
  GraduationCap,
  Hash,
  Infinity as InfinityIcon,
  Lightning,
  Minus,
  Percent,
  Plus,
  ShieldCheck,
  TextAa,
  ThumbsUp,
} from '@phosphor-icons/react'
import { Switch } from '@components/ui/switch'
import { Button, INPUT, TEXTAREA } from '@components/Dashboard/Shared/DashKit/DashKit'
import { ActivityField, ModalFormActions, useModalFormId } from '../../activityFormKit'
import { useOrg } from '@components/Contexts/OrgContext'
import { useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query/keys'
import { createAssignment } from '@services/courses/assignments'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { createActivity, deleteActivity } from '@services/courses/activities'
import toast from 'react-hot-toast'
import { useTranslation } from 'react-i18next'
import { useLHAnalytics, AnalyticsEvent } from '@services/analytics'
import { useUpgradeModal } from '@components/Dashboard/Shared/PlanRestricted/UpgradeModalContext'
import { getErrorMessage } from '@services/utils/ts/errorMessage'

function NewAssignment({ submitActivity: _submitActivity, chapterId, course, closeModal }: any) {
  const { t } = useTranslation()
  const formId = useModalFormId()
  const org = useOrg() as any
  const session = useLHSession() as any
  const queryClient = useQueryClient()
  const { track } = useLHAnalytics('dashboard')
  const { handlePlanLimit } = useUpgradeModal()
  const cleanCourseUuid = (id: string) => id?.replace(/^course_/, '') ?? id
  const _withUnpublishedActivities = course
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
  const [allowRetries, setAllowRetries] = React.useState(false)
  const [maxRetries, setMaxRetries] = React.useState(0)
  // Formative mode: handed in, never marked. The model answer that pairs with
  // it is authored afterwards in the assignment editor.
  const [ungraded, setUngraded] = React.useState(false)

  const handleSubmit = async (e: any) => {
    e.preventDefault()
    if (isSubmitting) return
    setIsSubmitting(true)
    try {
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
        // Empty means no deadline; send null rather than an empty string so the
        // column reads as unset instead of as a value nothing can parse.
        due_date: dueDate || null,
        grading_type: gradingType,
        ungraded: ungraded,
        // An ungraded assignment never auto-grades and has no answer key to
        // reveal, so send the consistent state instead of dead flags.
        auto_grading: ungraded ? false : autoGrading,
        anti_copy_paste: antiCopyPaste,
        show_correct_answers: ungraded ? false : showCorrectAnswers,
        allow_retries: allowRetries,
        max_retries: allowRetries ? maxRetries : 0,
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
      track(AnalyticsEvent.AssignmentCreated, {
        grading_type: gradingType,
        auto_grading: autoGrading,
        allow_retries: allowRetries,
        has_due_date: !!dueDate,
      })
    } else {
      toast.dismiss(toast_loading)
      // Assignments are quota-limited on the free plan → offer an upgrade
      // rather than a dead-end error toast.
      if (!handlePlanLimit(res, { source: 'assignment_create', feature: 'assignments', requiredPlan: 'standard' })) {
        toast.error(getErrorMessage(res.data?.detail, t('dashboard.assignments.modals.create.toasts.error')))
      }
      await deleteActivity(
        activity_res.activity_uuid,
        session.data?.tokens?.access_token
      )
    }

    queryClient.invalidateQueries({ queryKey: queryKeys.courses.meta(cleanCourseUuid(course.courseStructure.course_uuid)) })
    queryClient.invalidateQueries({ queryKey: ['courses'] })
    queryClient.invalidateQueries({ queryKey: ['assignments'] })
    closeModal()
    } catch {
      toast.error(t('dashboard.assignments.modals.create.toasts.error'))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <form id={formId} onSubmit={handleSubmit} className="space-y-5">
      {/* Basics */}
      <div className="space-y-4">
        <ActivityField label={t('dashboard.assignments.modals.create.form.title_label')} htmlFor="assignment-activity-title">
          <input
            id="assignment-activity-title"
            autoFocus
            value={activityName}
            onChange={(e) => setActivityName(e.target.value)}
            type="text"
            required
            placeholder={t('dashboard.courses.editor.activity_form.assignment_placeholder')}
            className={INPUT}
          />
        </ActivityField>

        <ActivityField label={t('dashboard.assignments.modals.create.form.description_label')} htmlFor="assignment-activity-description">
          <textarea
            id="assignment-activity-description"
            value={activityDescription}
            onChange={(e) => setActivityDescription(e.target.value)}
            required
            rows={3}
            className={TEXTAREA}
          />
        </ActivityField>

        {/* Optional: a self-paced course has no date that means anything to a
            learner who enrolled today. */}
        <ActivityField
          label={t('dashboard.assignments.modals.create.form.due_date_label')}
          htmlFor="assignment-activity-due-date"
          hint={t('dashboard.assignments.modals.create.form.due_date_hint')}
          aside={
            dueDate ? (
              <button
                type="button"
                onClick={() => setDueDate('')}
                className="text-xs font-medium text-neutral-400 hover:text-neutral-700 transition-colors"
              >
                {t('dashboard.assignments.modals.create.form.due_date_clear')}
              </button>
            ) : undefined
          }
        >
          <input
            id="assignment-activity-due-date"
            onChange={(e) => setDueDate(e.target.value)}
            value={dueDate}
            type="date"
            className={INPUT}
          />
        </ActivityField>
      </div>

      {/* Grading type: irrelevant on a formative assignment, which never
          produces a grade to display in any scale. */}
      {!ungraded && (
        <ActivityField
          label={t('dashboard.assignments.modals.create.form.grading_type_label')}
          aside={<span className="text-xs text-neutral-400">{t('dashboard.assignments.modals.create.form.grading_type_hint')}</span>}
        >
          <GradingTypeSelector
            value={gradingType}
            onChange={setGradingType}
            translationPrefix="dashboard.assignments.modals.create.form"
          />
        </ActivityField>
      )}

      {/* Grading options */}
      <ActivityField
        label={t('dashboard.assignments.modals.create.form.grading_options_label')}
        aside={<span className="text-xs text-neutral-400">{t('dashboard.assignments.modals.create.form.grading_options_hint')}</span>}
      >
        <div className="rounded-xl ring-1 ring-inset ring-neutral-200 divide-y divide-neutral-100">
          <SmallToggleRow
            icon={<ClipboardText size={16} />}
            label={t('dashboard.assignments.modals.edit.form.ungraded_label', { defaultValue: 'Formative (no grading)' })}
            description={t('dashboard.assignments.modals.create.form.ungraded_description', { defaultValue: 'Learners hand their work in and it is never marked. Add a model answer in the assignment editor to unlock on hand-in.' })}
            checked={ungraded}
            onChange={setUngraded}
          />
          {!ungraded && (
            <SmallToggleRow
              icon={<Lightning size={16} />}
              label={t('dashboard.assignments.modals.create.form.auto_grading_label')}
              description={t('dashboard.assignments.modals.create.form.auto_grading_description')}
              checked={autoGrading}
              onChange={setAutoGrading}
            />
          )}
          <SmallToggleRow
            icon={<ShieldCheck size={16} />}
            label={t('dashboard.assignments.modals.create.form.anti_copy_paste_label')}
            description={t('dashboard.assignments.modals.create.form.anti_copy_paste_description')}
            checked={antiCopyPaste}
            onChange={setAntiCopyPaste}
          />
          {!ungraded && (
            <SmallToggleRow
              icon={<Eye size={16} />}
              label={t('dashboard.assignments.modals.create.form.show_correct_answers_label')}
              description={t('dashboard.assignments.modals.create.form.show_correct_answers_description')}
              checked={showCorrectAnswers}
              onChange={setShowCorrectAnswers}
            />
          )}
          <SmallToggleRow
            icon={<ArrowCounterClockwise size={16} />}
            label={t('dashboard.assignments.modals.edit.form.allow_retries_label')}
            description={
              // The default copy says retries happen "after it's graded",
              // which never comes true in formative mode.
              ungraded
                ? t('dashboard.assignments.modals.edit.form.allow_retries_description_ungraded', {
                    defaultValue:
                      'Let learners reset and hand the assignment in again. Each retry wipes their previous work and re-locks the model answer.',
                  })
                : t('dashboard.assignments.modals.edit.form.allow_retries_description')
            }
            checked={allowRetries}
            onChange={setAllowRetries}
          >
            {allowRetries && (
              <div className="mt-3 flex items-center justify-between gap-3 rounded-lg bg-neutral-50 px-3 py-2.5">
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-neutral-700">
                    {t('dashboard.assignments.modals.edit.form.max_retries_label')}
                  </p>
                  <p className="text-xs text-neutral-500 mt-0.5 flex items-center gap-1">
                    {maxRetries === 0 ? (
                      <>
                        <InfinityIcon size={12} />
                        <span>{t('dashboard.assignments.modals.edit.form.max_retries_unlimited')}</span>
                      </>
                    ) : (
                      <span>{t('dashboard.assignments.modals.edit.form.max_retries_bounded')}</span>
                    )}
                  </p>
                </div>
                <div className="flex-none flex items-center gap-1.5">
                  <Button
                    size="icon"
                    icon={<Minus size={12} />}
                    aria-label="-"
                    onClick={() => setMaxRetries(Math.max(0, maxRetries - 1))}
                  />
                  <input
                    type="number"
                    min={0}
                    max={20}
                    value={maxRetries}
                    onChange={(e) => {
                      const raw = parseInt(e.target.value, 10)
                      setMaxRetries(isNaN(raw) ? 0 : Math.max(0, Math.min(20, raw)))
                    }}
                    aria-label={t('dashboard.assignments.modals.edit.form.max_retries_label')}
                    className="w-12 h-7 text-center text-sm font-semibold text-neutral-900 bg-white rounded-md ring-1 ring-inset ring-neutral-200 outline-none focus:ring-2 focus:ring-neutral-900/15"
                  />
                  <Button
                    size="icon"
                    icon={<Plus size={12} />}
                    aria-label="+"
                    onClick={() => setMaxRetries(Math.min(20, maxRetries + 1))}
                  />
                </div>
              </div>
            )}
          </SmallToggleRow>
        </div>
      </ActivityField>

      <ModalFormActions
        submitting={isSubmitting}
        canSubmit={!!activityName.trim() && !!activityDescription.trim()}
        label={t('dashboard.assignments.modals.create.form.submit')}
      />
    </form>
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
  { value: 'ALPHABET', labelKey: 'grading_types.alphabet', descriptionKey: 'grading_type_descriptions.alphabet', icon: <TextAa size={16} />, color: 'text-violet-600', selectedBorder: 'border-violet-400', selectedBg: 'bg-violet-50', illustration: 'A  B  C' },
  { value: 'NUMERIC', labelKey: 'grading_types.numeric', descriptionKey: 'grading_type_descriptions.numeric', icon: <Hash size={16} />, color: 'text-blue-600', selectedBorder: 'border-blue-400', selectedBg: 'bg-blue-50', illustration: '0 to 100' },
  { value: 'PERCENTAGE', labelKey: 'grading_types.percentage', descriptionKey: 'grading_type_descriptions.percentage', icon: <Percent size={16} />, color: 'text-emerald-600', selectedBorder: 'border-emerald-400', selectedBg: 'bg-emerald-50', illustration: '85%' },
  { value: 'PASS_FAIL', labelKey: 'grading_types.pass_fail', descriptionKey: 'grading_type_descriptions.pass_fail', icon: <ThumbsUp size={16} />, color: 'text-amber-600', selectedBorder: 'border-amber-400', selectedBg: 'bg-amber-50', illustration: 'P / F' },
  { value: 'GPA_SCALE', labelKey: 'grading_types.gpa_scale', descriptionKey: 'grading_type_descriptions.gpa_scale', icon: <GraduationCap size={16} />, color: 'text-rose-600', selectedBorder: 'border-rose-400', selectedBg: 'bg-rose-50', illustration: '0.0 to 4.0' },
]

function GradingTypeSelector({ value, onChange, translationPrefix }: { value: string; onChange: (_v: string) => void; translationPrefix: string }) {
  const { t } = useTranslation()
  return (
    <div role="radiogroup" className="grid grid-cols-2 sm:grid-cols-3 gap-2">
      {GRADING_TYPE_OPTIONS.map((gt) => {
        const isSelected = value === gt.value
        return (
          <button
            key={gt.value}
            type="button"
            role="radio"
            aria-checked={isSelected}
            onClick={() => onChange(gt.value)}
            className={`relative flex flex-col items-start text-start gap-1 p-3 rounded-xl transition-all ${
              isSelected ? 'bg-white ring-2 ring-neutral-900 shadow-sm' : 'bg-white ring-1 ring-inset ring-neutral-200 hover:ring-neutral-300'
            }`}
          >
            <span className="flex w-full items-center justify-between gap-2">
              <span className={isSelected ? gt.color : 'text-neutral-400'}>{gt.icon}</span>
              <span className={`text-xs font-mono font-semibold tracking-wide ${isSelected ? 'text-neutral-700' : 'text-neutral-300'}`}>
                {gt.illustration}
              </span>
            </span>
            <span className="text-xs font-semibold text-neutral-900">{t(`${translationPrefix}.${gt.labelKey}`)}</span>
            <span className="text-[11px] text-neutral-500 leading-snug">{t(`${translationPrefix}.${gt.descriptionKey}`)}</span>
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
  children,
}: {
  icon: React.ReactNode
  label: string
  description: string
  checked: boolean
  onChange: (_next: boolean) => void
  children?: React.ReactNode
}) {
  return (
    <div className="px-3.5 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5 flex-1 min-w-0">
          <span className="mt-0.5 flex-none text-neutral-400">{icon}</span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-neutral-900">{label}</p>
            <p className="text-xs text-neutral-500 leading-snug mt-0.5">{description}</p>
          </div>
        </div>
        <Switch checked={checked} onCheckedChange={onChange} aria-label={label} />
      </div>
      {children}
    </div>
  )
}

export default NewAssignment
