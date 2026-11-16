// Settings → General: the form model shared by the page and its tests. One
// draft for the whole page (organization, contact, language, features,
// footer); each section saves through the endpoint it always used.
import { OPTIONAL_FEATURES, getOptionalFeatureState, type OptionalFeatureKey } from '@services/features/optionalFeatures'
import type { OrgSocials } from '@components/Dashboard/Pages/Org/OrgEditSocials/OrgEditSocials'
import { orgLiveEditing } from '@components/Objects/Editor/Collab/liveEditing'

export const NAME_MAX = 60
export const DESCRIPTION_MAX = 100
export const ABOUT_MAX = 400
export const FOOTER_MAX = 100
// Mirrors MAX_SENDER_NAME_LENGTH in apps/api/src/services/email/sender.py, which
// re-validates (and sanitizes) every submitted value server-side.
export const MAX_EMAIL_SENDER_NAME_LENGTH = 64
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export const SECTIONS = ['organization', 'contact', 'language', 'features', 'footer'] as const
export type Section = (typeof SECTIONS)[number]

/** Optional features by area, in the order the Features section lists them. */
export const FEATURE_GROUPS: { key: 'content' | 'engagement' | 'selling'; features: OptionalFeatureKey[] }[] = [
  { key: 'content', features: ['paths', 'folders', 'podcasts', 'boards', 'playgrounds'] },
  { key: 'engagement', features: ['communities', 'live_sessions', 'newsletter'] },
  { key: 'selling', features: ['payments'] },
]

export interface GeneralDraft {
  name: string
  description: string
  about: string
  label: string
  email: string
  socials: OrgSocials
  links: Record<string, string>
  footerText: string
  emailSenderName: string
  defaultLanguage: string
  /** On/off for every optional feature the org can flip (in plan, not blocked by the platform). */
  features: Partial<Record<OptionalFeatureKey, boolean>>
  /** Org-wide default for live collaboration and autosave in the editor. */
  liveEditing: boolean
}

export type FieldError = 'name' | 'description' | 'about' | 'label' | 'email'

/** Which section edits each draft field (unsaved dots, jump to the first error). */
export const SECTION_FIELDS: Record<Section, (keyof GeneralDraft)[]> = {
  organization: ['name', 'description', 'about', 'label'],
  contact: ['email', 'socials', 'links'],
  language: ['defaultLanguage', 'emailSenderName'],
  features: ['features', 'liveEditing'],
  footer: ['footerText'],
}

export function readGeneral(org: any): GeneralDraft {
  const config = org?.config?.config || {}
  const custom = config.customization?.general || {}
  const legacy = config.general || {}
  const rf = config.resolved_features
  const features: GeneralDraft['features'] = {}
  for (const f of OPTIONAL_FEATURES) {
    const state = getOptionalFeatureState(rf?.[f.key])
    if (state.status === 'locked' || state.disabledBy === 'platform') continue
    features[f.key] = state.status === 'on'
  }
  return {
    name: org?.name || '',
    description: org?.description || '',
    about: org?.about || '',
    label: org?.label || '',
    email: org?.email || '',
    socials: org?.socials && typeof org.socials === 'object' ? org.socials : {},
    links: org?.links && typeof org.links === 'object' ? org.links : {},
    footerText: custom.footer_text || legacy.footer_text || '',
    emailSenderName: custom.email_sender_name || legacy.email_sender_name || '',
    defaultLanguage: custom.default_language || legacy.default_language || 'en',
    features,
    liveEditing: orgLiveEditing(config),
  }
}

/** Error keys (i18n suffixes) per invalid field; empty when the draft can be saved. */
export function validateGeneral(draft: GeneralDraft): Partial<Record<FieldError, string>> {
  const errors: Partial<Record<FieldError, string>> = {}
  if (!draft.name.trim()) errors.name = 'name_required'
  else if (draft.name.length > NAME_MAX) errors.name = 'name_max'
  if (!draft.description.trim()) errors.description = 'short_description_required'
  else if (draft.description.length > DESCRIPTION_MAX) errors.description = 'short_description_max'
  if (draft.about.length > ABOUT_MAX) errors.about = 'about_max'
  if (!draft.label) errors.label = 'label_required'
  if (draft.email.trim() && !EMAIL_RE.test(draft.email.trim())) errors.email = 'email_invalid'
  return errors
}

const FIELD_SECTION: Record<FieldError, Section> = {
  name: 'organization',
  description: 'organization',
  about: 'organization',
  label: 'organization',
  email: 'contact',
}

/** The first section (in page order) holding an invalid field, or null. */
export function firstInvalidSection(errors: Partial<Record<FieldError, string>>): Section | null {
  const bad = new Set((Object.keys(errors) as FieldError[]).map((k) => FIELD_SECTION[k]))
  return SECTIONS.find((s) => bad.has(s)) ?? null
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

export function sectionDirty(section: Section, draft: GeneralDraft, saved: GeneralDraft): boolean {
  return SECTION_FIELDS[section].some((field) => !same(draft[field], saved[field]))
}

/** What a save has to send, endpoint by endpoint. */
export function diffGeneral(draft: GeneralDraft, saved: GeneralDraft) {
  const profile =
    draft.name !== saved.name ||
    draft.description !== saved.description ||
    draft.about !== saved.about ||
    draft.label !== saved.label ||
    draft.email.trim() !== saved.email ||
    !same(draft.socials, saved.socials) ||
    !same(draft.links, saved.links)
  const features = (Object.keys(draft.features) as OptionalFeatureKey[])
    .filter((key) => draft.features[key] !== saved.features[key])
    .map((key) => ({ key, enabled: !!draft.features[key] }))
  return {
    profile,
    footer: draft.footerText !== saved.footerText,
    senderName: draft.emailSenderName !== saved.emailSenderName,
    language: draft.defaultLanguage !== saved.defaultLanguage,
    features,
    liveEditing: draft.liveEditing !== saved.liveEditing,
  }
}
