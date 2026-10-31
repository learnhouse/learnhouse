import { getAPIUrl } from '@services/config/config'
import {
  RequestBodyWithAuthHeader,
  getResponseMetadata,
} from '@services/utils/ts/requests'

export interface PreviewPersona {
  signed_in: boolean
  first_name?: string | null
  last_name?: string | null
  role: 'admin' | 'maintainer' | 'member' | 'anonymous'
  usergroup_uuids: string[]
  locale: string
  enrolled: boolean
  days_enrolled?: number | null
  progress_percent: number
  completed_activity_uuids: string[]
  today?: string | null
  email?: string | null
  bucket?: number | null
  // Preview as this enrolled learner; the other fields are then ignored.
  user_uuid?: string | null
}

export interface DynamicPreviewResult {
  content: any
  shown_blocks: number
  hidden_blocks: number
  variables: number
}

// Render a document as `persona` would receive it. Editors only.
export async function getDynamicPreview(
  activity_uuid: string,
  content: any,
  persona: PreviewPersona,
  access_token: string
) {
  const result = await fetch(
    `${getAPIUrl()}activities/${activity_uuid}/dynamic-preview`,
    RequestBodyWithAuthHeader('POST', { content, persona }, null, access_token)
  )
  return getResponseMetadata(result)
}

export type EditorTemplateKind = 'block' | 'page'

export interface EditorTemplate {
  id: number
  template_uuid: string
  org_id: number
  creator_id: number | null
  name: string
  description: string
  kind: EditorTemplateKind
  content: any
  creation_date: string
  update_date: string
}

export async function getEditorTemplates(org_id: number, access_token: string) {
  const result = await fetch(
    `${getAPIUrl()}editor-templates/?org_id=${org_id}`,
    RequestBodyWithAuthHeader('GET', null, null, access_token)
  )
  return getResponseMetadata(result)
}

export async function createEditorTemplate(
  body: { org_id: number; name: string; description: string; kind: EditorTemplateKind; content: any },
  access_token: string
) {
  const result = await fetch(
    `${getAPIUrl()}editor-templates/`,
    RequestBodyWithAuthHeader('POST', body, null, access_token)
  )
  return getResponseMetadata(result)
}

export async function deleteEditorTemplate(template_uuid: string, access_token: string) {
  const result = await fetch(
    `${getAPIUrl()}editor-templates/${template_uuid}`,
    RequestBodyWithAuthHeader('DELETE', null, null, access_token)
  )
  return getResponseMetadata(result)
}

export interface DynamicReach {
  learners: number
  blocks: number[]
  truncated: boolean
}

// How many enrolled learners see each conditional block, in document order.
export async function getDynamicReach(activity_uuid: string, content: any, access_token: string) {
  const result = await fetch(
    `${getAPIUrl()}activities/${activity_uuid}/dynamic-reach`,
    RequestBodyWithAuthHeader('POST', { content }, null, access_token)
  )
  return getResponseMetadata(result)
}

export interface DynamicLearner {
  user_uuid: string
  username: string
  first_name: string
  last_name: string
}

export async function searchDynamicLearners(activity_uuid: string, query: string, access_token: string) {
  const result = await fetch(
    `${getAPIUrl()}activities/${activity_uuid}/dynamic-learners?q=${encodeURIComponent(query)}`,
    RequestBodyWithAuthHeader('GET', null, null, access_token)
  )
  return getResponseMetadata(result)
}

export interface EditorAudience {
  audience_uuid: string
  org_id: number
  name: string
  description: string
  rules: any
}

// Saved audiences: named rule sets blocks can refer to.
export async function getEditorAudiences(org_id: number, access_token: string) {
  const result = await fetch(
    `${getAPIUrl()}editor-audiences/?org_id=${org_id}`,
    RequestBodyWithAuthHeader('GET', null, null, access_token)
  )
  return getResponseMetadata(result)
}

export async function createEditorAudience(
  body: { org_id: number; name: string; description: string; rules: any },
  access_token: string
) {
  const result = await fetch(
    `${getAPIUrl()}editor-audiences/`,
    RequestBodyWithAuthHeader('POST', body, null, access_token)
  )
  return getResponseMetadata(result)
}

export async function deleteEditorAudience(audience_uuid: string, access_token: string) {
  const result = await fetch(
    `${getAPIUrl()}editor-audiences/${audience_uuid}`,
    RequestBodyWithAuthHeader('DELETE', null, null, access_token)
  )
  return getResponseMetadata(result)
}
