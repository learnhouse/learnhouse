'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { Plus } from '@phosphor-icons/react'
import Modal from '@components/Objects/StyledElements/Modal/Modal'
import { Button } from '@components/Dashboard/Shared/DashKit/DashKit'
import ResourcePicker from './ResourcePicker'

type Props = {
  open: boolean
  onOpenChange: (_open: boolean) => void
  folderUuid?: string
  orgslug: string
  onChanged?: () => void
}

// Adds are saved one by one as they're clicked, so the footer only closes.
function AddContentModal({ open, onOpenChange, folderUuid, orgslug, onChanged }: Props) {
  const { t } = useTranslation()
  return (
    <Modal
      isDialogOpen={open}
      onOpenChange={onOpenChange}
      size="lg"
      icon={<Plus size={16} />}
      dialogTitle={t('library.add_content')}
      dialogDescription={folderUuid ? t('library.dash.add_content_description_folder') : t('library.dash.add_content_description')}
      footer={
        <Button variant="primary" onClick={() => onOpenChange(false)}>
          {t('library.dash.done')}
        </Button>
      }
      dialogContent={open ? <ResourcePicker mode="add" orgslug={orgslug} folderUuid={folderUuid} onChanged={onChanged} /> : null}
    />
  )
}

export default AddContentModal
