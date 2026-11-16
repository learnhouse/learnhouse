'use client'
import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Formik, Form, Field } from 'formik'
import * as Yup from 'yup'
import { useTranslation } from 'react-i18next'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { createPath, removePathPrefix } from '@services/paths/paths'
import { getUriWithOrg } from '@services/config/config'
import Modal from '@components/Objects/StyledElements/Modal/Modal'
import { Globe, CircleNotch, Lock, Circuitry } from '@phosphor-icons/react'
import { useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query/keys'
import toast from 'react-hot-toast'
import { getErrorMessage } from '@services/utils/ts/errorMessage'
import { useUpgradeModal } from '@components/Dashboard/Shared/PlanRestricted/UpgradeModalContext'
import {
  BTN_PRIMARY,
  BTN_SECONDARY,
  ChoiceCard,
  FieldLabel,
  INPUT,
  TEXTAREA,
} from '@components/Dashboard/Shared/DashKit/DashKit'

interface CreatePathModalProps {
  isOpen: boolean
  onClose: () => void
  orgId: number
  orgSlug: string
}

type Values = { name: string; description: string; public: boolean }

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

  const handleSubmit = async (values: Values) => {
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
      dialogTitle={
        <span className="flex items-center gap-2">
          <Circuitry size={20} className="text-violet-500" />
          {t('paths.modals.create.title')}
        </span>
      }
      dialogDescription={t('paths.modals.create.description')}
      minWidth="sm"
      dialogContent={
        <Formik<Values>
          initialValues={{ name: '', description: '', public: true }}
          validationSchema={validationSchema}
          onSubmit={handleSubmit}
        >
          {({ isValid, dirty, values, errors, touched, setFieldValue }) => (
            <Form className="space-y-5">
              <div>
                <FieldLabel error={touched.name ? errors.name : undefined}>
                  {t('paths.form.name')} <span className="text-rose-500">*</span>
                </FieldLabel>
                <Field
                  type="text"
                  name="name"
                  autoFocus
                  aria-label={t('paths.form.name')}
                  placeholder={t('paths.form.name_placeholder')}
                  className={INPUT}
                />
              </div>

              <div>
                <FieldLabel
                  error={touched.description ? errors.description : undefined}
                  hint={`${values.description.length}/500`}
                >
                  {t('paths.form.description')}
                </FieldLabel>
                <Field
                  as="textarea"
                  name="description"
                  rows={3}
                  aria-label={t('paths.form.description')}
                  placeholder={t('paths.form.description_placeholder')}
                  className={TEXTAREA}
                />
              </div>

              <div>
                <FieldLabel>{t('paths.form.visibility')}</FieldLabel>
                <div role="radiogroup" aria-label={t('paths.form.visibility')} className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <ChoiceCard
                    selected={values.public}
                    onClick={() => setFieldValue('public', true)}
                    icon={<Globe size={18} />}
                    title={t('paths.form.public')}
                    description={t('paths.form.public_label')}
                  />
                  <ChoiceCard
                    selected={!values.public}
                    onClick={() => setFieldValue('public', false)}
                    icon={<Lock size={18} />}
                    title={t('paths.dashboard.create.private')}
                    description={t('paths.dashboard.create.private_hint')}
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-4 border-t border-neutral-100">
                <button type="button" onClick={onClose} className={BTN_SECONDARY}>
                  {t('common.cancel')}
                </button>
                <button type="submit" disabled={isSubmitting || !isValid || !dirty} className={BTN_PRIMARY}>
                  {isSubmitting && <CircleNotch size={16} className="animate-spin" />}
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
