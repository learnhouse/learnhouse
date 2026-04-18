'use client'
import React, { useState, useEffect } from 'react'
import { usePodcast } from '@components/Contexts/PodcastContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrg } from '@components/Contexts/OrgContext'
import { updatePodcast, updatePodcastThumbnail } from '@services/podcasts/podcasts'
import { getPodcastThumbnailMediaDirectory } from '@services/media/media'
import { revalidateTags } from '@services/utils/ts/requests'
import { useFormik } from 'formik'
import * as Yup from 'yup'
import { useTranslation } from 'react-i18next'
import { Loader2, Upload, Trash2, Save } from 'lucide-react'
import toast from 'react-hot-toast'
import FormLayout, {
  FormField,
  FormLabelAndMessage,
  Input,
  Textarea,
} from '@components/Objects/StyledElements/Form/Form'
import * as Form from '@radix-ui/react-form'

interface EditPodcastGeneralProps {
  orgslug: string
}

function EditPodcastGeneral({ orgslug }: EditPodcastGeneralProps) {
  const { t } = useTranslation()
  const { podcast, refreshPodcast, isLoading } = usePodcast()
  const session = useLHSession() as any
  const org = useOrg() as any
  const [isSaving, setIsSaving] = useState(false)
  const [thumbnailFile, setThumbnailFile] = useState<File | null>(null)
  const [thumbnailPreview, setThumbnailPreview] = useState<string | null>(null)

  const accessToken = session?.data?.tokens?.access_token

  const validationSchema = Yup.object({
    name: Yup.string()
      .required(t('podcasts.form.name_required'))
      .min(3, t('podcasts.form.name_min_length'))
      .max(100, t('podcasts.form.name_max_length')),
    description: Yup.string()
      .max(500, t('podcasts.form.description_max_length')),
    about: Yup.string()
      .max(2000, t('podcasts.dashboard.form.about_max_length')),
    tags: Yup.string(),
    public: Yup.boolean(),
    published: Yup.boolean(),
  })

  const formik = useFormik({
    initialValues: {
      name: podcast?.name || '',
      description: podcast?.description || '',
      about: podcast?.about || '',
      tags: podcast?.tags || '',
      public: podcast?.public || false,
      published: podcast?.published || false,
    },
    validationSchema,
    enableReinitialize: true,
    onSubmit: async (values) => {
      setIsSaving(true)
      const toastId = toast.loading(t('podcasts.dashboard.saving'))
      try {
        await updatePodcast(podcast!.podcast_uuid, values, accessToken)

        if (thumbnailFile) {
          const formData = new FormData()
          formData.append('thumbnail', thumbnailFile)
          await updatePodcastThumbnail(podcast!.podcast_uuid, formData, accessToken)
        }

        await revalidateTags(['podcasts'], orgslug)
        await refreshPodcast()
        toast.success(t('podcasts.dashboard.saved'), { id: toastId })
        setThumbnailFile(null)
        setThumbnailPreview(null)
      } catch (error) {
        console.error('Failed to save podcast:', error)
        toast.error(t('podcasts.dashboard.save_error'), { id: toastId })
      } finally {
        setIsSaving(false)
      }
    },
  })

  const handleThumbnailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      setThumbnailFile(file)
      const reader = new FileReader()
      reader.onloadend = () => {
        setThumbnailPreview(reader.result as string)
      }
      reader.readAsDataURL(file)
    }
  }

  const removeThumbnail = () => {
    setThumbnailFile(null)
    setThumbnailPreview(null)
  }

  if (isLoading || !podcast) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
      </div>
    )
  }

  const currentThumbnail = thumbnailPreview || (podcast.thumbnail_image
    ? getPodcastThumbnailMediaDirectory(org?.org_uuid, podcast.podcast_uuid, podcast.thumbnail_image)
    : null)

  return (
    <div className="h-full">
      <div className="h-6" />
      <div className="px-10 pb-10">
        <div className="bg-white rounded-xl shadow-sm">
          <FormLayout onSubmit={formik.handleSubmit} className="p-6">
            <div className="space-y-6">
              {/* Thumbnail */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  {t('podcasts.dashboard.form.thumbnail')}
                </label>
                <div className="flex items-start space-x-4">
                  <div className="relative w-40 h-40 bg-gray-100 rounded-lg overflow-hidden">
                    {currentThumbnail ? (
                      <>
                        <img
                          src={currentThumbnail}
                          alt="Podcast thumbnail"
                          className="w-full h-full object-cover"
                        />
                        <button
                          type="button"
                          onClick={removeThumbnail}
                          className="absolute top-2 end-2 p-1.5 bg-red-500 text-white rounded-full hover:bg-red-600 transition-colors"
                        >
                          <Trash2 size={14} />
                        </button>
                      </>
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-gray-400">
                        <Upload size={32} />
                      </div>
                    )}
                  </div>
                  <div className="flex-1">
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleThumbnailChange}
                      className="hidden"
                      id="thumbnail-upload"
                    />
                    <label
                      htmlFor="thumbnail-upload"
                      className="inline-flex items-center px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 cursor-pointer transition-colors"
                    >
                      <Upload size={16} className="me-2" />
                      {t('podcasts.dashboard.form.upload_thumbnail')}
                    </label>
                    <p className="mt-2 text-xs text-gray-500">
                      {t('podcasts.dashboard.form.thumbnail_hint')}
                    </p>
                  </div>
                </div>
              </div>

              {/* Name */}
              <FormField name="name">
                <FormLabelAndMessage
                  label={t('podcasts.modals.create.form.name_label')}
                  message={formik.errors.name as string}
                />
                <Form.Control asChild>
                  <Input
                    onChange={formik.handleChange}
                    value={formik.values.name}
                    placeholder={t('podcasts.modals.create.form.name_placeholder')}
                  />
                </Form.Control>
              </FormField>

              {/* Description */}
              <FormField name="description">
                <FormLabelAndMessage
                  label={t('podcasts.modals.create.form.description_label')}
                  message={formik.errors.description as string}
                />
                <Form.Control asChild>
                  <Textarea
                    onChange={formik.handleChange}
                    value={formik.values.description}
                    placeholder={t('podcasts.modals.create.form.description_placeholder')}
                    rows={3}
                  />
                </Form.Control>
              </FormField>

              {/* About */}
              <FormField name="about">
                <FormLabelAndMessage
                  label={t('podcasts.dashboard.form.about')}
                  message={formik.errors.about as string}
                />
                <Form.Control asChild>
                  <Textarea
                    onChange={formik.handleChange}
                    value={formik.values.about}
                    placeholder={t('podcasts.dashboard.form.about_placeholder')}
                    rows={5}
                  />
                </Form.Control>
              </FormField>

              {/* Tags */}
              <FormField name="tags">
                <FormLabelAndMessage
                  label={t('podcasts.tags')}
                  message={formik.errors.tags as string}
                />
                <Form.Control asChild>
                  <Input
                    onChange={formik.handleChange}
                    value={formik.values.tags}
                    placeholder={t('podcasts.dashboard.form.tags_placeholder')}
                  />
                </Form.Control>
                <p className="mt-1 text-xs text-gray-500">
                  {t('podcasts.dashboard.form.tags_hint')}
                </p>
              </FormField>

              {/* Visibility Options */}
              <div className="border-t border-gray-100 pt-6">
                <h3 className="text-sm font-medium text-gray-900 mb-4">
                  {t('podcasts.dashboard.form.visibility')}
                </h3>
                <div className="space-y-4">
                  <label className="flex items-center space-x-3 cursor-pointer">
                    <input
                      type="checkbox"
                      name="public"
                      checked={formik.values.public}
                      onChange={formik.handleChange}
                      className="w-4 h-4 text-black rounded border-gray-300 focus:ring-black/20"
                    />
                    <div>
                      <span className="text-sm font-medium text-gray-700">
                        {t('podcasts.public')}
                      </span>
                      <p className="text-xs text-gray-500">
                        {t('podcasts.dashboard.form.public_hint')}
                      </p>
                    </div>
                  </label>

                  <label className="flex items-center space-x-3 cursor-pointer">
                    <input
                      type="checkbox"
                      name="published"
                      checked={formik.values.published}
                      onChange={formik.handleChange}
                      className="w-4 h-4 text-black rounded border-gray-300 focus:ring-black/20"
                    />
                    <div>
                      <span className="text-sm font-medium text-gray-700">
                        {t('podcasts.published')}
                      </span>
                      <p className="text-xs text-gray-500">
                        {t('podcasts.dashboard.form.published_hint')}
                      </p>
                    </div>
                  </label>
                </div>
              </div>

              {/* Submit Button */}
              <div className="flex justify-end pt-4 border-t border-gray-100">
                <button
                  type="submit"
                  disabled={isSaving || !formik.isValid}
                  className="inline-flex items-center px-4 py-2 text-sm font-medium text-white bg-black hover:bg-black/90 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSaving ? (
                    <Loader2 size={16} className="me-2 animate-spin" />
                  ) : (
                    <Save size={16} className="me-2" />
                  )}
                  {t('podcasts.dashboard.save_changes')}
                </button>
              </div>
            </div>
          </FormLayout>
        </div>
      </div>
    </div>
  )
}

export default EditPodcastGeneral
