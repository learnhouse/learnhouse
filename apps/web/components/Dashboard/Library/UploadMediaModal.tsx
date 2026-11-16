'use client'
import Modal from '@components/Objects/StyledElements/Modal/Modal'
import {
  Button,
  ChoiceCard,
  FieldLabel,
  INPUT,
  SegmentedControl,
  TEXTAREA,
} from '@components/Dashboard/Shared/DashKit/DashKit'
import { createMedia } from '@services/media/media-resource'
import { useOrg } from '@components/Contexts/OrgContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { CloudArrowUp, File as FileIcon, FileArrowUp, Globe, LinkSimple, Lock, UploadSimple } from '@phosphor-icons/react'
import React from 'react'
import toast from 'react-hot-toast'
import { useTranslation } from 'react-i18next'
import { useLHAnalytics, AnalyticsEvent } from '@services/analytics'

type Props = {
  open: boolean
  onOpenChange: (_open: boolean) => void
  folderUuid?: string
  orgslug: string
  onChanged?: () => void
}

type Mode = 'UPLOAD' | 'EMBED'
const ACCEPT = 'image/*,video/*,audio/*,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip'

function formatSize(bytes: number) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

function UploadMediaModal({ open, onOpenChange, folderUuid, onChanged }: Props) {
  const { t } = useTranslation()
  const org = useOrg() as any
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token
  const { track } = useLHAnalytics('dashboard')

  const [mode, setMode] = React.useState<Mode>('UPLOAD')
  const [name, setName] = React.useState('')
  const [description, setDescription] = React.useState('')
  const [url, setUrl] = React.useState('')
  const [isPublic, setIsPublic] = React.useState(true)
  const [file, setFile] = React.useState<File | null>(null)
  const [dragging, setDragging] = React.useState(false)
  const [submitting, setSubmitting] = React.useState(false)
  const [errors, setErrors] = React.useState<{ name?: string; file?: string; url?: string }>({})

  // Fresh form every time the dialog opens (adjusted during render).
  const [wasOpen, setWasOpen] = React.useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setMode('UPLOAD')
      setName('')
      setDescription('')
      setUrl('')
      setIsPublic(true)
      setFile(null)
      setErrors({})
    }
  }

  const previewUrl = React.useMemo(
    () => (file && file.type.startsWith('image/') ? URL.createObjectURL(file) : null),
    [file]
  )
  React.useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
  }, [previewUrl])

  const chooseFile = (f: File | null) => {
    setFile(f)
    setErrors((e) => ({ ...e, file: undefined }))
    // Prefill the name from the file, the way most upload dialogs do.
    if (f && !name.trim()) setName(f.name.replace(/\.[^.]+$/, ''))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const next: typeof errors = {}
    if (!name.trim()) next.name = t('media.name_required')
    if (mode === 'UPLOAD' && !file) next.file = t('media.file_required')
    if (mode === 'EMBED' && !url.trim()) next.url = t('media.url_required')
    setErrors(next)
    if (Object.keys(next).length) return

    setSubmitting(true)
    try {
      const formData = new FormData()
      formData.append('org_id', String(org.id))
      formData.append('name', name.trim())
      formData.append('media_type', mode)
      formData.append('public', String(isPublic))
      if (description) formData.append('description', description)
      if (folderUuid) formData.append('folder_uuid', folderUuid)
      if (mode === 'EMBED') formData.append('url', url.trim())
      if (mode === 'UPLOAD' && file) formData.append('file', file)

      await createMedia(formData, access_token)
      track(AnalyticsEvent.MediaUploaded, {
        media_type: mode,
        is_embed: mode === 'EMBED',
        ...(file ? { file_size_kb: Math.round(file.size / 1024) } : {}),
      })
      toast.success(t('media.media_uploaded_success'))
      onOpenChange(false)
      onChanged?.()
    } catch (error: any) {
      track(AnalyticsEvent.MediaUploadFailed, { reason: error?.message || 'unknown' })
      toast.error(error?.message || t('media.media_uploaded_error'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      isDialogOpen={open}
      onOpenChange={onOpenChange}
      preventClose={submitting}
      size="md"
      icon={<UploadSimple size={16} />}
      dialogTitle={t('media.upload_media')}
      dialogDescription={folderUuid ? t('library.dash.upload_description_folder') : t('library.dash.upload_description')}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={submitting}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" type="submit" form="library-upload-media" loading={submitting}>
            {mode === 'UPLOAD' ? t('media.upload') : t('library.dash.add_embed')}
          </Button>
        </>
      }
      dialogContent={
        <form id="library-upload-media" onSubmit={handleSubmit} className="flex flex-col gap-5">
          <SegmentedControl<Mode>
            value={mode}
            onChange={setMode}
            ariaLabel={t('library.dash.media_source')}
            options={[
              { key: 'UPLOAD', label: <><FileArrowUp size={14} /> {t('media.upload_file')}</> },
              { key: 'EMBED', label: <><LinkSimple size={14} /> {t('media.embed')}</> },
            ]}
          />

          {mode === 'UPLOAD' ? (
            <div>
              <FieldLabel error={errors.file}>{t('media.file')}</FieldLabel>
              {file ? (
                <div className="flex items-center gap-3 rounded-xl ring-1 ring-inset ring-neutral-200 p-2.5">
                  {previewUrl ? (
                    <div
                      className="w-12 h-12 rounded-lg bg-cover bg-center shrink-0 ring-1 ring-inset ring-black/5"
                      style={{ backgroundImage: `url(${previewUrl})` }}
                    />
                  ) : (
                    <div className="w-12 h-12 rounded-lg bg-amber-50 text-amber-500 flex items-center justify-center shrink-0">
                      <FileIcon size={22} weight="fill" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-neutral-800 truncate">{file.name}</p>
                    <p className="text-xs text-neutral-400">
                      {formatSize(file.size)} · {file.type || t('media.file')}
                    </p>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => setFile(null)}>
                    {t('media.remove')}
                  </Button>
                </div>
              ) : (
                <label
                  onDragOver={(e) => {
                    e.preventDefault()
                    setDragging(true)
                  }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={(e) => {
                    e.preventDefault()
                    setDragging(false)
                    chooseFile(e.dataTransfer.files?.[0] || null)
                  }}
                  className={`relative flex flex-col items-center justify-center gap-1.5 text-center px-4 py-8 rounded-xl border-2 border-dashed cursor-pointer transition-colors ${
                    dragging ? 'border-neutral-400 bg-neutral-100' : 'border-neutral-200 bg-neutral-50/70 hover:bg-neutral-100/70'
                  }`}
                >
                  <input
                    type="file"
                    accept={ACCEPT}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                    onChange={(e) => chooseFile(e.target.files?.[0] || null)}
                  />
                  <span className="w-10 h-10 rounded-xl bg-white nice-shadow text-neutral-500 flex items-center justify-center">
                    <CloudArrowUp size={20} />
                  </span>
                  <span className="text-sm font-semibold text-neutral-800">{t('library.dash.drop_or_choose')}</span>
                  <span className="text-xs text-neutral-400">{t('media.upload_hint')}</span>
                </label>
              )}
            </div>
          ) : (
            <div>
              <FieldLabel error={errors.url} hint={t('library.dash.embed_hint')}>
                {t('media.url')}
              </FieldLabel>
              <input
                type="url"
                value={url}
                onChange={(e) => {
                  setUrl(e.target.value)
                  if (errors.url) setErrors((x) => ({ ...x, url: undefined }))
                }}
                placeholder="https://"
                className={INPUT}
              />
            </div>
          )}

          <div>
            <FieldLabel error={errors.name}>{t('media.name')}</FieldLabel>
            <input
              value={name}
              onChange={(e) => {
                setName(e.target.value)
                if (errors.name) setErrors((x) => ({ ...x, name: undefined }))
              }}
              placeholder={t('library.dash.media_name_placeholder')}
              className={INPUT}
            />
          </div>

          <div>
            <FieldLabel hint={t('library.dash.optional')}>{t('media.description')}</FieldLabel>
            <textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} className={TEXTAREA} />
          </div>

          <div>
            <FieldLabel>{t('library.visibility')}</FieldLabel>
            <div className="grid sm:grid-cols-2 gap-2" role="radiogroup" aria-label={t('library.visibility')}>
              <ChoiceCard
                selected={isPublic}
                onClick={() => setIsPublic(true)}
                icon={<Globe size={16} />}
                title={t('library.public')}
                description={t('library.dash.media_public_hint')}
              />
              <ChoiceCard
                selected={!isPublic}
                onClick={() => setIsPublic(false)}
                icon={<Lock size={16} />}
                title={t('library.private')}
                description={t('library.dash.media_private_hint')}
              />
            </div>
          </div>
        </form>
      }
    />
  )
}

export default UploadMediaModal
