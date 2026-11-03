'use client'
import React, { useState } from 'react'
import dynamic from 'next/dynamic'
import LearnHouseSpinner from '@components/Objects/Loaders/LearnHouseSpinner'
import { Package } from 'lucide-react'
import { updateActivity } from '@services/courses/activities'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import toast from 'react-hot-toast'
import { mutate } from 'swr'
import { useTranslation } from 'react-i18next'

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
    <form onSubmit={handleSubmit} className="space-y-4">
      <div
        className="relative flex items-center justify-center h-20 rounded-xl overflow-hidden"
        style={{
          backgroundImage:
            'repeating-linear-gradient(-45deg, transparent, transparent 6px, rgba(186,230,253,0.3) 6px, rgba(186,230,253,0.3) 7px)',
        }}
      >
        <span className="flex items-center gap-2 bg-white nice-shadow rounded-full px-4 py-1.5 text-sm font-medium text-gray-600">
          <Package size={18} className="text-sky-500" />
          {t('activities.edit_modal.scorm_activity')}
        </span>
      </div>

      <div className="rounded-xl nice-shadow p-4 space-y-4">
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-gray-700">{t('activities.modal.activity_name')}</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            type="text"
            required
            placeholder={t('activities.modal.enter_name')}
            className="w-full h-9 px-3 text-sm rounded-lg bg-gray-50 border border-gray-200 outline-none focus:border-gray-300 focus:ring-1 focus:ring-gray-200 transition-colors"
          />
        </div>
      </div>

      {/* Learner results (instructor reporting) */}
      <div className="rounded-xl nice-shadow p-4">
        <ScormResults activityUuid={activity.activity_uuid} />
      </div>

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={isSubmitting}
          className="inline-flex items-center justify-center h-9 px-5 text-sm font-medium text-white bg-black rounded-lg hover:bg-gray-800 transition-colors disabled:opacity-50"
        >
          {isSubmitting ? (
            <LearnHouseSpinner size={18} className="[&>div]:border-t-white" />
          ) : (
            t('common.save_changes')
          )}
        </button>
      </div>
    </form>
  )
}

export default EditScormActivityModal
