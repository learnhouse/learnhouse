'use client'
import React, { useRef, useState } from 'react'
import { useFormik } from 'formik'
import * as Yup from 'yup'
import { useTranslation } from 'react-i18next'
import { CheckCircle, Eye, Gauge, Globe, ImageSquare, Stack, Mountains, Plant, TrendUp, Trash, TextT } from '@phosphor-icons/react'
import toast from 'react-hot-toast'
import { useOrg } from '@components/Contexts/OrgContext'
import { Switch } from '@components/ui/switch'
import {
  FieldLabel,
  INPUT,
  SectionCard,
  SettingRow,
  StickySaveBar,
  TEXTAREA,
} from '@components/Dashboard/Shared/DashKit/DashKit'
import { getPathThumbnailMediaDirectory } from '@services/media/media'
import { Path, PathLevel, updatePath, updatePathThumbnail } from '@services/paths/paths'
import { getErrorMessage } from '@services/utils/ts/errorMessage'
import { usePathCache } from './usePathSave'

const LEVELS: { value: PathLevel; Icon: typeof Stack; tone: string }[] = [
  { value: '', Icon: Stack, tone: 'bg-neutral-100 text-neutral-700' },
  { value: 'beginner', Icon: Plant, tone: 'bg-emerald-50 text-emerald-700' },
  { value: 'intermediate', Icon: TrendUp, tone: 'bg-sky-50 text-sky-700' },
  { value: 'advanced', Icon: Mountains, tone: 'bg-violet-50 text-violet-700' },
]

