'use client'
import React, { useState } from 'react'
import LearnHouseSpinner from '@components/Objects/Loaders/LearnHouseSpinner'
import { FileText } from '@phosphor-icons/react'
import { constructAcceptValue } from '@/lib/constants'
import { updateDocumentActivity } from '@services/courses/activities'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import toast from 'react-hot-toast'
import { mutate } from 'swr'

const SUPPORTED_FILES = constructAcceptValue(['pdf'])

interface EditDocumentActivityModalProps {
  activity: any
  courseUuid: string
  orgSlug: string
  onClose: () => void
}

function EditDocumentActivityModal({ activity, courseUuid, orgSlug, onClose }: EditDocumentActivityModalProps) {
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token

  const [name, setName] = useState(activity.name || '')
  const [pdfFile, setPdfFile] = useState<File | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)

    const toastId = toast.loading('Updating document activity...')
    try {
      const res = await updateDocumentActivity(
        activity.activity_uuid,
        access_token,
        name !== activity.name ? name : undefined,
        pdfFile,
      )

      if (res?.success === false) {
        toast.error('Failed to update document activity', { id: toastId })
      } else {
        toast.success('Document activity updated', { id: toastId })
        mutate((key: string) => typeof key === 'string' && key.includes('/courses/org_slug/'))
        onClose()
      }
    } catch {
      toast.error('Failed to update document activity', { id: toastId })
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
            'repeating-linear-gradient(0deg, transparent, transparent 8px, rgba(167,243,208,0.25) 8px, rgba(167,243,208,0.25) 9px), repeating-linear-gradient(90deg, transparent, transparent 8px, rgba(167,243,208,0.25) 8px, rgba(167,243,208,0.25) 9px)',
        }}
      >
        <span className="flex items-center gap-2 bg-white nice-shadow rounded-full px-4 py-1.5 text-sm font-medium text-gray-600">
          <FileText size={18} weight="duotone" className="text-emerald-400" />
          PDF Document
        </span>
      </div>

      <div className="rounded-xl nice-shadow p-4 space-y-4">
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-gray-700">Activity name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            type="text"
            required
            placeholder="Enter a name..."
            className="w-full h-9 px-3 text-sm rounded-lg bg-gray-50 border border-gray-200 outline-none focus:border-gray-300 focus:ring-1 focus:ring-gray-200 transition-colors"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-medium text-gray-700">Replace PDF file</label>
          <div className="flex items-center gap-2 text-xs text-gray-400 mb-1">
            <FileText size={14} weight="duotone" />
            <span>Leave empty to keep the current file</span>
          </div>
          <input
            type="file"
            accept={SUPPORTED_FILES}
            onChange={(e) => setPdfFile(e.target.files?.[0] ?? null)}
            className="w-full text-sm text-gray-500 file:mr-3 file:py-1.5 file:px-3 file:rounded-full file:border-0 file:text-xs file:font-medium file:bg-gray-100 file:text-gray-700 hover:file:bg-gray-200 transition-colors"
          />
        </div>
      </div>

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={isSubmitting}
          className="inline-flex items-center justify-center h-9 px-5 text-sm font-medium text-white bg-black rounded-lg hover:bg-gray-800 transition-colors disabled:opacity-50"
        >
          {isSubmitting ? (
            <LearnHouseSpinner size={18} color="#ffffff" />
          ) : (
            'Save changes'
          )}
        </button>
      </div>
    </form>
  )
}

export default EditDocumentActivityModal
