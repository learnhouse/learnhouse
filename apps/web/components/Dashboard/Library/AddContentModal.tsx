'use client'
import React from 'react'
import ResourcePicker from './ResourcePicker'

type Props = {
  folderUuid?: string
  orgslug: string
  closeModal: () => void
  onChanged?: () => void
}

function AddContentModal({ folderUuid, orgslug, onChanged }: Props) {
  return (
    <ResourcePicker
      mode="add"
      orgslug={orgslug}
      folderUuid={folderUuid}
      onChanged={onChanged}
    />
  )
}

export default AddContentModal
