import { getAPIUrl } from '@services/config/config'
import {
  RequestBodyWithAuthHeader,
  getResponseMetadata,
} from '@services/utils/ts/requests'

// Connecting AI apps (Claude, ChatGPT, Cursor, ...) to LearnHouse over MCP.
// The API is its own OAuth server: the app sends the member to
// /oauth/consent with a signed `request`, the member picks an organization and
// approves, and the API hands back the URL to return to.

export interface MCPConsentOrg {
  id: number
  org_uuid: string
  slug: string
  name: string
  logo_image: string | null
  mcp_enabled: boolean
  can_admin: boolean
}

export interface MCPConsentRequest {
  client: {
    name: string
    uri: string | null
    logo_uri: string | null
    redirect_host: string
  }
  scopes: string[]
  orgs: MCPConsentOrg[]
  user: { username: string; email: string }
}

export interface MCPConnection {
  grant_uuid: string
  client_name: string
  client_uri: string | null
  logo_uri: string | null
  scopes: string[]
  created_at: number
  last_used_at: number | null
  user: {
    user_uuid: string
    username: string
    first_name: string | null
    last_name: string | null
    avatar_image: string | null
  }
}

export interface MCPSettings {
  enabled: boolean
  server_enabled: boolean
  mcp_url: string
}

export const MCP_SCOPE_READ = 'mcp:read'
export const MCP_SCOPE_WRITE = 'mcp:write'
export const MCP_SCOPE_ADMIN = 'mcp:admin'

function detailOf(res: { data: any }, fallback: string): string {
  const detail = res?.data?.detail
  if (typeof detail === 'string') return detail
  if (detail && typeof detail.message === 'string') return detail.message
  return fallback
}

export async function getConsentRequest(
  request: string,
  accessToken: string
): Promise<MCPConsentRequest> {
  const res = await getResponseMetadata(
    await fetch(
      `${getAPIUrl()}mcp/oauth/authorize?request=${encodeURIComponent(request)}`,
      RequestBodyWithAuthHeader('GET', null, null, accessToken)
    )
  )
  if (!res.success) throw new Error(detailOf(res, 'This request could not be loaded'))
  return res.data
}

export async function submitConsent(
  body: { request: string; approve: boolean; org_id?: number; scope?: string },
  accessToken: string
): Promise<string> {
  const res = await getResponseMetadata(
    await fetch(
      `${getAPIUrl()}mcp/oauth/authorize`,
      RequestBodyWithAuthHeader('POST', body, null, accessToken)
    )
  )
  if (!res.success) throw new Error(detailOf(res, 'Your answer could not be saved'))
  return res.data.redirect_to
}

export async function getMCPSettings(orgId: number, accessToken: string): Promise<MCPSettings> {
  const res = await getResponseMetadata(
    await fetch(
      `${getAPIUrl()}mcp/orgs/${orgId}/settings`,
      RequestBodyWithAuthHeader('GET', null, null, accessToken)
    )
  )
  if (!res.success) throw new Error(detailOf(res, 'Could not load AI app settings'))
  return res.data
}

export async function updateMCPSettings(
  orgId: number,
  enabled: boolean,
  accessToken: string
): Promise<MCPSettings> {
  const res = await getResponseMetadata(
    await fetch(
      `${getAPIUrl()}mcp/orgs/${orgId}/settings`,
      RequestBodyWithAuthHeader('PUT', { enabled }, null, accessToken)
    )
  )
  if (!res.success) throw new Error(detailOf(res, 'Could not update AI app settings'))
  return res.data
}

export async function listMCPConnections(
  orgId: number,
  scope: 'mine' | 'org',
  accessToken: string
): Promise<MCPConnection[]> {
  const res = await getResponseMetadata(
    await fetch(
      `${getAPIUrl()}mcp/orgs/${orgId}/connections?scope=${scope}`,
      RequestBodyWithAuthHeader('GET', null, null, accessToken)
    )
  )
  if (!res.success) throw new Error(detailOf(res, 'Could not load connected apps'))
  return Array.isArray(res.data) ? res.data : []
}

export async function disconnectMCPConnection(
  orgId: number,
  grantUuid: string,
  accessToken: string
): Promise<void> {
  const res = await getResponseMetadata(
    await fetch(
      `${getAPIUrl()}mcp/orgs/${orgId}/connections/${encodeURIComponent(grantUuid)}`,
      RequestBodyWithAuthHeader('DELETE', null, null, accessToken)
    )
  )
  if (!res.success) throw new Error(detailOf(res, 'Could not disconnect the app'))
}

export interface MCPApproval {
  id: string
  tool: string
  summary: string
  client_name: string
  target: { kind?: string; name?: string | null; uuid?: string | null; parent?: { kind?: string; name?: string | null } | null }
  status: 'pending' | 'approved' | 'declined' | 'used'
  expires_at: number
  org: { id: number; name: string; slug: string }
}

export async function getApproval(id: string, accessToken: string): Promise<MCPApproval> {
  const res = await getResponseMetadata(
    await fetch(
      `${getAPIUrl()}mcp/approvals/${encodeURIComponent(id)}`,
      RequestBodyWithAuthHeader('GET', null, null, accessToken)
    )
  )
  if (!res.success) throw new Error(detailOf(res, 'This request could not be loaded'))
  return res.data
}

export async function decideApproval(
  id: string,
  approve: boolean,
  accessToken: string
): Promise<MCPApproval['status']> {
  const res = await getResponseMetadata(
    await fetch(
      `${getAPIUrl()}mcp/approvals/${encodeURIComponent(id)}`,
      RequestBodyWithAuthHeader('POST', { approve }, null, accessToken)
    )
  )
  if (!res.success) throw new Error(detailOf(res, 'Your answer could not be saved'))
  return res.data.status
}
