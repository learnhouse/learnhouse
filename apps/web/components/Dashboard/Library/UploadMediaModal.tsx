'use client'
import { Input } from '@components/ui/input'
import { Textarea } from '@components/ui/textarea'
import FormLayout, {
  FormField,
  FormLabelAndMessage,
  ButtonBlack,
} from '@components/Objects/StyledElements/Form/Form'
import * as Form from '@radix-ui/react-form'
import { createMedia } from '@services/media/media-resource'
import { useOrg } from '@components/Contexts/OrgContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { UploadCloud, Link as LinkIcon, FileUp } from 'lucide-react'
import React from 'react'
import { BarLoader } from 'react-spinners'
import toast from 'react-hot-toast'
import { useTranslation } from 'react-i18next'
import { useLHAnalytics, AnalyticsEvent } from '@services/analytics'

type Props = {
  folderUuid?: string
  orgslug: string
  closeModal: () => void
  onChanged?: () => void
}

function UploadMediaModal({ folderUuid, closeModal, onChanged }: Props) {
  const { t } = useTranslation()
  const org = useOrg() as any
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token
  const { track } = useLHAnalytics('dashboard')

  const [mode, setMode] = React.useState<'UPLOAD' | 'EMBED'>('UPLOAD')
  const [name, setName] = React.useState('')
  const [description, setDescription] = React.useState('')
  const [url, setUrl] = React.useState('')
  const [isPublic, setIsPublic] = React.useState(true)
  const [file, setFile] = React.useState<File | null>(null)
  const [submitting, setSubmitting] = React.useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) {
      toast.error(t('media.name_required'))
      return
    }
    if (mode === 'UPLOAD' && !file) {
      toast.error(t('media.file_required'))
      return
    }
    if (mode === 'EMBED' && !url.trim()) {
      toast.error(t('media.url_required'))
      return
    }

    setSubmitting(true)
    const toastId = toast.loading(t('media.uploading_media'))
    try {
      const formData = new FormData()
      formData.append('org_id', String(org.id))
      formData.append('name', name)
      formData.append('media_type', mode)
      formData.append('public', String(isPublic))
      if (description) formData.append('description', description)
      if (folderUuid) formData.append('folder_uuid', folderUuid)
      if (mode === 'EMBED') formData.append('url', url)
      if (mode === 'UPLOAD' && file) formData.append('file', file)

      await createMedia(formData, access_token)
      track(AnalyticsEvent.MediaUploaded, {
        media_type: mode,
        is_embed: mode === 'EMBED',
        ...(file ? { file_size_kb: Math.round(file.size / 1024) } : {}),
      })
      toast.success(t('media.media_uploaded_success'))
      closeModal()
      onChanged?.()
    } catch (error: any) {
      track(AnalyticsEvent.MediaUploadFailed, {
        reason: error?.message || 'unknown',
      })
      toast.error(error?.message || t('media.media_uploaded_error'))
    } finally {
      toast.dismiss(toastId)
      setSubmitting(false)
    }
  }

  return (
    <FormLayout onSubmit={handleSubmit}>
      {/* Mode toggle */}
      <div className="flex gap-2 mb-4">
        <button
          type="button"
          onClick={() => setMode('UPLOAD')}
          className={`flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border text-sm font-medium transition-all ${
            mode === 'UPLOAD'
              ? 'bg-white border-indigo-200 ring-1 ring-indigo-100 text-gray-900'
              : 'bg-gray-50 border-gray-100 text-gray-500 hover:bg-gray-100'
          }`}
        >
          <FileUp className="w-4 h-4" /> {t('media.upload_file')}
        </button>
        <button
          type="button"
          onClick={() => setMode('EMBED')}
          className={`flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border text-sm font-medium transition-all ${
            mode === 'EMBED'
              ? 'bg-white border-indigo-200 ring-1 ring-indigo-100 text-gray-900'
              : 'bg-gray-50 border-gray-100 text-gray-500 hover:bg-gray-100'
          }`}
        >
          <LinkIcon className="w-4 h-4" /> {t('media.embed')}
        </button>
      </div>

      <FormField name="name">
        <FormLabelAndMessage label={t('media.name')} />
        <Form.Control asChild>
          <Input value={name} onChange={(e) => setName(e.target.value)} type="text" required />
        </Form.Control>
      </FormField>

      {mode === 'EMBED' ? (
        <FormField name="url">
          <FormLabelAndMessage label={t('media.url')} />
          <Form.Control asChild>
            <Input value={url} onChange={(e) => setUrl(e.target.value)} type="url" placeholder="https://" />
          </Form.Control>
        </FormField>
      ) : (
        <FormField name="file">
          <FormLabelAndMessage label={t('media.file')} />
          {file ? (
            <div className="flex items-center gap-3 rounded-xl border border-gray-200 p-3">
              {file.type.startsWith('image/') ? (
                <div className="w-14 h-14 rounded-lg bg-cover bg-center flex-shrink-0 ring-1 ring-inset ring-black/5" style={{ backgroundImage: `url(${URL.createObjectURL(file)})` }} />
              ) : (
                <div className="w-14 h-14 rounded-lg bg-gray-100 text-gray-400 flex items-center justify-center flex-shrink-0">
                  <FileUp className="w-6 h-6" />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-gray-800 truncate">{file.name}</p>
                <p className="text-xs text-gray-400">{(file.size / 1024).toFixed(0)} KB · {file.type || 'file'}</p>
              </div>
              <button type="button" onClick={() => setFile(null)} className="text-xs font-medium text-gray-500 hover:text-rose-600 px-2 py-1">
                {t('media.remove')}
              </button>
            </div>
          ) : (
            <label className="relative block w-full rounded-xl border-2 border-dashed border-gray-200 bg-gray-50/60 hover:bg-gray-100/60 transition-colors h-[140px] cursor-pointer">
              <input
                type="file"
                accept="image/*,video/*,audio/*,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip"
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
              />
              <div className="pointer-events-none h-full flex flex-col items-center justify-center gap-1.5 text-center px-4">
                <UploadCloud size={26} className="text-gray-400" />
                <span className="text-sm font-semibold text-gray-700">{t('media.choose_file')}</span>
                <span className="text-xs text-gray-400">{t('media.upload_hint')}</span>
              </div>
            </label>
          )}
        </FormField>
      )}

      <FormField name="description">
        <FormLabelAndMessage label={t('media.description')} />
        <Form.Control asChild>
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} />
        </Form.Control>
      </FormField>

      <FormField name="public">
        <label className="flex items-center gap-2 text-sm text-gray-700 mt-1 cursor-pointer">
          <input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} />
          {t('media.public')}
        </label>
      </FormField>

      <div className="flex justify-end mt-6">
        <ButtonBlack
          type="submit"
          disabled={submitting}
          state={submitting ? 'loading' : 'none'}
        >
          {submitting ? (
            <BarLoader cssOverride={{ borderRadius: 60 }} width={60} color="#ffffff" />
          ) : (
            t('media.upload')
          )}
        </ButtonBlack>
      </div>
    </FormLayout>
  )
}

export default UploadMediaModal
