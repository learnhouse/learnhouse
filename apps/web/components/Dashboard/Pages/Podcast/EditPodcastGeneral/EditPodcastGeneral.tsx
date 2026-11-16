'use client'
import React, { useRef, useState } from 'react'
import { usePodcast } from '@components/Contexts/PodcastContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrg } from '@components/Contexts/OrgContext'
import { Podcast, updatePodcast, updatePodcastThumbnail } from '@services/podcasts/podcasts'
import { useLHAnalytics, AnalyticsEvent } from '@services/analytics'
import { getPodcastThumbnailMediaDirectory } from '@services/media/media'
import { revalidateTags } from '@services/utils/ts/requests'
import { useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query/keys'
import { useFormik } from 'formik'
import * as Yup from 'yup'
import { useTranslation } from 'react-i18next'
import { Eye, Globe, ImageSquare, TextT, Trash } from '@phosphor-icons/react'
import toast from 'react-hot-toast'
import { Switch } from '@components/ui/switch'
import {
  FieldLabel,
  INPUT,
  SectionCard,
  SettingRow,
  StickySaveBar,
  TEXTAREA,
} from '@components/Dashboard/Shared/DashKit/DashKit'
import { PodcastEditorPage, PodcastEditorSkeleton } from '../podcastEditorUi'

interface EditPodcastGeneralProps {
  orgslug: string
}

function EditPodcastGeneral({ orgslug }: EditPodcastGeneralProps) {
  const { podcast, isLoading } = usePodcast()

  if (isLoading || !podcast) {
    return (
      <PodcastEditorPage>
        <PodcastEditorSkeleton sections={2} rows={3} />
      </PodcastEditorPage>
    )
  }
  return <GeneralForm podcast={podcast} orgslug={orgslug} />
}

function GeneralForm({ podcast, orgslug }: { podcast: Podcast; orgslug: string }) {
  const { t } = useTranslation()
  const { refreshPodcast, setPodcast } = usePodcast()
  const session = useLHSession() as any
  const org = useOrg() as any
  const queryClient = useQueryClient()
  const { track } = useLHAnalytics('dashboard')
  const accessToken = session?.data?.tokens?.access_token
  const [thumbnailFile, setThumbnailFile] = useState<File | null>(null)
  const [thumbnailPreview, setThumbnailPreview] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  // A cover the media server can't serve shows the upload prompt instead.
  const [savedThumbnailFailed, setSavedThumbnailFailed] = useState(false)
  const [visibilityBusy, setVisibilityBusy] = useState<'public' | 'published' | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const clearThumbnail = () => {
    setThumbnailFile(null)
    setThumbnailPreview(null)
    if (fileInput.current) fileInput.current.value = ''
  }

  const invalidate = async () => {
    await revalidateTags(['podcasts'], orgslug)
    queryClient.invalidateQueries({ queryKey: queryKeys.podcasts.list(orgslug) })
    queryClient.invalidateQueries({ queryKey: queryKeys.podcasts.detail(podcast.podcast_uuid) })
  }

  // Text fields and the cover share the one save bar. The visibility
  // switches save on their own, so they never fight the header's publish
  // button over a stale form value.
  const formik = useFormik({
    initialValues: {
      name: podcast.name || '',
      description: podcast.description || '',
      about: podcast.about || '',
      tags: podcast.tags || '',
    },
    validationSchema: Yup.object({
      name: Yup.string()
        .trim()
        .required(t('podcasts.form.name_required'))
        .min(3, t('podcasts.form.name_min_length'))
        .max(100, t('podcasts.form.name_max_length')),
      description: Yup.string().max(500, t('podcasts.form.description_max_length')),
      about: Yup.string().max(2000, t('podcasts.dashboard.form.about_max_length')),
      tags: Yup.string(),
    }),
    enableReinitialize: true,
    onSubmit: async (values) => {
      const thumbnailChanged = !!thumbnailFile
      const toastId = toast.loading(t('podcasts.dashboard.saving'))
      try {
        await updatePodcast(podcast.podcast_uuid, { ...values, name: values.name.trim() }, accessToken)
        track(AnalyticsEvent.PodcastUpdated, {
          is_published: podcast.published,
          thumbnail_changed: thumbnailChanged,
        })
        if (thumbnailFile) {
          const formData = new FormData()
          formData.append('thumbnail', thumbnailFile)
          await updatePodcastThumbnail(podcast.podcast_uuid, formData, accessToken)
        }
        await refreshPodcast()
        await invalidate()
        clearThumbnail()
        setSavedThumbnailFailed(false)
        toast.success(t('podcasts.dashboard.saved'), { id: toastId })
      } catch (error) {
        console.error('Failed to save podcast:', error)
        toast.error(t('podcasts.dashboard.save_error'), { id: toastId })
      }
    },
  })

  const pickThumbnail = (file?: File | null) => {
    if (!file || !file.type.startsWith('image/')) return
    setThumbnailFile(file)
    const reader = new FileReader()
    reader.onloadend = () => setThumbnailPreview(reader.result as string)
    reader.readAsDataURL(file)
  }

  const saveVisibility = async (key: 'public' | 'published', value: boolean) => {
    setVisibilityBusy(key)
    setPodcast({ ...podcast, [key]: value })
    try {
      await updatePodcast(podcast.podcast_uuid, { [key]: value }, accessToken)
      if (key === 'published') track(AnalyticsEvent.PodcastUpdated, { is_published: value, thumbnail_changed: false })
      toast.success(t('podcasts.dashboard.saved'))
      invalidate()
    } catch {
      setPodcast(podcast)
      toast.error(t('podcasts.dashboard.save_error'))
    } finally {
      setVisibilityBusy(null)
    }
  }

  const discard = () => {
    formik.resetForm()
    clearThumbnail()
  }

  const savedThumbnail =
    podcast.thumbnail_image && !savedThumbnailFailed
      ? getPodcastThumbnailMediaDirectory(org?.org_uuid, podcast.podcast_uuid, podcast.thumbnail_image)
      : null
  const currentThumbnail = thumbnailPreview || savedThumbnail
  const dirty = formik.dirty || !!thumbnailFile
  const fieldError = (field: 'name' | 'description' | 'about') =>
    formik.touched[field] || formik.submitCount ? (formik.errors[field] as string | undefined) : undefined

  return (
    <PodcastEditorPage>
      <form
        onSubmit={formik.handleSubmit}
        className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_380px] gap-5 items-start"
      >
        <SectionCard
          icon={<TextT size={16} />}
          title={t('podcasts.dashboard.general.details_title')}
          description={t('podcasts.dashboard.general.details_description')}
        >
          <div className="space-y-5">
            <div>
              <FieldLabel error={fieldError('name')}>{t('podcasts.modals.create.form.name_label')}</FieldLabel>
              <input
                name="name"
                aria-label={t('podcasts.modals.create.form.name_label')}
                value={formik.values.name}
                onChange={formik.handleChange}
                onBlur={formik.handleBlur}
                placeholder={t('podcasts.modals.create.form.name_placeholder')}
                className={INPUT}
                dir="auto"
              />
            </div>
            <div>
              <FieldLabel error={fieldError('description')} hint={`${formik.values.description.length}/500`}>
                {t('podcasts.modals.create.form.description_label')}
              </FieldLabel>
              <textarea
                name="description"
                aria-label={t('podcasts.modals.create.form.description_label')}
                value={formik.values.description}
                onChange={formik.handleChange}
                onBlur={formik.handleBlur}
                placeholder={t('podcasts.modals.create.form.description_placeholder')}
                rows={2}
                className={TEXTAREA}
                dir="auto"
              />
            </div>
            <div>
              <FieldLabel error={fieldError('about')} hint={`${formik.values.about.length}/2000`}>
                {t('podcasts.dashboard.form.about')}
              </FieldLabel>
              <textarea
                name="about"
                aria-label={t('podcasts.dashboard.form.about')}
                value={formik.values.about}
                onChange={formik.handleChange}
                onBlur={formik.handleBlur}
                placeholder={t('podcasts.dashboard.form.about_placeholder')}
                rows={6}
                className={TEXTAREA}
                dir="auto"
              />
            </div>
            <div>
              <FieldLabel hint={t('podcasts.dashboard.form.tags_hint')}>{t('podcasts.tags')}</FieldLabel>
              <input
                name="tags"
                aria-label={t('podcasts.tags')}
                value={formik.values.tags}
                onChange={formik.handleChange}
                placeholder={t('podcasts.dashboard.form.tags_placeholder')}
                className={INPUT}
                dir="auto"
              />
            </div>
          </div>
        </SectionCard>

        <div className="space-y-5">
          <SectionCard
            icon={<ImageSquare size={16} />}
            title={t('podcasts.dashboard.form.thumbnail')}
            description={t('podcasts.dashboard.form.thumbnail_hint')}
          >
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => pickThumbnail(e.target.files?.[0])}
            />
            <div
              role="button"
              tabIndex={0}
              aria-label={t('podcasts.dashboard.form.upload_thumbnail')}
              onClick={() => fileInput.current?.click()}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  fileInput.current?.click()
                }
              }}
              onDragOver={(e) => {
                e.preventDefault()
                setDragOver(true)
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault()
                setDragOver(false)
                pickThumbnail(e.dataTransfer.files?.[0])
              }}
              className={`group relative w-full max-w-[280px] xl:max-w-none aspect-square rounded-2xl overflow-hidden cursor-pointer transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/20 ${
                dragOver
                  ? 'ring-2 ring-sky-400 bg-sky-50 scale-[1.01]'
                  : currentThumbnail
                    ? 'ring-1 ring-black/5'
                    : 'border-2 border-dashed border-neutral-200 bg-neutral-50 hover:border-neutral-300 hover:bg-neutral-100/60'
              }`}
            >
              {currentThumbnail ? (
                <>
                  <img
                    src={currentThumbnail}
                    alt={t('podcasts.podcast_thumbnail')}
                    onError={() => !thumbnailPreview && setSavedThumbnailFailed(true)}
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute inset-0 flex items-center justify-center bg-neutral-900/0 group-hover:bg-neutral-900/40 transition-colors">
                    <span className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-white text-neutral-900 text-xs font-semibold shadow-sm opacity-0 group-hover:opacity-100 transition-opacity">
                      <ImageSquare size={14} />
                      {t('podcasts.dashboard.general.replace_cover')}
                    </span>
                  </div>
                </>
              ) : (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-center px-6">
                  <span className="w-11 h-11 rounded-xl bg-white nice-shadow text-neutral-500 flex items-center justify-center">
                    <ImageSquare size={20} />
                  </span>
                  <span className="text-sm font-semibold text-neutral-700">{t('podcasts.dashboard.form.upload_thumbnail')}</span>
                  <span className="text-xs text-neutral-500">{t('podcasts.dashboard.general.cover_drop')}</span>
                </div>
              )}
              {thumbnailPreview && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    clearThumbnail()
                  }}
                  aria-label={t('podcasts.dashboard.general.discard_cover')}
                  title={t('podcasts.dashboard.general.discard_cover')}
                  className="absolute top-2.5 end-2.5 h-7 w-7 inline-flex items-center justify-center rounded-md bg-white/90 text-rose-600 shadow-sm hover:bg-white transition-colors"
                >
                  <Trash size={14} />
                </button>
              )}
            </div>
          </SectionCard>

          <SectionCard
            icon={<Eye size={16} />}
            title={t('podcasts.dashboard.form.visibility')}
            description={t('podcasts.dashboard.general.visibility_description')}
          >
            <div className="divide-y divide-neutral-100">
              <SettingRow
                icon={<Eye size={16} />}
                title={t('podcasts.published')}
                description={t('podcasts.dashboard.form.published_hint')}
                control={
                  <Switch
                    checked={podcast.published}
                    disabled={visibilityBusy === 'published'}
                    onCheckedChange={(v) => saveVisibility('published', v)}
                    aria-label={t('podcasts.published')}
                  />
                }
              />
              <SettingRow
                icon={<Globe size={16} />}
                title={t('podcasts.public')}
                description={t('podcasts.dashboard.form.public_hint')}
                control={
                  <Switch
                    checked={podcast.public}
                    disabled={visibilityBusy === 'public'}
                    onCheckedChange={(v) => saveVisibility('public', v)}
                    aria-label={t('podcasts.public')}
                  />
                }
              />
            </div>
          </SectionCard>
        </div>

        <div className="xl:col-span-2">
          <StickySaveBar
            visible={dirty}
            saving={formik.isSubmitting}
            onSave={formik.submitForm}
            onDiscard={discard}
            saveLabel={t('podcasts.dashboard.save_changes')}
          />
        </div>
      </form>
    </PodcastEditorPage>
  )
}

export default EditPodcastGeneral
