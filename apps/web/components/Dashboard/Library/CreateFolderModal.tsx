'use client'
import FolderDialog from '@components/Dashboard/Library/FolderDialog'

type Props = {
  open: boolean
  onOpenChange: (_open: boolean) => void
  orgslug: string
  parentFolderUuid?: string
  onChanged?: () => void
}

function CreateFolderModal({ open, onOpenChange, parentFolderUuid, onChanged }: Props) {
  return (
    <FolderDialog
      mode="create"
      open={open}
      onOpenChange={onOpenChange}
      parentFolderUuid={parentFolderUuid}
      onChanged={onChanged}
    />
  )
}

export default CreateFolderModal
