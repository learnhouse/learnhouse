'use client'
import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useFormik } from 'formik'
import * as Yup from 'yup'
import { useTranslation } from 'react-i18next'
import { Globe, Headphones, Lock } from '@phosphor-icons/react'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { createPodcast, removePodcastPrefix } from '@services/podcasts/podcasts'
import { useLHAnalytics, AnalyticsEvent } from '@services/analytics'
import { revalidateTags } from '@services/utils/ts/requests'
import Modal from '@components/Objects/StyledElements/Modal/Modal'
import { Button, ChoiceCard, FieldLabel, INPUT, TEXTAREA } from '@components/Dashboard/Shared/DashKit/DashKit'
import { useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query/keys'
import toast from 'react-hot-toast'
import { getErrorMessage } from '@services/utils/ts/errorMessage'
import { getUriWithOrg } from '@services/config/config'
import { useUpgradeModal } from '@components/Dashboard/Shared/PlanRestricted/UpgradeModalContext'

interface CreatePodcastModalProps {
  isOpen: boolean
  onClose: () => void
  orgId: number
  orgSlug: string
}

const FORM_ID = 'create-podcast-form'

export function CreatePodcastModal({ isOpen, onClose, orgId, orgSlug }: CreatePodcastModalProps) {
  const { t } = useTranslation()
  const session = useLHSession() as any
  const router = useRouter()
  const queryClient = useQueryClient()
  const { track } = useLHAnalytics('learner')
  const { handlePlanLimit } = useUpgradeModal()
  const [isSubmitting, setIsSubmitting] = useState(false)

  const accessToken = session?.data?.tokens?.access_token

  const formik = useFormik({
    initialValues: { name: '', description: '', public: true },
    validationSchema: Yup.object({
      name: Yup.string()
        .trim()
        .required(t('podcasts.form.name_required'))
        .min(3, t('podcasts.form.name_min_length'))
        .max(100, t('podcasts.form.name_max_length')),
      description: Yup.string().max(500, t('podcasts.form.description_max_length')),
      public: Yup.boolean(),
    }),
    onSubmit: async (values) => {
      setIsSubmitting(true)
      try {
        const result = await createPodcast(
          String(orgId),
          { name: values.name.trim(), description: values.description || '', public: values.public },
          null,
          accessToken
        )

        // getResponseMetadata() always resolves (never throws on HTTP error), so
        // gate on result.success. Previously `if (result)` treated a 403 limit
        // failure as success and silently closed the modal.
        if (result?.success) {
          track(AnalyticsEvent.PodcastCreated, {
            is_public: values.public,
            has_thumbnail: false,
            source: 'quick_modal',
          })
          await revalidateTags(['podcasts'], orgSlug)
          queryClient.invalidateQueries({ queryKey: queryKeys.podcasts.list(orgSlug) })
          toast.success(t('podcasts.podcast_created_success'))
          close()
          // Straight to the episodes tab: adding audio is the next step.
          const uuid = result.data?.podcast_uuid
          if (uuid) router.push(getUriWithOrg(orgSlug, `/dash/podcasts/podcast/${removePodcastPrefix(uuid)}/content`))
          else router.refresh()
        } else if (handlePlanLimit(result, { source: 'podcast_create', feature: 'podcasts', requiredPlan: 'standard' })) {
          close()
        } else {
          toast.error(getErrorMessage(result?.data?.detail, t('podcasts.failed_to_create_podcast')))
        }
      } catch (error) {
        console.error('Failed to create podcast:', error)
        toast.error(t('podcasts.failed_to_create_podcast'))
      } finally {
        setIsSubmitting(false)
      }
    },
  })

  const close = () => {
    formik.resetForm()
    onClose()
  }

  const fieldError = (field: 'name' | 'description') =>
    formik.touched[field] || formik.submitCount ? (formik.errors[field] as string | undefined) : undefined

  return (
    <Modal
      isDialogOpen={isOpen}
      onOpenChange={(open) => !open && close()}
      icon={<Headphones size={16} />}
      dialogTitle={t('podcasts.modals.create.title')}
      dialogDescription={t('podcasts.modals.create.description')}
      size="md"
      preventClose={isSubmitting}
      footer={
        <>
          <Button onClick={close} disabled={isSubmitting}>
            {t('podcasts.modals.create.cancel')}
          </Button>
          <Button
            type="submit"
            form={FORM_ID}
            variant="primary"
            loading={isSubmitting}
            disabled={!formik.values.name.trim()}
          >
            {t('podcasts.modals.create.submit')}
          </Button>
        </>
      }
      dialogContent={
        <form id={FORM_ID} onSubmit={formik.handleSubmit} className="space-y-5">
          <div>
            <FieldLabel error={fieldError('name')}>{t('podcasts.modals.create.form.name_label')}</FieldLabel>
            <input
              name="name"
              autoFocus
              aria-label={t('podcasts.modals.create.form.name_label')}
              value={formik.values.name}
              onChange={formik.handleChange}
              onBlur={formik.handleBlur}
              placeholder={t('podcasts.modals.create.form.name_placeholder')}
              className={INPUT}
              dir="auto"
            />
          </div>

          <div>
            <FieldLabel error={fieldError('description')} hint={`${formik.values.description.length}/500`}>
              {t('podcasts.modals.create.form.description_label')}
            </FieldLabel>
            <textarea
              name="description"
              aria-label={t('podcasts.modals.create.form.description_label')}
              value={formik.values.description}
              onChange={formik.handleChange}
              onBlur={formik.handleBlur}
              rows={3}
              placeholder={t('podcasts.modals.create.form.description_placeholder')}
              className={TEXTAREA}
              dir="auto"
            />
          </div>

          <div>
            <FieldLabel>{t('podcasts.dashboard.form.visibility')}</FieldLabel>
            <div role="radiogroup" className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <ChoiceCard
                selected={formik.values.public}
                onClick={() => formik.setFieldValue('public', true)}
                icon={<Globe size={16} />}
                title={t('podcasts.public')}
                description={t('podcasts.dashboard.form.public_hint')}
              />
              <ChoiceCard
                selected={!formik.values.public}
                onClick={() => formik.setFieldValue('public', false)}
                icon={<Lock size={16} />}
                title={t('podcasts.private')}
                description={t('podcasts.dashboard.form.private_hint')}
              />
            </div>
            <p className="mt-2 text-xs text-neutral-500">{t('podcasts.modals.create.draft_hint')}</p>
          </div>
        </form>
      }
    />
  )
}

export default CreatePodcastModal
