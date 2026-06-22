'use client'
import { Input } from '@components/ui/input'
import { Textarea } from '@components/ui/textarea'
import FormLayout, {
  FormField,
  FormLabelAndMessage,
  ButtonBlack,
} from '@components/Objects/StyledElements/Form/Form'
import * as Form from '@radix-ui/react-form'
import { createFolder, updateFolderThumbnail } from '@services/folders/folders'
import FolderAppearance from '@components/Dashboard/Library/FolderAppearance'
import { useOrg } from '@components/Contexts/OrgContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { Globe, Lock } from 'lucide-react'
import React from 'react'
import { BarLoader } from 'react-spinners'
import toast from 'react-hot-toast'
import { useFormik } from 'formik'
import * as Yup from 'yup'
import { useTranslation } from 'react-i18next'

type Props = {
  orgslug: string
  parentFolderUuid?: string
  closeModal: () => void
  onChanged?: () => void
}

function CreateFolderModal({ parentFolderUuid, closeModal, onChanged }: Props) {
  const { t } = useTranslation()
  const org = useOrg() as any
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token

  const [color, setColor] = React.useState('violet')
  const [file, setFile] = React.useState<File | null>(null)

  const validationSchema = Yup.object().shape({
    name: Yup.string().required(t('library.folder_name_required')).max(100),
    description: Yup.string().max(1000),
    public: Yup.boolean(),
  })

  const formik = useFormik({
    initialValues: {
      name: '',
      description: '',
      public: true,
    },
    validationSchema,
    onSubmit: async (values, { setSubmitting }) => {
      const toastId = toast.loading(t('library.creating_folder'))
      try {
        const created = await createFolder(
          {
            org_id: org.id,
            name: values.name,
            description: values.description,
            public: values.public,
            color,
            ...(parentFolderUuid ? { parent_folder_uuid: parentFolderUuid } : {}),
          },
          access_token
        )
        if (file && created?.folder_uuid) {
          try {
            await updateFolderThumbnail(created.folder_uuid, file, access_token)
          } catch (e: any) {
            toast.error(e?.message || t('library.thumbnail_error'))
          }
        }
        toast.success(t('library.folder_created_success'))
        closeModal()
        onChanged?.()
      } catch (error: any) {
        toast.error(error?.message || t('library.folder_created_error'))
      } finally {
        toast.dismiss(toastId)
        setSubmitting(false)
      }
    },
  })

  return (
    <FormLayout onSubmit={formik.handleSubmit}>
      <FormField name="name">
        <FormLabelAndMessage label={t('library.folder_name')} message={formik.errors.name} />
        <Form.Control asChild>
          <Input onChange={formik.handleChange} value={formik.values.name} type="text" required />
        </Form.Control>
      </FormField>

      <FormField name="description">
        <FormLabelAndMessage label={t('library.description')} message={formik.errors.description} />
        <Form.Control asChild>
          <Textarea onChange={formik.handleChange} value={formik.values.description} />
        </Form.Control>
      </FormField>

      <FormField name="public">
        <FormLabelAndMessage label={t('library.visibility')} />
        <div className="flex gap-2 mt-1">
          <button
            type="button"
            onClick={() => formik.setFieldValue('public', true)}
            className={`flex-1 flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition-all ${
              formik.values.public
                ? 'bg-white border-indigo-200 ring-1 ring-indigo-100 text-gray-900'
                : 'bg-gray-50 border-gray-100 text-gray-500 hover:bg-gray-100'
            }`}
          >
            <Globe className="w-4 h-4" /> {t('library.public')}
          </button>
          <button
            type="button"
            onClick={() => formik.setFieldValue('public', false)}
            className={`flex-1 flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition-all ${
              !formik.values.public
                ? 'bg-white border-indigo-200 ring-1 ring-indigo-100 text-gray-900'
                : 'bg-gray-50 border-gray-100 text-gray-500 hover:bg-gray-100'
            }`}
          >
            <Lock className="w-4 h-4" /> {t('library.private')}
          </button>
        </div>
      </FormField>

      <FolderAppearance color={color} onColorChange={setColor} file={file} onFileChange={setFile} />

      <div className="flex justify-end mt-6">
        <ButtonBlack
          type="submit"
          disabled={formik.isSubmitting}
          state={formik.isSubmitting ? 'loading' : 'none'}
        >
          {formik.isSubmitting ? (
            <BarLoader cssOverride={{ borderRadius: 60 }} width={60} color="#ffffff" />
          ) : (
            t('library.create_folder')
          )}
        </ButtonBlack>
      </div>
    </FormLayout>
  )
}

export default CreateFolderModal
