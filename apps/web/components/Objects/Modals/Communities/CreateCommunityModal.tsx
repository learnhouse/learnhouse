'use client'
import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Formik, Form, Field, ErrorMessage } from 'formik'
import * as Yup from 'yup'
import { useTranslation } from 'react-i18next'
import toast from 'react-hot-toast'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrg } from '@components/Contexts/OrgContext'
import { createCommunity } from '@services/communities/communities'
import { revalidateTags } from '@services/utils/ts/requests'
import Modal from '@components/Objects/StyledElements/Modal/Modal'
import { Loader2 } from 'lucide-react'

interface CreateCommunityModalProps {
  isOpen: boolean
  onClose: () => void
  orgId: number
  orgSlug: string
}

export function CreateCommunityModal({
  isOpen,
  onClose,
  orgId,
  orgSlug,
}: CreateCommunityModalProps) {
  const { t } = useTranslation()
  const session = useLHSession() as any
  const router = useRouter()
  const [isSubmitting, setIsSubmitting] = useState(false)

  const accessToken = session?.data?.tokens?.access_token

  const validationSchema = Yup.object({
    name: Yup.string()
      .required(t('dashboard.courses.communities.general.form.name_required'))
      .min(3, t('dashboard.courses.communities.general.form.name_min_length'))
      .max(100, t('dashboard.courses.communities.general.form.name_max_length')),
    description: Yup.string()
      .max(500, t('dashboard.courses.communities.general.form.description_max_length')),
    public: Yup.boolean(),
  })

  const handleSubmit = async (values: any) => {
    setIsSubmitting(true)
    try {
      const result = await createCommunity(
        orgId,
        {
          name: values.name,
          description: values.description || null,
          public: values.public,
        },
        accessToken
      )

      if (result) {
        await revalidateTags(['communities'], orgSlug)
        router.refresh()
        onClose()
      }
    } catch (err: any) {
      const message =
        (err?.detail && typeof err.detail === 'object' && err.detail.message) ||
        (typeof err?.detail === 'string' && err.detail) ||
        err?.message ||
        'Failed to create community.'
      toast.error(message)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Modal
      isDialogOpen={isOpen}
      onOpenChange={(open) => !open && onClose()}
      dialogTitle={t('dashboard.courses.communities.modals.create.title')}
      dialogDescription={t('dashboard.courses.communities.modals.create.description')}
      minWidth="sm"
      dialogContent={
        <Formik
          initialValues={{
            name: '',
            description: '',
            public: true,
          }}
          validationSchema={validationSchema}
          onSubmit={handleSubmit}
        >
          {({ isValid, dirty }) => (
            <Form className="space-y-6">
              {/* Name */}
              <div>
                <label
                  htmlFor="name"
                  className="block text-sm font-medium text-gray-700 mb-1"
                >
                  {t('dashboard.courses.communities.modals.create.form.name_label')} *
                </label>
                <Field
                  type="text"
                  name="name"
                  id="name"
                  placeholder={t('dashboard.courses.communities.modals.create.form.name_placeholder')}
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-black/20 focus:border-transparent outline-none transition-all"
                />
                <ErrorMessage
                  name="name"
                  component="p"
                  className="mt-1 text-sm text-red-500"
                />
              </div>

              {/* Description */}
              <div>
                <label
                  htmlFor="description"
                  className="block text-sm font-medium text-gray-700 mb-1"
                >
                  {t('dashboard.courses.communities.modals.create.form.description_label')}
                </label>
                <Field
                  as="textarea"
                  name="description"
                  id="description"
                  rows={3}
                  placeholder={t('dashboard.courses.communities.modals.create.form.description_placeholder')}
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-black/20 focus:border-transparent outline-none transition-all resize-none"
                />
                <ErrorMessage
                  name="description"
                  component="p"
                  className="mt-1 text-sm text-red-500"
                />
              </div>

              {/* Public Toggle */}
              <div className="flex items-center gap-3">
                <Field
                  type="checkbox"
                  name="public"
                  id="public"
                  className="w-4 h-4 text-black rounded border-gray-300 focus:ring-black/20"
                />
                <label
                  htmlFor="public"
                  className="text-sm text-gray-700"
                >
                  {t('dashboard.courses.communities.modals.create.form.public_label')}
                </label>
              </div>

              {/* Actions */}
              <div className="flex justify-end gap-3 pt-4 border-t border-gray-100">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  {t('dashboard.courses.communities.modals.create.cancel')}
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting || !isValid || !dirty}
                  className="px-4 py-2 text-sm font-medium text-white bg-black hover:bg-black/90 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  {isSubmitting && <Loader2 size={16} className="animate-spin" />}
                  {t('dashboard.courses.communities.modals.create.submit')}
                </button>
              </div>
            </Form>
          )}
        </Formik>
      }
    />
  )
}

export default CreateCommunityModal
