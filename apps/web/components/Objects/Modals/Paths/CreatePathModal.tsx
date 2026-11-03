'use client'
import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Formik, Form, Field, ErrorMessage } from 'formik'
import * as Yup from 'yup'
import { useTranslation } from 'react-i18next'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { createPath, removePathPrefix } from '@services/paths/paths'
import { getUriWithOrg } from '@services/config/config'
import Modal from '@components/Objects/StyledElements/Modal/Modal'
import { Loader2 } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query/keys'
import toast from 'react-hot-toast'
import { getErrorMessage } from '@services/utils/ts/errorMessage'
import { useUpgradeModal } from '@components/Dashboard/Shared/PlanRestricted/UpgradeModalContext'

interface CreatePathModalProps {
  isOpen: boolean
  onClose: () => void
  orgId: number
  orgSlug: string
}

export function CreatePathModal({ isOpen, onClose, orgId, orgSlug }: CreatePathModalProps) {
  const { t } = useTranslation()
  const session = useLHSession() as any
  const router = useRouter()
  const queryClient = useQueryClient()
  const { handlePlanLimit } = useUpgradeModal()
  const [isSubmitting, setIsSubmitting] = useState(false)

  const accessToken = session?.data?.tokens?.access_token

  const validationSchema = Yup.object({
    name: Yup.string()
      .trim()
      .required(t('paths.form.name_required'))
      .max(200, t('paths.form.name_max_length')),
    description: Yup.string().max(500, t('paths.form.description_max_length')),
    public: Yup.boolean(),
  })

  const handleSubmit = async (values: { name: string; description: string; public: boolean }) => {
    setIsSubmitting(true)
    try {
      const result = await createPath(
        orgId,
        { name: values.name.trim(), description: values.description, public: values.public },
        accessToken
      )
      if (result?.success) {
        queryClient.invalidateQueries({ queryKey: queryKeys.paths.list(orgId) })
        onClose()
        // Courses are the first thing a new path needs.
        router.push(
          getUriWithOrg(orgSlug, `/dash/paths/path/${removePathPrefix(result.data.path_uuid)}/courses`)
        )
      } else if (handlePlanLimit(result, { source: 'path_create', feature: 'paths', requiredPlan: 'pro' })) {
        onClose()
      } else {
        toast.error(getErrorMessage(result?.data?.detail, t('paths.toasts.create_error')))
      }
    } catch {
      toast.error(t('paths.toasts.create_error'))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Modal
      isDialogOpen={isOpen}
      onOpenChange={(open) => !open && onClose()}
      dialogTitle={t('paths.modals.create.title')}
      dialogDescription={t('paths.modals.create.description')}
      minWidth="sm"
      dialogContent={
        <Formik
          initialValues={{ name: '', description: '', public: true }}
          validationSchema={validationSchema}
          onSubmit={handleSubmit}
        >
          {({ isValid, dirty }) => (
            <Form className="space-y-6">
              <div>
                <label htmlFor="path-name" className="block text-sm font-medium text-gray-700 mb-1">
                  {t('paths.form.name')} *
                </label>
                <Field
                  type="text"
                  name="name"
                  id="path-name"
                  placeholder={t('paths.form.name_placeholder')}
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-black/20 focus:border-transparent outline-none transition-all"
                />
                <ErrorMessage name="name" component="p" className="mt-1 text-sm text-red-500" />
              </div>

              <div>
                <label htmlFor="path-description" className="block text-sm font-medium text-gray-700 mb-1">
                  {t('paths.form.description')}
                </label>
                <Field
                  as="textarea"
                  name="description"
                  id="path-description"
                  rows={3}
                  placeholder={t('paths.form.description_placeholder')}
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-black/20 focus:border-transparent outline-none transition-all resize-none"
                />
                <ErrorMessage name="description" component="p" className="mt-1 text-sm text-red-500" />
              </div>

              <div className="flex items-center gap-3">
                <Field
                  type="checkbox"
                  name="public"
                  id="path-public"
                  className="w-4 h-4 text-black rounded border-gray-300 focus:ring-black/20"
                />
                <label htmlFor="path-public" className="text-sm text-gray-700">
                  {t('paths.form.public_label')}
                </label>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-gray-100">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  {t('common.cancel')}
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting || !isValid || !dirty}
                  className="px-4 py-2 text-sm font-medium text-white bg-black hover:bg-black/90 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  {isSubmitting && <Loader2 size={16} className="animate-spin" />}
                  {t('paths.modals.create.submit')}
                </button>
              </div>
            </Form>
          )}
        </Formik>
      }
    />
  )
}

export default CreatePathModal
