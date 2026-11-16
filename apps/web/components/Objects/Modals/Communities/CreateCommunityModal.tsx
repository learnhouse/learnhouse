'use client'
import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Formik, Form, Field, useFormikContext } from 'formik'
import * as Yup from 'yup'
import { useTranslation } from 'react-i18next'
import toast from 'react-hot-toast'
import { Garage, Globe, Lock } from '@phosphor-icons/react'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { createCommunity } from '@services/communities/communities'
import { revalidateTags } from '@services/utils/ts/requests'
import { useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query/keys'
import Modal from '@components/Objects/StyledElements/Modal/Modal'
import { Button, ChoiceCard, FieldLabel, INPUT, TEXTAREA } from '@components/Dashboard/Shared/DashKit/DashKit'
import { useLHAnalytics, AnalyticsEvent } from '@services/analytics'
import { getErrorMessage } from '@services/utils/ts/errorMessage'
import { useUpgradeModal } from '@components/Dashboard/Shared/PlanRestricted/UpgradeModalContext'

interface CreateCommunityModalProps {
  isOpen: boolean
  onClose: () => void
  orgId: number
  orgSlug: string
}

export type CommunityFormValues = { name: string; description: string; public: boolean }

export const buildCommunityValidationSchema = (t: (_key: string) => string) =>
  Yup.object({
    name: Yup.string()
      .trim()
      .required(t('dashboard.courses.communities.general.form.name_required'))
      .min(3, t('dashboard.courses.communities.general.form.name_min_length'))
      .max(100, t('dashboard.courses.communities.general.form.name_max_length')),
    description: Yup.string().max(500, t('dashboard.courses.communities.general.form.description_max_length')),
    public: Yup.boolean(),
  })

// Name, description and visibility: the fields shared by the create and
// quick-edit dialogs. Must render inside a Formik form.
export function CommunityFormFields({ autoFocus }: { autoFocus?: boolean }) {
  const { t } = useTranslation()
  const { values, errors, touched, setFieldValue } = useFormikContext<CommunityFormValues>()
  return (
    <div className="flex flex-col gap-5">
      <div>
        <FieldLabel
          error={touched.name ? (errors.name as string | undefined) : undefined}
          hint={`${values.name.length}/100`}
        >
          {t('dashboard.courses.communities.general.form.name_label')}
        </FieldLabel>
        <Field
          id="community-name"
          name="name"
          aria-label={t('dashboard.courses.communities.general.form.name_label')}
          type="text"
          autoFocus={autoFocus}
          maxLength={100}
          placeholder={t('dashboard.courses.communities.general.form.name_placeholder')}
          className={INPUT}
        />
      </div>
      <div>
        <FieldLabel
          error={touched.description ? (errors.description as string | undefined) : undefined}
          hint={`${values.description.length}/500`}
        >
          {t('dashboard.courses.communities.general.form.description_label')}
        </FieldLabel>
        <Field
          as="textarea"
          id="community-description"
          name="description"
          aria-label={t('dashboard.courses.communities.general.form.description_label')}
          rows={3}
          maxLength={500}
          placeholder={t('dashboard.courses.communities.general.form.description_placeholder')}
          className={TEXTAREA}
        />
        <p className="mt-1.5 text-xs text-neutral-400">{t('communities.dash.form.description_hint')}</p>
      </div>
      <div>
        <FieldLabel>{t('communities.dash.form.visibility')}</FieldLabel>
        <div role="radiogroup" className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <ChoiceCard
            selected={values.public}
            onClick={() => setFieldValue('public', true)}
            icon={<Globe size={18} />}
            title={t('communities.public')}
            description={t('communities.dash.form.public_hint')}
          />
          <ChoiceCard
            selected={!values.public}
            onClick={() => setFieldValue('public', false)}
            icon={<Lock size={18} />}
            title={t('communities.private')}
            description={t('communities.dash.form.private_hint')}
          />
        </div>
      </div>
    </div>
  )
}

export function CreateCommunityModal({ isOpen, onClose, orgId, orgSlug }: CreateCommunityModalProps) {
  const { t } = useTranslation()
  const session = useLHSession() as any
  const router = useRouter()
  const queryClient = useQueryClient()
  const { track } = useLHAnalytics('learner')
  const { handlePlanLimit } = useUpgradeModal()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const validationSchema = React.useMemo(() => buildCommunityValidationSchema(t), [t])

  const accessToken = session?.data?.tokens?.access_token

  const handleSubmit = async (values: CommunityFormValues) => {
    setIsSubmitting(true)
    try {
      const result = await createCommunity(
        orgId,
        {
          name: values.name.trim(),
          description: values.description || null,
          public: values.public,
        },
        accessToken
      )

      // getResponseMetadata() always resolves (never throws on HTTP error), so
      // gate on result.success. Previously `if (result)` treated a 403 limit
      // failure as success and closed the modal without creating anything.
      if (result?.success) {
        track(AnalyticsEvent.CommunityCreated, {
          is_public: values.public,
          has_description: !!values.description,
        })
        toast.success(t('dashboard.courses.communities.toasts.create_success'))
        await revalidateTags(['communities'], orgSlug)
        queryClient.invalidateQueries({ queryKey: queryKeys.community.list(orgId) })
        // The public communities page is server-rendered and relies on this.
        router.refresh()
        onClose()
      } else if (handlePlanLimit(result, { source: 'community_create', feature: 'communities', requiredPlan: 'standard' })) {
        onClose()
      } else {
        toast.error(getErrorMessage(result?.data?.detail, t('communities.create_failed')))
      }
    } catch (err: any) {
      const message =
        (err?.detail && typeof err.detail === 'object' && err.detail.message) ||
        (typeof err?.detail === 'string' && err.detail) ||
        err?.message ||
        t('communities.create_failed')
      toast.error(message)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    // Keyed on open so every opening starts from a blank form.
    <Formik<CommunityFormValues>
      key={isOpen ? 'open' : 'closed'}
      initialValues={{ name: '', description: '', public: true }}
      validationSchema={validationSchema}
      onSubmit={handleSubmit}
    >
      {({ isValid, dirty }) => (
        <Modal
          isDialogOpen={isOpen}
          onOpenChange={(open) => !open && onClose()}
          icon={<Garage size={16} />}
          size="md"
          preventClose={isSubmitting}
          dialogTitle={t('dashboard.courses.communities.modals.create.title')}
          dialogDescription={t('dashboard.courses.communities.modals.create.description')}
          dialogContent={
            <Form id="create-community-form">
              <CommunityFormFields autoFocus />
            </Form>
          }
          footer={
            <>
              <Button onClick={onClose} disabled={isSubmitting}>
                {t('dashboard.courses.communities.modals.create.cancel')}
              </Button>
              <Button
                type="submit"
                form="create-community-form"
                variant="primary"
                loading={isSubmitting}
                disabled={!isValid || !dirty}
              >
                {t('dashboard.courses.communities.modals.create.submit')}
              </Button>
            </>
          }
        />
      )}
    </Formik>
  )
}

export default CreateCommunityModal
