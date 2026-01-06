'use client'
import { Input } from "@components/ui/input"
import { Textarea } from "@components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@components/ui/select"
import FormLayout, {
  FormField,
  FormLabelAndMessage,
} from '@components/Objects/StyledElements/Form/Form'
import * as Form from '@radix-ui/react-form'
import { createNewCourse } from '@services/courses/courses'
import { getOrganizationContextInfoWithoutCredentials } from '@services/organizations/orgs'
import React, { useEffect } from 'react'
import { BarLoader } from 'react-spinners'
import { revalidateTags } from '@services/utils/ts/requests'
import { useRouter } from 'next/navigation'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import toast from 'react-hot-toast'
import { useFormik } from 'formik'
import * as Yup from 'yup'
import {  UploadCloud, Image as ImageIcon } from 'lucide-react'
import UnsplashImagePicker from "@components/Dashboard/Pages/Course/EditCourseGeneral/UnsplashImagePicker"
import FormTagInput from "@components/Objects/StyledElements/Form/TagInput"
import { useTranslation } from "react-i18next"

const validationSchema = Yup.object().shape({
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

function CreateCourseModal({ closeModal, orgslug }: any) {
  const { t } = useTranslation()
  const router = useRouter()
  const session = useLHSession() as any
  const [orgId, setOrgId] = React.useState(null) as any
  const [showUnsplashPicker, setShowUnsplashPicker] = React.useState(false)
  const [isUploading, setIsUploading] = React.useState(false)

  const validationSchema = Yup.object().shape({
    name: Yup.string()
      .required(t('courses.course_name_required'))
      .max(100, 'Must be 100 characters or less'),
    description: Yup.string()
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
          await revalidateTags(['courses'], orgslug)
          toast.dismiss(toast_loading)
          toast.success(t('courses.course_created_success'))

          if (res.data.org_id === orgId) {
            closeModal()
            router.refresh()
            await revalidateTags(['courses'], orgslug)
          }
        } else {
          toast.error(res.data.detail)
        }
      } catch (error) {
        toast.error(t('courses.failed_to_create_course'))
      } finally {
        setSubmitting(false)
      }
    }
  })

  const getOrgMetadata = async () => {
    const org = await getOrganizationContextInfoWithoutCredentials(orgslug, {
      revalidate: 360,
      tags: ['organizations'],
    })
    setOrgId(org.id)
  }

  useEffect(() => {
    if (orgslug) {
      getOrgMetadata()
    }
  }, [orgslug])

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) {
      formik.setFieldValue('thumbnail', file)
    }
  }

  const handleUnsplashSelect = async (imageUrl: string) => {
    setIsUploading(true)
    try {
      const response = await fetch(imageUrl)
      const blob = await response.blob()
      const file = new File([blob], 'unsplash_image.jpg', { type: 'image/jpeg' })
      formik.setFieldValue('thumbnail', file)
    } catch (error) {
      toast.error('Failed to load image from Unsplash')
    }
    setIsUploading(false)
  }

  return (
    <FormLayout onSubmit={formik.handleSubmit} >
      <FormField name="name">
        <FormLabelAndMessage
          label={t('courses.course_name')}
          message={formik.errors.name}
        />
        <Form.Control asChild>
          <Input
            onChange={formik.handleChange}
            value={formik.values.name}
            type="text"
            required
          />
        </Form.Control>
      </FormField>

      <FormField name="description">
        <FormLabelAndMessage
          label={t('collections.description')}
          message={formik.errors.description}
        />
        <Form.Control asChild>
          <Textarea
            onChange={formik.handleChange}
            value={formik.values.description}

          />
        </Form.Control>
      </FormField>

      <FormField name="thumbnail">
        <FormLabelAndMessage
          label={t('courses.course_thumbnail')}
          message={formik.errors.thumbnail}
        />
        <div className="w-auto bg-gray-50 rounded-xl outline outline-1 outline-gray-200 h-[200px] shadow-sm">
          <div className="flex flex-col justify-center items-center h-full">
            <div className="flex flex-col justify-center items-center">
              {formik.values.thumbnail ? (
                <img
                  src={URL.createObjectURL(formik.values.thumbnail)}
                  className={`${isUploading ? 'animate-pulse' : ''} shadow-sm w-[200px] h-[100px] rounded-md`}
                />
              ) : (
                <img
                  src="/empty_thumbnail.png"
                  className="shadow-sm w-[200px] h-[100px] rounded-md bg-gray-200"
                />
              )}
              <div className="flex justify-center items-center space-x-2">
                <input
                  type="file"
                  id="fileInput"
                  style={{ display: 'none' }}
                  onChange={handleFileChange}
                  accept="image/jpeg,image/png,image/webp,image/gif"
                />
                <button
                  type="button"
                  className="font-bold antialiased items-center text-gray text-sm rounded-md px-4 mt-6 flex"
                  onClick={() => document.getElementById('fileInput')?.click()}
                >
                  <UploadCloud size={16} className="mr-2" />
                  <span>{t('courses.upload_image')}</span>
                </button>
                <button
                  type="button"
                  className="font-bold antialiased items-center text-gray text-sm rounded-md px-4 mt-6 flex"
                  onClick={() => setShowUnsplashPicker(true)}
                >
                  <ImageIcon size={16} className="mr-2" />
                  <span>{t('courses.choose_from_gallery')}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </FormField>

			<FormField name="learnings">
				<FormLabelAndMessage
					label={t('courses.course_learnings')}
					message={formik.errors.learnings}
				/>
				<FormTagInput
					placeholder={t('courses.enter_to_add')}
					value={formik.values.learnings}
					onChange={(value) => formik.setFieldValue('learnings', value)}
					error={formik.errors.learnings}
				/>
			</FormField>

			<FormField name="tags">
				<FormLabelAndMessage
					label={t('courses.course_tags')}
					message={formik.errors.tags}
				/>
				<FormTagInput
					placeholder={t('courses.enter_to_add')}
					value={formik.values.tags}
					onChange={(value) => formik.setFieldValue('tags', value)}
					error={formik.errors.tags}
				/>
			</FormField>

      <FormField name="visibility">
        <FormLabelAndMessage
          label={t('courses.course_visibility')}
          message={formik.errors.visibility}
        />
        <Select
          value={formik.values.visibility.toString()}
          onValueChange={(value) => formik.setFieldValue('visibility', value === 'true')}
        >
          <SelectTrigger>
            <SelectValue placeholder={t('courses.select_visibility')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="true">{t('courses.public')} ({t('courses.public_desc')})</SelectItem>
            <SelectItem value="false">{t('courses.private')} ({t('courses.private_desc')})</SelectItem>
          </SelectContent>
        </Select>
      </FormField>

      <div className="flex justify-end mt-6">
        <button
          type="submit"
          disabled={formik.isSubmitting}
          className="px-4 py-2 bg-black text-white text-sm font-bold rounded-md"
        >
          {formik.isSubmitting ? (
            <BarLoader
              cssOverride={{ borderRadius: 60 }}
              width={60}
              color="#ffffff"
            />
          ) : (
            t('courses.create_course_btn')
          )}
        </button>
      </div>

      {showUnsplashPicker && (
        <UnsplashImagePicker
          onSelect={handleUnsplashSelect}
          onClose={() => setShowUnsplashPicker(false)}
        />
      )}
    </FormLayout>
  )
}

export default CreateCourseModal
