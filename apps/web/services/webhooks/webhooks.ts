import { getAPIUrl } from '@services/config/config'
import {
  RequestBodyWithAuthHeader,
  getResponseMetadata,
} from '@services/utils/ts/requests'

export interface WebhookEndpoint {
  id: number
  webhook_uuid: string
  org_id: number
  url: string
  description: string | null
  events: string[]
  is_active: boolean
  has_secret: boolean
  created_by_user_id: number
  creation_date: string
  update_date: string
}

export interface WebhookEndpointCreated {
  webhook_uuid: string
  url: string
  description: string | null
  events: string[]
  is_active: boolean
  secret: string
  created_by_user_id: number
  creation_date: string
}

export interface WebhookCreateRequest {
  url: string
  description?: string | null
  events: string[]
}

export interface WebhookUpdateRequest {
  url?: string | null
  description?: string | null
  events?: string[] | null
  is_active?: boolean | null
}

export interface WebhookDeliveryLog {
  id: number
  webhook_id: number
  event_name: string
  delivery_uuid: string
  request_payload: any
  response_status: number | null
  response_body: string | null
  success: boolean
  attempt: number
  error_message: string | null
  created_at: string
}

export interface WebhookEvent {
  [key: string]: string
}

export async function getWebhookEvents(
  org_id: number,
  access_token: string
) {
  const result = await fetch(
    `${getAPIUrl()}orgs/${org_id}/webhooks/events`,
    RequestBodyWithAuthHeader('GET', null, null, access_token)
  )
  return getResponseMetadata(result)
}

export async function getWebhookEndpoints(
  org_id: number,
  access_token: string
) {
  const result = await fetch(
    `${getAPIUrl()}orgs/${org_id}/webhooks`,
    RequestBodyWithAuthHeader('GET', null, null, access_token)
  )
  return getResponseMetadata(result)
}

export async function createWebhookEndpoint(
  org_id: number,
  data: WebhookCreateRequest,
  access_token: string
) {
  const result = await fetch(
    `${getAPIUrl()}orgs/${org_id}/webhooks`,
    RequestBodyWithAuthHeader('POST', data, null, access_token)
  )
  return getResponseMetadata(result)
}

export async function updateWebhookEndpoint(
  org_id: number,
  webhook_uuid: string,
  data: WebhookUpdateRequest,
  access_token: string
) {
  const result = await fetch(
    `${getAPIUrl()}orgs/${org_id}/webhooks/${webhook_uuid}`,
    RequestBodyWithAuthHeader('PUT', data, null, access_token)
  )
  return getResponseMetadata(result)
}

export async function deleteWebhookEndpoint(
  org_id: number,
  webhook_uuid: string,
  access_token: string
) {
  const result = await fetch(
    `${getAPIUrl()}orgs/${org_id}/webhooks/${webhook_uuid}`,
    RequestBodyWithAuthHeader('DELETE', null, null, access_token)
  )
  return getResponseMetadata(result)
}

export async function regenerateWebhookSecret(
  org_id: number,
  webhook_uuid: string,
  access_token: string
) {
  const result = await fetch(
    `${getAPIUrl()}orgs/${org_id}/webhooks/${webhook_uuid}/regenerate-secret`,
    RequestBodyWithAuthHeader('POST', null, null, access_token)
  )
  return getResponseMetadata(result)
}

export async function sendTestEvent(
  org_id: number,
  webhook_uuid: string,
  access_token: string
) {
  const result = await fetch(
    `${getAPIUrl()}orgs/${org_id}/webhooks/${webhook_uuid}/test`,
    RequestBodyWithAuthHeader('POST', null, null, access_token)
  )
  return getResponseMetadata(result)
}

export async function getWebhookDeliveryLogs(
  org_id: number,
  webhook_uuid: string,
  access_token: string,
  limit: number = 50
) {
  const result = await fetch(
    `${getAPIUrl()}orgs/${org_id}/webhooks/${webhook_uuid}/deliveries?limit=${limit}`,
    RequestBodyWithAuthHeader('GET', null, null, access_token)
  )
  return getResponseMetadata(result)
}
