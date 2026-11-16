// OSS stub: people data (manager, department, title) comes with Enterprise Edition.
const OFF = { enabled: false, departments: [] as string[], managers: [] as { id: number; name: string }[], isManager: false }

export function usePeopleData() {
  return OFF
}

export function PeopleImportDialog(_props: { open: boolean; onClose: () => void }) {
  return null
}

export function BulkPeopleActions(_props: { userIds: number[]; onDone?: () => void }) {
  return null
}
