/**
 * Landing page builder seeding and read-backs. Every page this module
 * creates is an extra page whose slug starts with `e2e-landing-`, so
 * cleanup never touches the org home or anyone else's pages.
 */
import { req, login, getOrg } from '../../core/client'
import { ADMIN_EMAIL, ADMIN_PASSWORD, API_URL } from '../../core/instance'

export const PREFIX = 'e2e-landing-'

export async function admin() {
  const token = await login(ADMIN_EMAIL, ADMIN_PASSWORD)
  const org = await getOrg()
  return { token, org }
}

export interface PageDetail {
  page_uuid: string
  slug: string
  draft: any
  draft_revision: number
  published: boolean
  published_version: number
  preview_token: string
}

export const site = (token: string, orgId: number) => req<any>('GET', `/landing/org/${orgId}`, token)
export const library = (token: string) => req<any>('GET', '/landing/templates', token)

export async function createPage(token: string, orgId: number, slug: string, template?: string): Promise<PageDetail> {
  return req<PageDetail>('POST', `/landing/org/${orgId}/pages`, token, { slug: PREFIX + slug, title: `E2E ${slug}`, ...(template ? { template } : {}) })
}

export const saveDraft = (token: string, uuid: string, doc: any, base: number | null = null) =>
  req<any>('PUT', `/landing/pages/${uuid}/draft`, token, { doc, base_revision: base })
export const publish = (token: string, uuid: string) => req<PageDetail>('POST', `/landing/pages/${uuid}/publish`, token, { label: 'e2e' })
export const publicPage = (orgSlug: string, slug: string, preview?: string) =>
  req<any>('GET', `/landing/public/${encodeURIComponent(orgSlug)}?slug=${encodeURIComponent(slug)}${preview ? `&preview=${preview}` : ''}`, null)

/** Raw call that returns the status instead of throwing. */
export async function raw(method: string, path: string, token: string | null, body?: unknown) {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  let data: any = null
  try { data = text ? JSON.parse(text) : null } catch { data = text }
  return { status: res.status, data }
}

export async function cleanup(token: string, orgId: number) {
  const s = await site(token, orgId)
  for (const p of s.pages.filter((x: any) => x.slug.startsWith(PREFIX))) {
    await raw('DELETE', `/landing/pages/${p.page_uuid}`, token)
  }
}

/** A minimal valid document with one section. */
export function doc(children: any[], extra: Record<string, any> = {}) {
  return {
    schema: 'lh.page',
    version: 1,
    symbols: {},
    root: [{ id: 's1', type: 'section', props: {}, children: [{ id: 'c1', type: 'container', props: {}, children }] }],
    ...extra,
  }
}
