import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { constructAcceptValue } from '@/lib/constants'
import { INPUT } from '@components/Dashboard/Shared/DashKit/DashKit'
import { ActivityField, FilePicker, ModalFormActions, nameFromFile, useModalFormId } from '../../activityFormKit'

const SUPPORTED_FILES = constructAcceptValue(['pdf'])

function DocumentPdfModal({ submitFileActivity, chapterId, course }: any) {
  const { t } = useTranslation()
  const formId = useModalFormId()
  const [documentpdf, setDocumentPdf] = useState<File | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [name, setName] = useState('')

  const handleFile = (file: File | null) => {
    setDocumentPdf(file)
    // Start from the file name; the teacher can still change it.
    if (file && !name.trim()) setName(nameFromFile(file))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!documentpdf || isSubmitting) return
    setIsSubmitting(true)
    try {
      await submitFileActivity(
        documentpdf,
        'documentpdf',
        {
          name: name.trim(),
          chapter_id: chapterId,
          activity_type: 'TYPE_DOCUMENT',
          activity_sub_type: 'SUBTYPE_DOCUMENT_PDF',
          published_version: 1,
          version: 1,
          course_id: course.id,
        },
        chapterId
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <form id={formId} onSubmit={handleSubmit} className="space-y-4">
      <ActivityField label={t('activities.modal.document_name')} htmlFor="documentpdf-activity-name">
        <input
          id="documentpdf-activity-name"
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          type="text"
          required
          placeholder={t('activities.modal.enter_name')}
          className={INPUT}
        />
      </ActivityField>
      <ActivityField label={t('activities.modal.pdf_file')}>
        <FilePicker
          accept={SUPPORTED_FILES}
          file={documentpdf}
          onChange={handleFile}
          required
          title={t('dashboard.courses.editor.activity_form.pdf_title')}
          hint={t('dashboard.courses.editor.activity_form.pdf_hint')}
        />
      </ActivityField>
      <ModalFormActions
        submitting={isSubmitting}
        canSubmit={!!documentpdf && !!name.trim()}
        label={t('activities.modal.create_activity')}
      />
    </form>
  )
}

export default DocumentPdfModal
