'use client'
import RoleEditorModal, { EditableRole } from './RoleEditorModal'

// "Edit role" dialog; shares its form with AddRole in RoleEditorModal.
export default function EditRole({
    role,
    open,
    onOpenChange,
}: {
    role: EditableRole | null
    open: boolean
    onOpenChange: (_open: boolean) => void
}) {
    return <RoleEditorModal open={open} onOpenChange={onOpenChange} role={role} />
}
