'use client'
import React, { useState } from 'react'
import dynamic from 'next/dynamic'
import { updateActivity } from '@services/courses/activities'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import toast from 'react-hot-toast'
import { mutate } from 'swr'
import { useTranslation } from 'react-i18next'
import { INPUT } from '@components/Dashboard/Shared/DashKit/DashKit'
import { ModalFormActions, useModalFormId } from '../activityFormKit'

// EE component (`@ee` resolves to a no-op stub in OSS builds), dynamically imported,
// mirroring how the activity page lazy-loads ScormActivity.
const ScormResults = dynamic(
  () => import('@ee/components/Activities/ScormResults'),
  { ssr: false },
)

interface EditScormActivityModalProps {
  activity: any
  courseUuid: string
  orgSlug: string
  onClose: () => void
}

function EditScormActivityModal({ activity, onClose }: EditScormActivityModalProps) {
  const { t } = useTranslation()
  const formId = useModalFormId()
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token

  const [name, setName] = useState(activity.name || '')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)

    const toastId = toast.loading(t('activities.edit_modal.updating_scorm'))
    try {
      const res = await updateActivity(
        { name },
        activity.activity_uuid,
        access_token,
      )

      if (res?.success === false) {
        toast.error(t('activities.edit_modal.update_scorm_failed'), { id: toastId })
      } else {
        toast.success(t('activities.edit_modal.scorm_updated'), { id: toastId })
        mutate((key: string) => typeof key === 'string' && key.includes('/courses/org_slug/'))
        onClose()
      }
    } catch {
      toast.error(t('activities.edit_modal.update_scorm_failed'), { id: toastId })
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <form id={formId} onSubmit={handleSubmit} className="space-y-4">

      <div className="rounded-xl ring-1 ring-inset ring-neutral-200 p-4 space-y-4">
        <div className="space-y-1.5">
          <label className="text-sm font-semibold text-neutral-800">{t('activities.modal.activity_name')}</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            type="text"
            required
            placeholder={t('activities.modal.enter_name')}
            className={INPUT}
          />
        </div>
      </div>

      {/* Learner results (instructor reporting) */}
      <div className="rounded-xl ring-1 ring-inset ring-neutral-200 p-4">
        <ScormResults activityUuid={activity.activity_uuid} />
      </div>

      <ModalFormActions submitting={isSubmitting} canSubmit={!!name.trim()} label={t('common.save_changes')} />
    </form>
  )
}

export default EditScormActivityModal
