import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { INPUT } from '@components/Dashboard/Shared/DashKit/DashKit'
import { ActivityField, ModalFormActions, useModalFormId } from '../../activityFormKit'

function MarkdownActivityModal({ submitActivity, chapterId, course }: any) {
  const { t } = useTranslation()
  const formId = useModalFormId()
  const [activityName, setActivityName] = useState('')
  const [markdownUrl, setMarkdownUrl] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (isSubmitting) return
    setIsSubmitting(true)
    try {
      await submitActivity({
        name: activityName.trim(),
        chapter_id: chapterId,
        activity_type: 'TYPE_DYNAMIC',
        activity_sub_type: 'SUBTYPE_DYNAMIC_MARKDOWN',
        content: { markdown_url: markdownUrl.trim() },
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
      <ActivityField label={t('activities.modal.activity_name')} htmlFor="markdown-activity-name">
        <input
          id="markdown-activity-name"
          autoFocus
          value={activityName}
          onChange={(e) => setActivityName(e.target.value)}
          type="text"
          required
          placeholder={t('activities.modal.enter_name')}
          className={INPUT}
        />
      </ActivityField>
      <ActivityField
        label={t('activities.modal.markdown_url')}
        htmlFor="markdown-activity-url"
        hint={t('dashboard.courses.editor.activity_form.markdown_hint')}
      >
        <input
          id="markdown-activity-url"
          value={markdownUrl}
          onChange={(e) => setMarkdownUrl(e.target.value)}
          type="url"
          required
          placeholder="https://github.com/user/repo/blob/main/README.md"
          className={INPUT}
        />
      </ActivityField>
      <ModalFormActions
        submitting={isSubmitting}
        canSubmit={!!activityName.trim() && !!markdownUrl.trim()}
        label={t('activities.modal.create_activity')}
      />
    </form>
  )
}

export default MarkdownActivityModal
