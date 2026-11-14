import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import ResourcePicker, { SelectedResource } from '@components/Dashboard/Library/ResourcePicker'
import { INPUT } from '@components/Dashboard/Shared/DashKit/DashKit'
import { ActivityField, ModalFormActions, useModalFormId } from '../../activityFormKit'

function ResourceActivityModal({ submitActivity, chapterId, course, orgslug }: any) {
  const { t } = useTranslation()
  const formId = useModalFormId()
  const [activityName, setActivityName] = useState('')
  const [selected, setSelected] = useState<SelectedResource | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSelect = (resource: SelectedResource) => {
    setSelected(resource)
    // Prefill the activity name from the resource on first pick.
    if (!activityName && resource.name) {
      setActivityName(resource.name)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selected || isSubmitting) return
    setIsSubmitting(true)
    try {
      await submitActivity({
        name: activityName.trim(),
        chapter_id: chapterId,
        activity_type: 'TYPE_DYNAMIC',
        activity_sub_type: 'SUBTYPE_DYNAMIC_RESOURCE',
        content: {
          resource_uuid: selected.resource_uuid,
          resource_type: selected.resource_type,
        },
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
      <ActivityField label={t('activities.modal.pick_resource')} hint={t('dashboard.courses.editor.activity_form.resource_hint')}>
        <ResourcePicker
          mode="select"
          orgslug={orgslug}
          onSelect={handleSelect}
          selectedUuid={selected?.resource_uuid}
        />
      </ActivityField>
      <ActivityField label={t('activities.modal.activity_name')} htmlFor="resource-activity-name">
        <input
          id="resource-activity-name"
          value={activityName}
          onChange={(e) => setActivityName(e.target.value)}
          type="text"
          required
          placeholder={t('activities.modal.enter_name')}
          className={INPUT}
        />
      </ActivityField>
      <ModalFormActions
        submitting={isSubmitting}
        canSubmit={!!selected && !!activityName.trim()}
        label={t('activities.modal.create_activity')}
      />
    </form>
  )
}

export default ResourceActivityModal