function EditPathGeneral({ path }: { path: Path }) {
  const { t } = useTranslation()
  const org = useOrg() as any
  const { accessToken, store } = usePathCache()
  const [isSaving, setIsSaving] = useState(false)
  const [thumbnailFile, setThumbnailFile] = useState<File | null>(null)
  const [thumbnailPreview, setThumbnailPreview] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  // Visibility switches save on their own, so the header's publish button and
  // these never fight over a stale form value.
  const [pendingVisibility, setPendingVisibility] = useState<{ published?: boolean; public?: boolean }>({})

  const clearThumbnail = () => {
    setThumbnailFile(null)
    setThumbnailPreview(null)
    if (fileInput.current) fileInput.current.value = ''
  }

  const formik = useFormik({
    initialValues: {
      name: path.name,
      description: path.description || '',
      about: path.about || '',
      level: (path.level || '') as PathLevel,
    },
    validationSchema: Yup.object({
      name: Yup.string().trim().required(t('paths.form.name_required')).max(200, t('paths.form.name_max_length')),
      description: Yup.string().max(500, t('paths.form.description_max_length')),
      about: Yup.string().max(5000),
    }),
    enableReinitialize: true,
    onSubmit: async (values) => {
      setIsSaving(true)
      const toastId = toast.loading(t('paths.toasts.saving'))
      try {
        let updated = await updatePath(path.path_uuid, { ...values, name: values.name.trim() }, accessToken)
        if (thumbnailFile) {
          updated = await updatePathThumbnail(path.path_uuid, thumbnailFile, accessToken)
        }
        store(updated)
        clearThumbnail()
        toast.success(t('paths.toasts.saved'), { id: toastId })
      } catch (error: any) {
        toast.error(getErrorMessage(error?.detail, t('paths.toasts.save_error')), { id: toastId })
      } finally {
        setIsSaving(false)
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

  const saveVisibility = async (body: { published?: boolean; public?: boolean }) => {
    setPendingVisibility((prev) => ({ ...prev, ...body }))
    try {
      store(await updatePath(path.path_uuid, body, accessToken))
    } catch (error: any) {
      toast.error(getErrorMessage(error?.detail, t('paths.toasts.save_error')))
    } finally {
      setPendingVisibility((prev) => {
        const next = { ...prev }
        for (const key of Object.keys(body) as (keyof typeof body)[]) delete next[key]
        return next
      })
    }
  }

  const discard = () => {
    formik.resetForm()
    clearThumbnail()
  }

  const currentThumbnail =
    thumbnailPreview ||
    (path.thumbnail_image ? getPathThumbnailMediaDirectory(org?.org_uuid, path.path_uuid, path.thumbnail_image) : null)
  const published = pendingVisibility.published ?? path.published
  const isPublic = pendingVisibility.public ?? path.public
  const dirty = formik.dirty || !!thumbnailFile
  const fieldError = (field: 'name' | 'description' | 'about') =>
    formik.touched[field] || formik.submitCount ? (formik.errors[field] as string | undefined) : undefined

  return (
    <div className="px-4 sm:px-10 pt-6">
      <form
        onSubmit={formik.handleSubmit}
        className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_380px] gap-6 items-start"
      >
        {/* ---- Basics ---- */}
        <SectionCard
          icon={<TextT size={16} />}
          title={t('paths.dashboard.general.basics_title')}
          description={t('paths.dashboard.general.basics_subtitle')}
        >
          <div className="space-y-5">
            <div>
              <FieldLabel hint={t('paths.form.thumbnail_hint')}>{t('paths.form.thumbnail')}</FieldLabel>
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
                aria-label={t('paths.form.upload_thumbnail')}
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
                className={`group relative w-full max-w-md aspect-video rounded-2xl overflow-hidden cursor-pointer transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/20 ${
                  dragOver
                    ? 'ring-2 ring-sky-400 bg-sky-50 scale-[1.01]'
                    : currentThumbnail
                      ? 'ring-1 ring-black/5'
                      : 'border-2 border-dashed border-neutral-200 bg-neutral-50 hover:border-neutral-300 hover:bg-neutral-100/60'
                }`}
              >
                {currentThumbnail ? (
                  <>
                    <img src={currentThumbnail} alt="" className="w-full h-full object-cover" />
                    <div className="absolute inset-0 flex items-center justify-center bg-neutral-900/0 group-hover:bg-neutral-900/40 transition-colors">
                      <span className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-xl bg-white text-neutral-900 text-xs font-semibold shadow-sm opacity-0 group-hover:opacity-100 transition-opacity">
                        <ImageSquare size={14} />
                        {t('paths.dashboard.general.thumbnail_replace')}
                      </span>
                    </div>
                  </>
                ) : (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-center px-6">
                    <span className="w-11 h-11 rounded-xl bg-white nice-shadow text-neutral-500 flex items-center justify-center">
                      <ImageSquare size={20} />
                    </span>
                    <span className="text-sm font-semibold text-neutral-700">{t('paths.form.upload_thumbnail')}</span>
                    <span className="text-xs text-neutral-500">{t('paths.dashboard.general.thumbnail_drop')}</span>
                  </div>
                )}
                {thumbnailPreview && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      clearThumbnail()
                    }}
                    aria-label={t('paths.form.discard_thumbnail')}
                    title={t('paths.form.discard_thumbnail')}
                    className="absolute top-2.5 end-2.5 h-8 w-8 inline-flex items-center justify-center rounded-lg bg-white/90 text-rose-600 shadow-sm hover:bg-white transition-colors"
                  >
                    <Trash size={14} />
                  </button>
                )}
              </div>
            </div>

            <div>
              <FieldLabel error={fieldError('name')}>{t('paths.form.name')}</FieldLabel>
              <input
                name="name"
                aria-label={t('paths.form.name')}
                value={formik.values.name}
                onChange={formik.handleChange}
                onBlur={formik.handleBlur}
                placeholder={t('paths.form.name_placeholder')}
                className={INPUT}
                dir="auto"
              />
            </div>

            <div>
              <FieldLabel error={fieldError('description')} hint={`${formik.values.description.length}/500`}>
                {t('paths.form.description')}
              </FieldLabel>
              <textarea
                name="description"
                aria-label={t('paths.form.description')}
                value={formik.values.description}
                onChange={formik.handleChange}
                onBlur={formik.handleBlur}
                placeholder={t('paths.form.description_placeholder')}
                rows={2}
                className={TEXTAREA}
                dir="auto"
              />
            </div>

            <div>
              <FieldLabel error={fieldError('about')} hint={t('paths.form.about_hint')}>
                {t('paths.form.about')}
              </FieldLabel>
              <textarea
                name="about"
                aria-label={t('paths.form.about')}
                value={formik.values.about}
                onChange={formik.handleChange}
                onBlur={formik.handleBlur}
                placeholder={t('paths.form.about_placeholder')}
                rows={6}
                className={TEXTAREA}
                dir="auto"
              />
            </div>
          </div>
        </SectionCard>

        <div className="flex flex-col gap-6 xl:sticky xl:top-6">
          {/* ---- Level ---- */}
          <SectionCard
            icon={<Gauge size={16} />}
            title={t('paths.form.level')}
            description={t('paths.dashboard.general.level_subtitle')}
          >
            <div role="radiogroup" aria-label={t('paths.form.level')} className="grid grid-cols-2 gap-2">
              {LEVELS.map(({ value, Icon, tone }) => {
                const selected = formik.values.level === value
                return (
                  <button
                    key={value || 'all'}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => formik.setFieldValue('level', value)}
                    className={`flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-start text-sm font-semibold transition-all ${
                      selected
                        ? 'bg-white ring-2 ring-neutral-900 shadow-sm text-neutral-900'
                        : 'bg-white ring-1 ring-inset ring-neutral-200 text-neutral-600 hover:ring-neutral-300 hover:text-neutral-900'
                    }`}
                  >
                    <span className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${tone}`}>
                      <Icon size={15} />
                    </span>
                    <span className="truncate">{value ? t(`paths.levels.${value}`) : t('paths.levels.all')}</span>
                  </button>
                )
              })}
            </div>
          </SectionCard>

          {/* ---- Visibility ---- */}
          <SectionCard
            icon={<Eye size={16} />}
            title={t('paths.form.visibility')}
            description={t('paths.dashboard.general.visibility_subtitle')}
          >
            <div className="divide-y divide-neutral-100">
              <SettingRow
                icon={<CheckCircle size={16} />}
                title={t('paths.published')}
                description={t('paths.form.published_hint')}
                control={
                  <Switch
                    checked={published}
                    disabled={pendingVisibility.published !== undefined}
                    onCheckedChange={(checked) => saveVisibility({ published: checked })}
                    aria-label={t('paths.published')}
                  />
                }
              />
              <SettingRow
                icon={<Globe size={16} />}
                title={t('paths.form.public')}
                description={t('paths.form.public_hint')}
                control={
                  <Switch
                    checked={isPublic}
                    disabled={pendingVisibility.public !== undefined}
                    onCheckedChange={(checked) => saveVisibility({ public: checked })}
                    aria-label={t('paths.form.public')}
                  />
                }
              />
            </div>
          </SectionCard>
        </div>
      </form>

      <StickySaveBar
        visible={dirty}
        saving={isSaving}
        disabled={!formik.isValid}
        onSave={() => formik.handleSubmit()}
        onDiscard={discard}
        saveLabel={t('paths.form.save')}
      />
    </div>
  )
}

export default EditPathGeneral
