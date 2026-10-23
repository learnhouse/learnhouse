import React, { useState } from 'react'
import * as Form from '@radix-ui/react-form'
import BarLoader from 'react-spinners/BarLoader'
import { Browsers } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'

function DynamicCanvaModal({ submitActivity, chapterId, course }: any) {
  const { t } = useTranslation()
  const [activityName, setActivityName] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async (e: any) => {
    e.preventDefault()
    setIsSubmitting(true)
    await submitActivity({
      name: activityName,
      chapter_id: chapterId,
      activity_type: 'TYPE_DYNAMIC',
      activity_sub_type: 'SUBTYPE_DYNAMIC_PAGE',
      published_version: 1,
      version: 1,
      course_id: course.id,
    })
    setIsSubmitting(false)
  }

  return (
    <Form.Root onSubmit={handleSubmit} className="space-y-4">
      <div
        className="relative flex items-center justify-center h-20 rounded-xl overflow-hidden"
        style={{
          backgroundImage:
            'radial-gradient(circle, rgba(191,219,254,0.3) 1px, transparent 1px)',
          backgroundSize: '12px 12px',
        }}
      >
        <span className="flex items-center gap-2 bg-white nice-shadow rounded-full px-4 py-1.5 text-sm font-medium text-gray-600">
          <Browsers size={18} weight="duotone" className="text-blue-400" />
          {t('dashboard.courses.structure.activity.types.dynamic_page')}
        </span>
      </div>

      <div className="rounded-xl nice-shadow p-4 space-y-4">
        <Form.Field name="dynamic-activity-name" className="space-y-1.5">
          <Form.Label className="text-sm font-medium text-gray-700">
            {t('dashboard.courses.structure.modals.new_activity.forms.activity_name')}
          </Form.Label>
          <Form.Message match="valueMissing" className="text-xs text-red-500">
            {t('dashboard.courses.structure.modals.new_activity.forms.name_required')}
          </Form.Message>
          <Form.Control asChild>
            <input
              onChange={(e) => setActivityName(e.target.value)}
              type="text"
              required
              placeholder={t('dashboard.courses.structure.modals.new_activity.forms.name_placeholder')}
              className="w-full h-9 px-3 text-sm rounded-lg bg-gray-50 border border-gray-200 outline-none focus:border-gray-300 focus:ring-1 focus:ring-gray-200 transition-colors"
            />
          </Form.Control>
        </Form.Field>
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
              t('dashboard.courses.structure.modals.new_activity.forms.create_activity')
            )}
          </button>
        </Form.Submit>
      </div>
    </Form.Root>
  )
}

export default DynamicCanvaModal
