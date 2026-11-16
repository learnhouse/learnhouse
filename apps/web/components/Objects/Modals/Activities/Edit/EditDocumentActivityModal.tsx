'use client'
import React, { useState } from 'react'
import { constructAcceptValue } from '@/lib/constants'
import { updateDocumentActivity } from '@services/courses/activities'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import toast from 'react-hot-toast'
import { mutate } from 'swr'
import { useTranslation } from 'react-i18next'
import { INPUT } from '@components/Dashboard/Shared/DashKit/DashKit'
import { FilePicker, ModalFormActions, useModalFormId } from '../activityFormKit'

const SUPPORTED_FILES = constructAcceptValue(['pdf'])

interface EditDocumentActivityModalProps {
  activity: any
  courseUuid: string
  orgSlug: string
  onClose: () => void
}

function EditDocumentActivityModal({ activity, courseUuid, orgSlug, onClose }: EditDocumentActivityModalProps) {
  const { t } = useTranslation()
  const formId = useModalFormId()
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token

  const [name, setName] = useState(activity.name || '')
  const [pdfFile, setPdfFile] = useState<File | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)

    const toastId = toast.loading(t('activities.edit_modal.updating_document'))
    try {
      const res = await updateDocumentActivity(
        activity.activity_uuid,
        access_token,
        name !== activity.name ? name : undefined,
        pdfFile,
      )

      if (res?.success === false) {
        toast.error(t('activities.edit_modal.update_document_failed'), { id: toastId })
      } else {
        toast.success(t('activities.edit_modal.document_updated'), { id: toastId })
        mutate((key: string) => typeof key === 'string' && key.includes('/courses/org_slug/'))
        onClose()
      }
    } catch {
      toast.error(t('activities.edit_modal.update_document_failed'), { id: toastId })
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

        <div className="space-y-1.5">
          <label className="text-sm font-semibold text-neutral-800">{t('activities.edit_modal.replace_pdf')}</label>
          <FilePicker
            accept={SUPPORTED_FILES}
            file={pdfFile}
            onChange={setPdfFile}
            title={t('dashboard.courses.editor.activity_form.pdf_title')}
            hint={t('activities.edit_modal.keep_current_file')}
          />
        </div>
      </div>

      <ModalFormActions submitting={isSubmitting} canSubmit={!!name.trim()} label={t('common.save_changes')} />
    </form>
  )
}

export default EditDocumentActivityModal
