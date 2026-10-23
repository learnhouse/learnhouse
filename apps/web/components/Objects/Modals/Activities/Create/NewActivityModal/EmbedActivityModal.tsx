import React, { useState } from 'react'
import * as Form from '@radix-ui/react-form'
import BarLoader from 'react-spinners/BarLoader'
import { Globe } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'

function EmbedActivityModal({ submitActivity, chapterId, course }: any) {
  const { t } = useTranslation()
  const [activityName, setActivityName] = useState('')
  const [embedUrl, setEmbedUrl] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async (e: any) => {
    e.preventDefault()
    setIsSubmitting(true)
    await submitActivity({
      name: activityName,
      chapter_id: chapterId,
      activity_type: 'TYPE_DYNAMIC',
      activity_sub_type: 'SUBTYPE_DYNAMIC_EMBED',
      content: { embed_url: embedUrl },
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
            'radial-gradient(circle, rgba(165,243,252,0.25) 1px, transparent 1px)',
          backgroundSize: '14px 14px',
        }}
      >
        <span className="flex items-center gap-2 bg-white nice-shadow rounded-full px-4 py-1.5 text-sm font-medium text-gray-600">
          <Globe size={18} weight="duotone" className="text-cyan-400" />
          {t('dashboard.courses.structure.activity.types.embed')}
        </span>
      </div>

      <div className="rounded-xl nice-shadow p-4 space-y-4">
        <Form.Field name="embed-activity-name" className="space-y-1.5">
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

        <Form.Field name="embed-activity-url" className="space-y-1.5">
          <Form.Label className="text-sm font-medium text-gray-700">
            {t('dashboard.courses.structure.modals.new_activity.forms.embed.url_label')}
          </Form.Label>
          <Form.Message match="valueMissing" className="text-xs text-red-500">
            {t('dashboard.courses.structure.modals.new_activity.forms.embed.url_required')}
          </Form.Message>
          <Form.Message match="typeMismatch" className="text-xs text-red-500">
            {t('dashboard.courses.structure.modals.new_activity.forms.embed.url_invalid')}
          </Form.Message>
          <Form.Control asChild>
            <input
              onChange={(e) => setEmbedUrl(e.target.value)}
              type="url"
              required
              placeholder={t('dashboard.courses.structure.modals.new_activity.forms.embed.url_placeholder')}
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

export default EmbedActivityModal
