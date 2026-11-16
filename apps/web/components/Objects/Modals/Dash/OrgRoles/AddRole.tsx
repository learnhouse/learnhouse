'use client'
import RoleEditorModal from './RoleEditorModal'

// "New role" dialog. Kept as its own entry point; the form is shared with
// EditRole in RoleEditorModal.
export default function AddRole({ open, onOpenChange }: { open: boolean; onOpenChange: (_open: boolean) => void }) {
    return <RoleEditorModal open={open} onOpenChange={onOpenChange} />
}
