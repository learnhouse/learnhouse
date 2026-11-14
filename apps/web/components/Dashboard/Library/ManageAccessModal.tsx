'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { Lock } from '@phosphor-icons/react'
import Modal from '@components/Objects/StyledElements/Modal/Modal'
import { Button } from '@components/Dashboard/Shared/DashKit/DashKit'
import ManageAccessPopover from '@components/Dashboard/Library/ManageAccessPopover'

// "Manage access" dialog for library resources. Every change inside saves on
// its own (with a confirm), so the footer only closes.
export default function ManageAccessModal({
  open,
  onOpenChange,
  resource_uuid,
  resourceType,
  orgslug,
  name,
}: {
  open: boolean
  onOpenChange: (_open: boolean) => void
  resource_uuid: string
  resourceType: 'folders' | 'courses' | 'media'
  orgslug: string
  name?: string
}) {
  const { t } = useTranslation()
  return (
    <Modal
      isDialogOpen={open}
      onOpenChange={onOpenChange}
      size="md"
      icon={<Lock size={16} />}
      dialogTitle={t('library.manage_access')}
      dialogDescription={name || t('library.dash.manage_access_description')}
      footer={
        <Button variant="secondary" onClick={() => onOpenChange(false)}>
          {t('common.close')}
        </Button>
      }
      dialogContent={
        open ? <ManageAccessPopover resource_uuid={resource_uuid} resourceType={resourceType} orgslug={orgslug} /> : null
      }
    />
  )
}
