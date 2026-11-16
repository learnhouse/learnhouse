import { getAPIUrl } from '@services/config/config'
import { RequestBodyWithAuthHeader } from '@services/utils/ts/requests'
import type { LandingDoc, LandingNode } from '@components/LandingPages/model/types'

// Landing page builder API (apps/api/src/routers/landing.py).

export interface LandingCaps {
  plan: string
  custom_code: boolean
  extra_pages: boolean
  max_extra_pages: number
  custom_code_plan: string
  extra_pages_plan: string
}

export interface LandingReview {
  by: 'atlas' | 'api'
  at: string
  base_version_uuid: string
  changes: { summary: string; at: string }[]
}

export interface LandingPageSummary {
  page_uuid: string
  slug: string
  title: string
  is_home: boolean
  published: boolean
  published_version: number
  published_at: string | null
  draft_revision: number
  draft_updated_at: string
  has_unpublished_changes: boolean
  review: LandingReview | null
  update_date: string
}

export interface LandingPageDetail extends LandingPageSummary {
  draft: LandingDoc
  published_doc: LandingDoc | null
  preview_token: string
}

export interface LandingSite {
  pages: LandingPageSummary[]
  caps: LandingCaps
}

export interface LandingVersion {
  version_uuid: string
  kind: 'publish' | 'checkpoint' | 'atlas' | 'restore' | 'variant' | 'convert' | 'template'
  label: string
  number: number
  created_by: number | null
  creation_date: string
  sections: number
}

export interface LandingTemplate {
  id: string
  name: string
  description: string
  audience: string
  preset: string
  sections: string[]
  /** Gallery facets (designed templates). */
  category?: string
  scheme?: 'light' | 'dark'
  tags?: string[]
  palette?: string[]
  fonts?: { heading: string; body: string }
  featured?: boolean
  legacy?: boolean
}

/** 'org' applies a template in the organization's own brand colors and fonts. */
export type TemplatePalette = 'template' | 'org'

export interface LandingSavedSection {
  section_uuid: string
  name: string
  node: LandingNode
  symbols: Record<string, { name: string; node: LandingNode }>
  created_by: number | null
  creation_date: string
  update_date: string
}

export interface LandingLibrarySection {
  kind: string
  variant: string
  node: LandingNode
}

export interface PublicLandingPage {
  page_uuid: string | null
  slug: string
  title: string
  // fallback: the home before its first publish (converted classic landing or the default page).
  mode: 'published' | 'preview' | 'fallback'
  version: number
  doc: LandingDoc
}

export class LandingApiError extends Error {
  status: number
  detail: any
  constructor(status: number, detail: any) {
    super(typeof detail === 'string' ? detail : detail?.message || `Request failed (${status})`)
    this.status = status
    this.detail = detail
  }
}

const L = () => `${getAPIUrl()}landing`

async function call<T>(method: string, path: string, token?: string, body?: unknown): Promise<T> {
  const res = await fetch(`${L()}${path}`, RequestBodyWithAuthHeader(method, body ?? null, null, token))
  let data: any = null
  try {
    data = await res.json()
  } catch {
    data = null
  }
  if (!res.ok) throw new LandingApiError(res.status, data?.detail ?? data)
  return data as T
}

const enc = encodeURIComponent

export const getLandingSite = (orgId: number, token?: string) => call<LandingSite>('GET', `/org/${orgId}`, token)
export const getLandingTemplates = (token?: string) =>
  call<{ templates: LandingTemplate[]; categories?: string[]; sections: LandingLibrarySection[]; presets: Record<string, any> }>('GET', '/templates', token)
export const getTemplatePreview = (orgId: number, templateId: string, token?: string, palette: TemplatePalette = 'template') =>
  call<{ doc: LandingDoc }>('GET', `/template-preview/${enc(templateId)}?org_id=${orgId}${palette === 'org' ? '&palette=org' : ''}`, token)
export const getTemplateSections = (templateId: string, token?: string) =>
  call<{ template: string; theme: LandingDoc['theme']; sections: (LandingLibrarySection & { name: string })[] }>('GET', `/templates/${enc(templateId)}/sections`, token)
export const createLandingPage = (
  orgId: number,
  body: { slug: string; title?: string; template?: string | null; palette?: TemplatePalette; copy_chrome?: boolean; add_to_nav?: boolean },
  token?: string
) => call<LandingPageDetail>('POST', `/org/${orgId}/pages`, token, body)
export const getLandingPage = (pageUuid: string, token?: string) => call<LandingPageDetail>('GET', `/pages/${enc(pageUuid)}`, token)
export const updateLandingPageMeta = (pageUuid: string, body: { title?: string; slug?: string }, token?: string) =>
  call<LandingPageSummary>('PATCH', `/pages/${enc(pageUuid)}`, token, body)
export const deleteLandingPage = (pageUuid: string, token?: string) => call('DELETE', `/pages/${enc(pageUuid)}`, token)
export const saveLandingDraft = (pageUuid: string, doc: LandingDoc, baseRevision: number | null, token?: string) =>
  call<{ draft_revision: number; draft_updated_at: string; draft: LandingDoc }>('PUT', `/pages/${enc(pageUuid)}/draft`, token, { doc, base_revision: baseRevision })
