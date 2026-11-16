import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { INPUT } from '@components/Dashboard/Shared/DashKit/DashKit'
import { ActivityField, ModalFormActions, useModalFormId } from '../../activityFormKit'

function DynamicCanvaModal({ submitActivity, chapterId, course }: any) {
  const { t } = useTranslation()
  const formId = useModalFormId()
  const [activityName, setActivityName] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!activityName.trim() || isSubmitting) return
    setIsSubmitting(true)
    try {
      await submitActivity({
        name: activityName.trim(),
        chapter_id: chapterId,
        activity_type: 'TYPE_DYNAMIC',
        activity_sub_type: 'SUBTYPE_DYNAMIC_PAGE',
        published_version: 1,
        version: 1,
        course_id: course.id,
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <form id={formId} onSubmit={handleSubmit} className="space-y-4">
      <ActivityField
        label={t('activities.modal.activity_name')}
        htmlFor="dynamic-activity-name"
        hint={t('dashboard.courses.editor.activity_form.dynamic_hint')}
      >
        <input
          id="dynamic-activity-name"
          autoFocus
          value={activityName}
          onChange={(e) => setActivityName(e.target.value)}
          type="text"
          required
          placeholder={t('dashboard.courses.editor.activity_form.dynamic_placeholder')}
          className={INPUT}
        />
      </ActivityField>
      <ModalFormActions
        submitting={isSubmitting}
        canSubmit={!!activityName.trim()}
        label={t('activities.modal.create_activity')}
      />
    </form>
  )
}

export default DynamicCanvaModal
