import React, { useState } from 'react'
import * as Form from '@radix-ui/react-form'
import BarLoader from 'react-spinners/BarLoader'
import { Package } from '@phosphor-icons/react'
import ResourcePicker, { SelectedResource } from '@components/Dashboard/Library/ResourcePicker'

function ResourceActivityModal({ submitActivity, chapterId, course, orgslug }: any) {
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

  const handleSubmit = async (e: any) => {
    e.preventDefault()
    if (!selected) return
    setIsSubmitting(true)
    await submitActivity({
      name: activityName,
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
    setIsSubmitting(false)
  }

  return (
    <Form.Root onSubmit={handleSubmit} className="space-y-4">
      <div
        className="relative flex items-center justify-center h-20 rounded-xl overflow-hidden"
        style={{
          backgroundImage:
            'radial-gradient(circle, rgba(196,181,253,0.25) 1px, transparent 1px)',
          backgroundSize: '14px 14px',
        }}
      >
        <span className="flex items-center gap-2 bg-white nice-shadow rounded-full px-4 py-1.5 text-sm font-medium text-gray-600">
          <Package size={18} weight="duotone" className="text-indigo-400" />
          Resource
        </span>
      </div>

      <div className="rounded-xl nice-shadow p-4 space-y-4">
        <Form.Field name="resource-activity-name" className="space-y-1.5">
          <Form.Label className="text-sm font-medium text-gray-700">
            Activity name
          </Form.Label>
          <Form.Message match="valueMissing" className="text-xs text-red-500">
            Please provide a name
          </Form.Message>
          <Form.Control asChild>
            <input
              value={activityName}
              onChange={(e) => setActivityName(e.target.value)}
              type="text"
              required
              placeholder="Enter a name..."
              className="w-full h-9 px-3 text-sm rounded-lg bg-gray-50 border border-gray-200 outline-none focus:border-gray-300 focus:ring-1 focus:ring-gray-200 transition-colors"
            />
          </Form.Control>
        </Form.Field>

        <div className="space-y-1.5">
          <label className="text-sm font-medium text-gray-700">Pick a resource</label>
          <ResourcePicker
            mode="select"
            orgslug={orgslug}
            onSelect={handleSelect}
            selectedUuid={selected?.resource_uuid}
          />
        </div>
      </div>

      <div className="flex justify-end">
        <Form.Submit asChild>
          <button
            type="submit"
            disabled={isSubmitting || !selected}
            className="inline-flex items-center justify-center h-9 px-5 text-sm font-medium text-white bg-black rounded-lg hover:bg-gray-800 transition-colors disabled:opacity-50"
          >
            {isSubmitting ? (
              <BarLoader
                cssOverride={{ borderRadius: 60 }}
                width={60}
                color="#ffffff"
              />
            ) : (
              'Create activity'
            )}
          </button>
        </Form.Submit>
      </div>
    </Form.Root>
  )
}

export default ResourceActivityModal
