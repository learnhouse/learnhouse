import { getAPIUrl } from '@services/config/config'
import { RequestBodyFormWithAuthHeader, RequestBodyWithAuthHeader, errorHandling } from '@services/utils/ts/requests'
import type { SeoResourceType } from '@/lib/seo/paths'
import type { ResourceSeo } from '@/lib/seo/meta'

export type SeoSettings = {
  resource_type: SeoResourceType
  uuid: string
  org_id: number
  slug: string | null
  name: string
  description: string
  thumbnail_image: string
  seo: ResourceSeo
  update_date: string
}

export type SlugCheck = { slug: string; available: boolean; reason: string | null; suggestion: string | null }

export type SeoHealthItem = SeoSettings & { public: boolean; published: boolean; key: string }

const q = (params: Record<string, string | number | undefined | null>) =>
  new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '') as [string, string][]).toString()

export async function getSeoSettings(type: SeoResourceType, uuid: string, token?: string): Promise<SeoSettings> {
  const res = await fetch(`${getAPIUrl()}seo/${type}/${encodeURIComponent(uuid)}`, RequestBodyWithAuthHeader('GET', null, null, token))
  return errorHandling(res)
}

export async function updateSeoSettings(
  type: SeoResourceType,
  uuid: string,
  body: { seo?: ResourceSeo; slug?: string },
  token?: string,
): Promise<SeoSettings> {
  const res = await fetch(`${getAPIUrl()}seo/${type}/${encodeURIComponent(uuid)}`, RequestBodyWithAuthHeader('PUT', body, null, token))
  return errorHandling(res)
}

export async function checkSlug(orgId: number, type: SeoResourceType, slug: string, resourceUuid?: string, token?: string): Promise<SlugCheck> {
  const res = await fetch(
    `${getAPIUrl()}seo/slug/check?${q({ org_id: orgId, resource_type: type, slug, resource_uuid: resourceUuid })}`,
    RequestBodyWithAuthHeader('GET', null, null, token),
  )
  return errorHandling(res)
}

export async function suggestSlug(orgId: number, type: SeoResourceType, title: string, resourceUuid?: string, token?: string): Promise<string> {
  const res = await fetch(
    `${getAPIUrl()}seo/slug/suggest?${q({ org_id: orgId, resource_type: type, title, resource_uuid: resourceUuid })}`,
    RequestBodyWithAuthHeader('GET', null, null, token),
  )
  return (await errorHandling(res)).slug
}

export async function uploadSeoImage(type: SeoResourceType, uuid: string, file: File, token?: string): Promise<string> {
  const form = new FormData()
  form.append('image', file)
  const res = await fetch(`${getAPIUrl()}seo/${type}/${encodeURIComponent(uuid)}/image`, RequestBodyFormWithAuthHeader('POST', form, null, token || ''))
  return (await errorHandling(res)).filename
}

export async function aiSuggestSeo(
  orgId: number,
  type: SeoResourceType,
  uuid: string,
  extra: string,
  token?: string,
): Promise<{ title: string; description: string }> {
  const res = await fetch(
    `${getAPIUrl()}seo/ai/suggest`,
    RequestBodyWithAuthHeader('POST', { org_id: orgId, resource_type: type, resource_uuid: uuid, extra }, null, token),
  )
  return errorHandling(res)
}

export async function getSeoHealth(orgId: number, token?: string): Promise<{ org_seo: Record<string, any>; items: SeoHealthItem[] }> {
  const res = await fetch(`${getAPIUrl()}seo/health/${orgId}`, RequestBodyWithAuthHeader('GET', null, null, token))
  return errorHandling(res)
}
