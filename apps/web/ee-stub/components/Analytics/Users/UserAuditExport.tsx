// OSS stub: per-user analytics exports require Enterprise Edition.
export type Fmt = 'csv' | 'json' | 'pdf'

export function useAuditExport(_props: { userIds: number[]; days?: number; defaultDossier?: any }) {
  return { run: async (_fmt: Fmt, _includeRaw?: boolean) => {}, busy: false, disabled: true }
}

export default function UserAuditExport(_props: {
  userIds: number[]
  days?: number
  defaultDossier?: any
  label?: string
}) {
  return null
}
