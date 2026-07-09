import { getAPIUrl } from '@services/config/config'
import {
  RequestBodyFormWithAuthHeader,
  RequestBodyWithAuthHeader,
  apiFetch,
  getResponseMetadata,
} from '@services/utils/ts/requests'

// Types

export interface OrgApp {
  id: number
  app_uuid: string
  org_id: number
  slug: string
  name: string
  description: string | null
  version: string
  icon_path: string | null
  status: 'pending' | 'installed'
  enabled: boolean
  creation_date: string
  update_date: string
}

export interface OrgAppAdmin extends OrgApp {
  manifest: Record<string, any>
  approved_scopes: Record<string, Record<string, boolean>> | null
  requested_scopes: string[]
  created_by_user_id: number
}

export interface OrgAppSession {
  token: string
  expires_at: string
  iframe_url: string
  app: OrgApp
}

// Human-readable labels for the scope-approval screen
export const SCOPE_LABELS: Record<string, string> = {
  courses: 'Courses',
  activities: 'Activities',
  coursechapters: 'Course chapters',
  folders: 'Folders',
  media: 'Media library',
  certifications: 'Certifications',
  usergroups: 'User groups',
  payments: 'Payments',
  search: 'Search',
  assignments: 'Assignments',
}

export function describeScope(scope: string): string {
  const [bucket, action] = scope.split(':')
  const label = SCOPE_LABELS[bucket] ?? bucket
  return action === 'write'
    ? `Create, update and delete ${label.toLowerCase()}`
    : `Read ${label.toLowerCase()}`
}

/**
 * List an organization's apps. Admins receive all apps (with manifests and
 * scopes); members only receive installed, enabled apps.
 */
export async function listOrgApps(
  orgId: number,
  accessToken: string
): Promise<OrgAppAdmin[]> {
  const url = `${getAPIUrl()}orgs/${orgId}/apps`
  return apiFetch(url, accessToken)
}

/**
 * Upload an app package (zip). Returns the pending app with its requested
 * scopes so the admin can review and approve them.
 */
export async function uploadAppPackage(
  orgId: number,
  file: File,
  accessToken: string
) {
  const formData = new FormData()
  formData.append('app_package', file)
  const result = await fetch(
    `${getAPIUrl()}orgs/${orgId}/apps`,
    RequestBodyFormWithAuthHeader('POST', formData, null, accessToken)
  )
  return getResponseMetadata(result)
}

/**
 * Approve a pending app's scopes and activate it. `scopes` must be a subset
 * of the app's requested scopes (the server re-validates).
 */
export async function approveOrgApp(
  orgId: number,
  appUuid: string,
  scopes: string[],
  accessToken: string
) {
  const result = await fetch(
    `${getAPIUrl()}orgs/${orgId}/apps/${appUuid}/approve`,
    RequestBodyWithAuthHeader('POST', { scopes }, null, accessToken)
  )
  return getResponseMetadata(result)
}

/**
 * Enable or disable an installed app.
 */
export async function setOrgAppEnabled(
  orgId: number,
  appUuid: string,
  enabled: boolean,
  accessToken: string
) {
  const result = await fetch(
    `${getAPIUrl()}orgs/${orgId}/apps/${appUuid}`,
    RequestBodyWithAuthHeader('PATCH', { enabled }, null, accessToken)
  )
  return getResponseMetadata(result)
}

/**
 * Uninstall an app and delete its stored bundle.
 */
export async function uninstallOrgApp(
  orgId: number,
  appUuid: string,
  accessToken: string
) {
  const result = await fetch(
    `${getAPIUrl()}orgs/${orgId}/apps/${appUuid}`,
    RequestBodyWithAuthHeader('DELETE', null, null, accessToken)
  )
  return getResponseMetadata(result)
}

/**
 * Mint an app session: the short-lived token the AppRunner host keeps in
 * memory (never handed to app code) plus the signed iframe URL.
 */
export async function createAppSession(
  orgId: number,
  appUuid: string,
  accessToken: string
): Promise<OrgAppSession> {
  const result = await fetch(
    `${getAPIUrl()}orgs/${orgId}/apps/${appUuid}/session`,
    RequestBodyWithAuthHeader('POST', null, null, accessToken)
  )
  const res = await getResponseMetadata(result)
  if (res.status !== 200) {
    throw new Error(res.data?.detail ?? 'Failed to start app session')
  }
  return res.data as OrgAppSession
}
