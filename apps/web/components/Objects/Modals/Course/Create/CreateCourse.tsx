'use client'
import { createNewCourse } from '@services/courses/courses'
import { createChapter } from '@services/courses/chapters'
import { useOrg } from '@components/Contexts/OrgContext'
import React from 'react'
import { revalidateTags } from '@services/utils/ts/requests'
import { useRouter } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query/keys'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import toast from 'react-hot-toast'
import { useFormik } from 'formik'
import * as Yup from 'yup'
import { Clipboard, Globe, ImageSquare, CircleNotch, Lock, CloudArrowUp, X } from '@phosphor-icons/react'
import AIImageButton from '@components/Objects/AI/AIImageButton'
import FormTagInput from "@components/Objects/StyledElements/Form/TagInput"
import { useTranslation } from "react-i18next"
import { useLHAnalytics, AnalyticsEvent } from '@services/analytics'
import { useUpgradeModal } from '@components/Dashboard/Shared/PlanRestricted/UpgradeModalContext'
import {
  BTN_PRIMARY,
  BTN_SECONDARY,
  ChoiceCard,
  FieldLabel,
  INPUT,
  TEXTAREA,
} from '@components/Dashboard/Shared/DashKit/DashKit'

const _validationSchema = Yup.object().shape({
  name: Yup.string()
    .required('Course name is required')
    .max(100, 'Must be 100 characters or less'),
  description: Yup.string()
    .max(1000, 'Must be 1000 characters or less'),
  learnings: Yup.string(),
  tags: Yup.string(),
  visibility: Yup.boolean(),
  thumbnail: Yup.mixed().nullable()
})