export const publishLandingPage = (pageUuid: string, body: { label?: string; base_revision?: number | null }, token?: string) =>
  call<LandingPageDetail>('POST', `/pages/${enc(pageUuid)}/publish`, token, body)
export const unpublishLandingPage = (pageUuid: string, token?: string) => call<LandingPageDetail>('POST', `/pages/${enc(pageUuid)}/unpublish`, token)
export const applyLandingTemplate = (pageUuid: string, template: string, baseRevision: number | null, token?: string, palette: TemplatePalette = 'template') =>
  call<LandingPageDetail>('POST', `/pages/${enc(pageUuid)}/template`, token, { template, base_revision: baseRevision, palette })
export const getSavedSections = (orgId: number, token?: string) => call<LandingSavedSection[]>('GET', `/org/${orgId}/saved-sections`, token)
export const saveLandingSection = (orgId: number, body: { name: string; node: LandingNode; symbols?: Record<string, unknown> }, token?: string) =>
  call<LandingSavedSection>('POST', `/org/${orgId}/saved-sections`, token, body)
export const renameSavedSection = (orgId: number, uuid: string, name: string, token?: string) =>
  call<LandingSavedSection>('PATCH', `/org/${orgId}/saved-sections/${enc(uuid)}`, token, { name })
export const deleteSavedSection = (orgId: number, uuid: string, token?: string) => call('DELETE', `/org/${orgId}/saved-sections/${enc(uuid)}`, token)
export const getLandingVersions = (pageUuid: string, token?: string) => call<LandingVersion[]>('GET', `/pages/${enc(pageUuid)}/versions`, token)
export const getLandingVersion = (versionUuid: string, token?: string) =>
  call<LandingVersion & { doc: LandingDoc }>('GET', `/versions/${enc(versionUuid)}`, token)
export const restoreLandingVersion = (versionUuid: string, token?: string) => call<LandingPageDetail>('POST', `/versions/${enc(versionUuid)}/restore`, token)
export const saveLandingVariant = (pageUuid: string, label: string, token?: string) =>
  call<LandingVersion>('POST', `/pages/${enc(pageUuid)}/variants`, token, { label })
export const rotateLandingPreview = (pageUuid: string, token?: string) => call<{ preview_token: string }>('POST', `/pages/${enc(pageUuid)}/preview-token`, token)
export const resolveLandingReview = (pageUuid: string, action: 'keep' | 'discard', token?: string) =>
  call<LandingPageDetail>('POST', `/pages/${enc(pageUuid)}/review`, token, { action })
export const validateLandingDoc = (orgId: number, doc: unknown, token?: string) =>
  call<{ ok: boolean; doc?: LandingDoc; errors?: { path: string; message: string }[]; message?: string }>('POST', `/org/${orgId}/validate`, token, { doc })
export const getLandingSubmissions = (orgId: number, token?: string, pageUuid?: string) =>
  call<{ total: number; items: { submission_uuid: string; form_id: string; data: Record<string, any>; creation_date: string }[] }>(
    'GET',
    `/org/${orgId}/submissions${pageUuid ? `?page_uuid=${enc(pageUuid)}` : ''}`,
    token
  )
export const deleteLandingSubmission = (orgId: number, uuid: string, token?: string) => call('DELETE', `/org/${orgId}/submissions/${enc(uuid)}`, token)
export const generateLandingWithAI = (orgId: number, body: { page_uuid: string; brief: string; base_revision: number | null }, token?: string) =>
  call<LandingPageDetail>('POST', `/org/${orgId}/ai/generate`, token, body)
export const rewriteLandingCopy = (orgId: number, body: { text: string; instruction: string; context?: string }, token?: string) =>
  call<{ text: string }>('POST', `/org/${orgId}/ai/copy`, token, body)

export const getPublicLandingPage = (orgSlug: string, slug: string, preview?: string | null) =>
  call<PublicLandingPage>('GET', `/public/${enc(orgSlug)}?slug=${enc(slug)}${preview ? `&preview=${enc(preview)}` : ''}`)
export const submitLandingForm = (orgSlug: string, slug: string, formId: string, data: Record<string, any>) =>
  call<{ detail: string }>('POST', `/public/${enc(orgSlug)}/forms/${enc(formId)}?slug=${enc(slug)}`, undefined, { data })

export const landingQueryKeys = {
  site: (orgId?: number) => ['landing', 'site', orgId] as const,
  page: (uuid?: string) => ['landing', 'page', uuid] as const,
  versions: (uuid?: string) => ['landing', 'versions', uuid] as const,
  templates: () => ['landing', 'templates'] as const,
  publicPage: (orgSlug?: string, slug?: string, preview?: string | null) => ['landing', 'public', orgSlug, slug, preview || ''] as const,
  submissions: (orgId?: number) => ['landing', 'submissions', orgId] as const,
  saved: (orgId?: number) => ['landing', 'saved-sections', orgId] as const,
  templateSections: (id?: string) => ['landing', 'template-sections', id] as const,
  templatePreview: (orgId?: number, id?: string, palette: TemplatePalette = 'template') => ['landing', 'template-preview', orgId, id, palette] as const,
}
