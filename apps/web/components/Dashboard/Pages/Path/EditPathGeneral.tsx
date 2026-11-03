'use client'
import React, { useState } from 'react'
import { useFormik } from 'formik'
import * as Yup from 'yup'
import * as Form from '@radix-ui/react-form'
import { useTranslation } from 'react-i18next'
import { Loader2, Save, Trash2, Upload } from 'lucide-react'
import toast from 'react-hot-toast'
import { useOrg } from '@components/Contexts/OrgContext'
import FormLayout, {
  FormField,
  FormLabelAndMessage,
  Input,
  Textarea,
} from '@components/Objects/StyledElements/Form/Form'
import {
  CustomSelect,
  CustomSelectContent,
  CustomSelectItem,
  CustomSelectTrigger,
  CustomSelectValue,
} from '@components/Dashboard/Pages/Course/EditCourseGeneral/CustomSelect'
import { getPathThumbnailMediaDirectory } from '@services/media/media'
import { Path, PathLevel, updatePath, updatePathThumbnail } from '@services/paths/paths'
import { getErrorMessage } from '@services/utils/ts/errorMessage'
import { usePathCache } from './usePathSave'

const LEVELS: PathLevel[] = ['', 'beginner', 'intermediate', 'advanced']

function EditPathGeneral({ path }: { path: Path }) {
  const { t } = useTranslation()
  const org = useOrg() as any
  const { accessToken, store } = usePathCache()
  const [isSaving, setIsSaving] = useState(false)
  const [thumbnailFile, setThumbnailFile] = useState<File | null>(null)
  const [thumbnailPreview, setThumbnailPreview] = useState<string | null>(null)

  const formik = useFormik({
    initialValues: {
      name: path.name,
      description: path.description || '',
      about: path.about || '',
      level: (path.level || '') as PathLevel,
      public: path.public,
      published: path.published,
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
        setThumbnailFile(null)
        setThumbnailPreview(null)
        toast.success(t('paths.toasts.saved'), { id: toastId })
      } catch (error: any) {
        toast.error(getErrorMessage(error?.detail, t('paths.toasts.save_error')), { id: toastId })
      } finally {
        setIsSaving(false)
      }
    },
  })

  const handleThumbnailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setThumbnailFile(file)
    const reader = new FileReader()
    reader.onloadend = () => setThumbnailPreview(reader.result as string)
    reader.readAsDataURL(file)
  }

  const currentThumbnail =
    thumbnailPreview ||
    (path.thumbnail_image
      ? getPathThumbnailMediaDirectory(org?.org_uuid, path.path_uuid, path.thumbnail_image)
      : null)

  return (
    <div className="h-full">
      <div className="h-6" />
      <div className="px-4 sm:px-10">
        <div className="bg-white rounded-xl shadow-sm">
          <FormLayout onSubmit={formik.handleSubmit} className="p-6">
            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">{t('paths.form.thumbnail')}</label>
                <div className="flex items-start gap-4">
                  <div className="relative w-56 aspect-video bg-gray-100 rounded-lg overflow-hidden shrink-0">
                    {currentThumbnail ? (
                      <>
                        <img src={currentThumbnail} alt="" className="w-full h-full object-cover" />
                        {thumbnailPreview && (
                          <button
                            type="button"
                            onClick={() => {
                              setThumbnailFile(null)
                              setThumbnailPreview(null)
                            }}
                            aria-label={t('paths.form.discard_thumbnail')}
                            className="absolute top-2 end-2 p-1.5 bg-red-500 text-white rounded-full hover:bg-red-600 transition-colors"
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </>
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-gray-400">
                        <Upload size={28} />
                      </div>
                    )}
                  </div>
                  <div className="flex-1">
                    <input type="file" accept="image/*" onChange={handleThumbnailChange} className="hidden" id="path-thumbnail-upload" />
                    <label
                      htmlFor="path-thumbnail-upload"
                      className="inline-flex items-center px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 cursor-pointer transition-colors"
                    >
                      <Upload size={16} className="me-2" />
                      {t('paths.form.upload_thumbnail')}
                    </label>
                    <p className="mt-2 text-xs text-gray-500">{t('paths.form.thumbnail_hint')}</p>
                  </div>
                </div>
              </div>

              <FormField name="name">
                <FormLabelAndMessage label={t('paths.form.name')} message={formik.errors.name as string} />
                <Form.Control asChild>
                  <Input onChange={formik.handleChange} value={formik.values.name} placeholder={t('paths.form.name_placeholder')} />
                </Form.Control>
              </FormField>

              <FormField name="description">
                <FormLabelAndMessage label={t('paths.form.description')} message={formik.errors.description as string} />
                <Form.Control asChild>
                  <Textarea
                    onChange={formik.handleChange}
                    value={formik.values.description}
                    placeholder={t('paths.form.description_placeholder')}
                    rows={2}
                  />
                </Form.Control>
              </FormField>

              <FormField name="about">
                <FormLabelAndMessage label={t('paths.form.about')} />
                <Form.Control asChild>
                  <Textarea
                    onChange={formik.handleChange}
                    value={formik.values.about}
                    placeholder={t('paths.form.about_placeholder')}
                    rows={5}
                  />
                </Form.Control>
                <p className="mt-1 text-xs text-gray-500">{t('paths.form.about_hint')}</p>
              </FormField>

              <FormField name="level">
                <FormLabelAndMessage label={t('paths.form.level')} />
                <CustomSelect
                  value={formik.values.level || 'all'}
                  onValueChange={(value) => formik.setFieldValue('level', value === 'all' ? '' : value)}
                >
                  <CustomSelectTrigger className="w-full sm:w-64 bg-white">
                    <CustomSelectValue>
                      {formik.values.level ? t(`paths.levels.${formik.values.level}`) : t('paths.levels.all')}
                    </CustomSelectValue>
                  </CustomSelectTrigger>
                  <CustomSelectContent>
                    {LEVELS.map((level) => (
                      <CustomSelectItem key={level || 'all'} value={level || 'all'}>
                        {level ? t(`paths.levels.${level}`) : t('paths.levels.all')}
                      </CustomSelectItem>
                    ))}
                  </CustomSelectContent>
                </CustomSelect>
              </FormField>

              <div className="border-t border-gray-100 pt-6">
                <h3 className="text-sm font-medium text-gray-900 mb-4">{t('paths.form.visibility')}</h3>
                <div className="space-y-4">
                  <label className="flex items-center space-x-3 cursor-pointer">
                    <input
                      type="checkbox"
                      name="published"
                      checked={formik.values.published}
                      onChange={formik.handleChange}
                      className="w-4 h-4 text-black rounded border-gray-300 focus:ring-black/20"
                    />
                    <div>
                      <span className="text-sm font-medium text-gray-700">{t('paths.published')}</span>
                      <p className="text-xs text-gray-500">{t('paths.form.published_hint')}</p>
                    </div>
                  </label>
                  <label className="flex items-center space-x-3 cursor-pointer">
                    <input
                      type="checkbox"
                      name="public"
                      checked={formik.values.public}
                      onChange={formik.handleChange}
                      className="w-4 h-4 text-black rounded border-gray-300 focus:ring-black/20"
                    />
                    <div>
                      <span className="text-sm font-medium text-gray-700">{t('paths.form.public')}</span>
                      <p className="text-xs text-gray-500">{t('paths.form.public_hint')}</p>
                    </div>
                  </label>
                </div>
              </div>

              <div className="flex justify-end pt-4 border-t border-gray-100">
                <button
                  type="submit"
                  disabled={isSaving || !formik.isValid}
                  className="inline-flex items-center px-4 py-2 text-sm font-medium text-white bg-black hover:bg-black/90 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSaving ? <Loader2 size={16} className="me-2 animate-spin" /> : <Save size={16} className="me-2" />}
                  {t('paths.form.save')}
                </button>
              </div>
            </div>
          </FormLayout>
        </div>
      </div>
    </div>
  )
}

export default EditPathGeneral
