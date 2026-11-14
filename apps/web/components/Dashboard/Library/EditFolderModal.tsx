'use client'
import FolderDialog from '@components/Dashboard/Library/FolderDialog'

type Props = {
  open: boolean
  onOpenChange: (_open: boolean) => void
  folder: any
  orgslug: string
  onChanged?: () => void
}

function EditFolderModal({ open, onOpenChange, folder, onChanged }: Props) {
  return <FolderDialog mode="edit" open={open} onOpenChange={onOpenChange} folder={folder} onChanged={onChanged} />
}

export default EditFolderModal
