'use client'
import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Formik, Form } from 'formik'
import toast from 'react-hot-toast'
import { useTranslation } from 'react-i18next'
import { PencilSimple } from '@phosphor-icons/react'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrg } from '@components/Contexts/OrgContext'
import { updateCommunity, Community } from '@services/communities/communities'
import { revalidateTags } from '@services/utils/ts/requests'
import { useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query/keys'
import Modal from '@components/Objects/StyledElements/Modal/Modal'
import { Button } from '@components/Dashboard/Shared/DashKit/DashKit'
import { buildCommunityValidationSchema, CommunityFormFields, type CommunityFormValues } from './CreateCommunityModal'

interface EditCommunityModalProps {
  isOpen: boolean
  onClose: () => void
  community: Community
  orgSlug: string
}

export function EditCommunityModal({ isOpen, onClose, community, orgSlug }: EditCommunityModalProps) {
  const { t } = useTranslation()
  const validationSchema = React.useMemo(() => buildCommunityValidationSchema(t), [t])
  const session = useLHSession() as any
  const org = useOrg() as any
  const router = useRouter()
  const queryClient = useQueryClient()
  const [isSubmitting, setIsSubmitting] = useState(false)

  const accessToken = session?.data?.tokens?.access_token

  const handleSubmit = async (values: CommunityFormValues) => {
    setIsSubmitting(true)
    try {
      const result = await updateCommunity(
        community.community_uuid,
        {
          name: values.name.trim(),
          description: values.description || null,
          public: values.public,
        },
        accessToken
      )

      if (result) {
        toast.success(t('dashboard.courses.communities.general.toasts.update_success'))
        await revalidateTags(['communities'], orgSlug)
        queryClient.invalidateQueries({ queryKey: queryKeys.community.list(org?.id) })
        queryClient.invalidateQueries({ queryKey: queryKeys.community.detail(community.community_uuid) })
        // The public communities page is server-rendered and relies on this.
        router.refresh()
        onClose()
      }
    } catch (err: any) {
      const message =
        (err?.detail && typeof err.detail === 'object' && err.detail.message) ||
        (typeof err?.detail === 'string' && err.detail) ||
        err?.message ||
        t('communities.edit_modal.update_failed')
      toast.error(message)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Formik<CommunityFormValues>
      initialValues={{
        name: community.name,
        description: community.description || '',
        public: community.public,
      }}
      validationSchema={validationSchema}
      onSubmit={handleSubmit}
      enableReinitialize
    >
      {({ isValid, dirty }) => (
        <Modal
          isDialogOpen={isOpen}
          onOpenChange={(open) => !open && onClose()}
          icon={<PencilSimple size={16} />}
          size="md"
          preventClose={isSubmitting}
          dialogTitle={t('communities.edit_modal.title')}
          dialogDescription={t('communities.edit_modal.description')}
          dialogContent={
            <Form id="edit-community-form">
              <CommunityFormFields />
            </Form>
          }
          footer={
            <>
              <Button onClick={onClose} disabled={isSubmitting}>
                {t('common.cancel')}
              </Button>
              <Button
                type="submit"
                form="edit-community-form"
                variant="primary"
                loading={isSubmitting}
                disabled={!isValid || !dirty}
              >
                {t('communities.edit_modal.save_changes')}
              </Button>
            </>
          }
        />
      )}
    </Formik>
  )
}

export default EditCommunityModal