function CreateCourseModal({ closeModal, orgslug, onCancel }: any) {
  const { t } = useTranslation()
  const { track } = useLHAnalytics('dashboard')
  const router = useRouter()
  const session = useLHSession() as any
  const queryClient = useQueryClient()
  // The org is already in context; no need to refetch it just for its id.
  const org = useOrg() as any
  const orgId = org?.id
  const [isUploading, setIsUploading] = React.useState(false)
  // A free org that hits its course limit gets the shared upgrade paywall.
  const { handlePlanLimit } = useUpgradeModal()

  const validationSchema = Yup.object().shape({
    name: Yup.string()
      .required(t('courses.course_name_required'))
      .max(100, 'Must be 100 characters or less'),
    description: Yup.string()
      .required(t('courses.course_description_required'))
      .max(1000, 'Must be 1000 characters or less'),
    learnings: Yup.string(),
    tags: Yup.string(),
    visibility: Yup.boolean(),
    thumbnail: Yup.mixed().nullable()
  })

  const formik = useFormik({
    initialValues: {
      name: '',
      description: '',
      learnings: '',
      visibility: true,
      tags: '',
      thumbnail: null
    },
    validationSchema,
    onSubmit: async (values, { setSubmitting }) => {
      const toast_loading = toast.loading(t('courses.creating_course'))

      try {
        const res = await createNewCourse(
          orgId,
          {
            name: values.name,
            description: values.description,
            learnings: values.learnings,
            tags: values.tags,
            visibility: values.visibility
          },
          values.thumbnail,
          session.data?.tokens?.access_token
        )

        if (res.success) {
          const thumbnailFile = values.thumbnail as File | null
          track(AnalyticsEvent.CourseCreated, {
            thumbnail_source: thumbnailFile
              ? thumbnailFile.name === 'ai_image.jpg'
                ? 'ai'
                : 'upload'
              : 'none',
            visibility: values.visibility ? 'public' : 'private',
            has_learnings: !!values.learnings?.trim(),
          })
          // Create a default first chapter so the new course isn't empty.
          // Never let a failure here block course creation.
          try {
            await createChapter(
              {
                name: t('courses.first_chapter_default_name', { defaultValue: 'First Chapter' }),
                description: '',
                thumbnail_image: '',
                course_id: res.data.id,
                org_id: res.data.org_id ?? orgId,
              },
              session.data?.tokens?.access_token
            )
          } catch (_chapterError) {
            // Ignore: the default chapter is a convenience, not a requirement.
          }

          await revalidateTags(['courses'], orgslug)
          // Refresh sidebar courses cache
          queryClient.invalidateQueries({ queryKey: queryKeys.courses.list(orgslug) })
          toast.dismiss(toast_loading)
          toast.success(t('courses.course_created_success'))

          closeModal()
          // Redirect straight to the Content tab and auto-open the "add activity"
          // popup so a brand-new course lands the teacher on the core creation
          // action (their first activity) instead of an empty settings page.
          const courseId = res.data.course_uuid?.replace('course_', '') || res.data.course_uuid
          router.push(`/dash/courses/course/${courseId}/content?new_activity=1`)
        } else {
          toast.dismiss(toast_loading)
          const detail = typeof res.data?.detail === 'string' ? res.data.detail : ''
          // A free org that has hit its course limit gets a contextual upgrade
          // paywall at the moment of value, instead of a dead-end error toast.
          if (handlePlanLimit(res, { source: 'course_create', feature: 'courses', requiredPlan: 'standard' })) {
            closeModal()
          } else {
            const errorMessage = detail
              ? detail
              : Array.isArray(res.data?.detail)
                ? res.data.detail.map((e: any) => e.msg).join(', ')
                : t('courses.failed_to_create_course')
            toast.error(errorMessage)
          }
        }
      } catch (_error) {
        toast.error(t('courses.failed_to_create_course'))
      } finally {
        setSubmitting(false)
      }
    }
  })

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) {
      formik.setFieldValue('thumbnail', file)
    }
  }

  const handleRemoteImageSelect = async (imageUrl: string) => {
    setIsUploading(true)
    try {
      const response = await fetch(imageUrl)
      const blob = await response.blob()
      const file = new File([blob], 'ai_image.jpg', { type: 'image/jpeg' })
      formik.setFieldValue('thumbnail', file)
    } catch (_error) {
      toast.error(t('courses.create.generated_image_failed'))
    }
    setIsUploading(false)
  }

  const handleAIImageFile = async (file: File) => {
    formik.setFieldValue('thumbnail', file)
  }

  const handlePasteFromClipboard = async () => {
    try {
      const clipboardItems = await navigator.clipboard.read()
      for (const clipboardItem of clipboardItems) {
        const imageTypes = clipboardItem.types.filter(type => type.startsWith('image/'))
        if (imageTypes.length > 0) {
          const imageType = imageTypes[0]
          const blob = await clipboardItem.getType(imageType)
          // The API derives the stored extension from the filename, so it must
          // match the blob's actual type (browsers may hand back jpeg/webp/gif).
          const extensionByType: Record<string, string> = {
            'image/jpeg': 'jpg',
            'image/png': 'png',
            'image/gif': 'gif',
            'image/webp': 'webp',
          }
          const extension = extensionByType[imageType] ?? 'png'
          const file = new File([blob], `clipboard_image.${extension}`, { type: imageType })
          formik.setFieldValue('thumbnail', file)
          return
        }
      }
      toast.error(t('courses.no_image_in_clipboard', { defaultValue: 'No image found in clipboard' }))
    } catch (_) {
      toast.error(t('courses.clipboard_read_error', { defaultValue: 'Failed to read from clipboard' }))
    }
  }

  const [isDragging, setIsDragging] = React.useState(false)
  const thumbnailFile = formik.values.thumbnail as File | null
  const thumbnailPreview = React.useMemo(
    () => (thumbnailFile ? URL.createObjectURL(thumbnailFile) : null),
    [thumbnailFile]
  )
  React.useEffect(() => () => {
    if (thumbnailPreview) URL.revokeObjectURL(thumbnailPreview)
  }, [thumbnailPreview])

  const acceptImage = (file?: File | null) => {
    if (file && file.type.startsWith('image/')) formik.setFieldValue('thumbnail', file)
  }

  // Pasting an image anywhere in the form sets it as the thumbnail.
  const handlePaste = (e: React.ClipboardEvent) => {
    const item = Array.from(e.clipboardData.items).find((i) => i.type.startsWith('image/'))
    const file = item?.getAsFile()
    if (file) {
      e.preventDefault()
      acceptImage(file)
    }
  }

  const fieldError = (name: 'name' | 'description') =>
    formik.touched[name] && formik.errors[name] ? (formik.errors[name] as string) : undefined

  return (
    <form onSubmit={formik.handleSubmit} onPaste={handlePaste} className="flex flex-col gap-5">
      <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_260px] gap-5">
        <div className="flex flex-col gap-4 min-w-0">
          <label className="block">
            <FieldLabel error={fieldError('name')} hint={`${formik.values.name.length}/100`}>
              {t('courses.course_name')}
            </FieldLabel>
            <input
              name="name"
              autoFocus
              value={formik.values.name}
              onChange={formik.handleChange}
              onBlur={formik.handleBlur}
              maxLength={100}
              placeholder={t('dashboard.courses.home.name_placeholder')}
              className={INPUT}
            />
          </label>
          <label className="block">
            <FieldLabel error={fieldError('description')}>{t('library.description')}</FieldLabel>
            <textarea
              name="description"
              rows={4}
              value={formik.values.description}
              onChange={formik.handleChange}
              onBlur={formik.handleBlur}
              placeholder={t('dashboard.courses.home.description_placeholder')}
              className={TEXTAREA}
            />
          </label>
        </div>

        <div className="flex flex-col">
          <FieldLabel>{t('courses.course_thumbnail')}</FieldLabel>
          <input
            type="file"
            id="fileInput"
            className="hidden"
            onChange={handleFileChange}
            accept="image/jpeg,image/png,image/webp,image/gif"
          />
          <div
            onDragOver={(e) => {
              e.preventDefault()
              setIsDragging(true)
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(e) => {
              e.preventDefault()
              setIsDragging(false)
              acceptImage(e.dataTransfer.files?.[0])
            }}
            className={`relative aspect-video rounded-xl overflow-hidden transition-all ${
              isDragging
                ? 'ring-2 ring-neutral-900 bg-neutral-50'
                : thumbnailPreview
                  ? 'ring-1 ring-black/5'
                  : 'border-2 border-dashed border-neutral-200 bg-neutral-50 hover:bg-neutral-100'
            }`}
          >
            {thumbnailPreview ? (
              <>
                <img
                  src={thumbnailPreview}
                  alt=""
                  className={`w-full h-full object-cover ${isUploading ? 'animate-pulse' : ''}`}
                />
                <button
                  type="button"
                  onClick={() => formik.setFieldValue('thumbnail', null)}
                  aria-label={t('common.remove')}
                  className="absolute top-2 end-2 w-7 h-7 rounded-full bg-black/60 text-white flex items-center justify-center hover:bg-black/80"
                >
                  <X size={14} />
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => document.getElementById('fileInput')?.click()}
                className="w-full h-full flex flex-col items-center justify-center gap-1.5 text-neutral-500"
              >
                <ImageSquare size={22} className="text-neutral-400" />
                <span className="text-xs font-semibold text-neutral-700">{t('dashboard.courses.home.drop_image')}</span>
                <span className="text-[11px] text-neutral-400">{t('dashboard.courses.home.drop_image_hint')}</span>
              </button>
            )}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1">
            <button
              type="button"
              onClick={() => document.getElementById('fileInput')?.click()}
              className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg text-xs font-semibold text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100 transition-colors"
            >
              <CloudArrowUp size={14} />
              {t('courses.upload_image')}
            </button>
            <button
              type="button"
              onClick={handlePasteFromClipboard}
              className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg text-xs font-semibold text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100 transition-colors"
            >
              <Clipboard size={14} />
              {t('courses.paste_from_clipboard')}
            </button>
            <AIImageButton
              onSelect={handleRemoteImageSelect}
              onSelectFile={handleAIImageFile}
              className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg text-xs font-semibold text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100 transition-colors"
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <FieldLabel hint={t('courses.enter_to_add')}>{t('courses.course_learnings')}</FieldLabel>
          <FormTagInput
            placeholder={t('courses.enter_to_add')}
            value={formik.values.learnings}
            onChange={(value) => formik.setFieldValue('learnings', value)}
            error={formik.errors.learnings}
          />
        </div>
        <div>
          <FieldLabel hint={t('courses.enter_to_add')}>{t('courses.course_tags')}</FieldLabel>
          <FormTagInput
            placeholder={t('courses.enter_to_add')}
            value={formik.values.tags}
            onChange={(value) => formik.setFieldValue('tags', value)}
            error={formik.errors.tags}
          />
        </div>
      </div>

      <div>
        <FieldLabel>{t('courses.course_visibility')}</FieldLabel>
        <div role="radiogroup" className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <ChoiceCard
            selected={formik.values.visibility}
            onClick={() => formik.setFieldValue('visibility', true)}
            icon={<Globe size={18} />}
            title={t('courses.public')}
            description={t('courses.public_desc')}
          />
          <ChoiceCard
            selected={!formik.values.visibility}
            onClick={() => formik.setFieldValue('visibility', false)}
            icon={<Lock size={18} />}
            title={t('courses.private')}
            description={t('courses.private_desc')}
          />
        </div>
      </div>

      <div className="flex items-center justify-end gap-2 pt-4 border-t border-neutral-100">
        <button type="button" onClick={onCancel ?? closeModal} disabled={formik.isSubmitting} className={BTN_SECONDARY}>
          {t('common.cancel')}
        </button>
        <button type="submit" disabled={formik.isSubmitting || !orgId} className={BTN_PRIMARY}>
          {formik.isSubmitting && <CircleNotch size={15} className="animate-spin" />}
          {t('courses.create_course_btn')}
        </button>
      </div>
    </form>
  )
}

export default CreateCourseModal
