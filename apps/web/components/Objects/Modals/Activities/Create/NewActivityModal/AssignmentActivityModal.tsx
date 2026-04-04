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

        <div className="grid grid-cols-2 gap-4">
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

          <Form.Field
            name="assignment-activity-grading-type"
            className="space-y-1.5"
          >
            <Form.Label className="text-sm font-medium text-gray-700">
              {t('dashboard.assignments.modals.create.form.grading_type_label')}
            </Form.Label>
            <Form.Control asChild>
              <select
                onChange={(e) => setGradingType(e.target.value)}
                required
                className={inputClass}
              >
                <option value="ALPHABET">
                  {t(
                    'dashboard.assignments.modals.create.form.grading_types.alphabet'
                  )}
                </option>
                <option value="NUMERIC">
                  {t(
                    'dashboard.assignments.modals.create.form.grading_types.numeric'
                  )}
                </option>
                <option value="PERCENTAGE">
                  {t(
                    'dashboard.assignments.modals.create.form.grading_types.percentage'
                  )}
                </option>
              </select>
            </Form.Control>
          </Form.Field>
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

export default NewAssignment
