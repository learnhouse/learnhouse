import { getAPIUrl } from '../config/config'
import { apiFetch } from '../utils/ts/requests'
import type { AuditEntry } from '@components/Dashboard/Pages/Org/OrgAuditLogs/auditFormat'

export type AuditFilters = {
  q?: string
  category?: string
  action?: string
  target_type?: string
  target_id?: string
  outcome?: string
  via?: string
  actor_id?: number | string
  request_id?: string
  start_date?: string
  end_date?: string
}

export type AuditPage = { items: AuditEntry[]; total: number; limit: number; offset: number }
export type AuditDetail = { entry: AuditEntry; related: AuditEntry[] }
export type AuditActor = {
  id: number
  name?: string | null
  email?: string | null
  username?: string | null
  avatar_url?: string | null
  user_uuid?: string | null
}
export type AuditFacets = {
  actors: AuditActor[]
  categories: string[]
  target_types: string[]
  actions: string[]
  vias: string[]
  outcomes: string[]
}
export type AuditSettings = {
  retention_days: number
  default_retention_days: number
  max_retention_days: number
  choices: number[]
}

const base = () => `${getAPIUrl()}ee/audit_logs`

/** Query string for the list and the export (empty filters are left out). */
export function auditQuery(orgId: number, filters: AuditFilters = {}, extra: Record<string, string | number> = {}) {
  const params = new URLSearchParams()
  params.set('org_id', String(orgId))
  for (const [key, value] of Object.entries({ ...filters, ...extra })) {
    if (value === undefined || value === null || value === '' || value === 'all') continue
    params.set(key, String(value))
  }
  return params.toString()
}

export const getAuditLogs = (orgId: number, token: string, filters: AuditFilters = {}, offset = 0, limit = 25): Promise<AuditPage> =>
  apiFetch(`${base()}/?${auditQuery(orgId, filters, { offset, limit })}`, token)

export const getAuditLogEntry = (orgId: number, token: string, id: number): Promise<AuditDetail> =>
  apiFetch(`${base()}/entries/${id}?org_id=${orgId}`, token)

export const getAuditFacets = (orgId: number, token: string): Promise<AuditFacets> =>
  apiFetch(`${base()}/facets?org_id=${orgId}`, token)

export const getAuditSettings = (orgId: number, token: string): Promise<AuditSettings> =>
  apiFetch(`${base()}/settings?org_id=${orgId}`, token)

export async function updateAuditSettings(orgId: number, token: string, retention_days: number): Promise<AuditSettings> {
  const res = await fetch(`${base()}/settings?org_id=${orgId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    credentials: 'include',
    body: JSON.stringify({ retention_days }),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

/** Download the filtered log as CSV or JSON. */
export async function exportAuditLogs(orgId: number, token: string, filters: AuditFilters, format: 'csv' | 'json') {
  const res = await fetch(`${base()}/export?${auditQuery(orgId, filters, { format })}`, {
    headers: { Authorization: `Bearer ${token}` },
    credentials: 'include',
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const blob = await res.blob()
  const url = window.URL.createObjectURL(blob)
  const a = document.createElement('a')
  const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '')
  a.href = url
  a.download = `audit_logs_${stamp}.${format}`
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.URL.revokeObjectURL(url)
}

export const getEEStatus = async (accessToken: string) => apiFetch(`${getAPIUrl()}ee/status`, accessToken)
