// Shared by the settings layout (header + tabs) and the tab page (body).

// Security now lives with the people it governs, under Users, split across a
// two-factor tab and a sign-in-methods tab. The old single URL keeps working.
export const MOVED_TO_USERS: Record<string, string> = {
  security: 'two-factor',
}

// Sections that moved to the top-level Developers dashboard. Old settings links
// (/dash/org/settings/{seo,api,domains,automations,sso}) redirect there.
export const MOVED_TO_DEVELOPERS: Record<string, string> = {
  developers: 'api',
  api: 'api',
  automations: 'automations',
  domains: 'domains',
  seo: 'seo',
  sso: 'sso',
}

// The course-completion screen is now set per course (course editor →
// Certification tab). The old org-wide tab sends people to their courses.
export const MOVED_TO_COURSES: Record<string, string> = {
  'course-end': '/dash/courses',
}

// The landing page builder is now its own area (Website, /dash/website).
export const MOVED_TO_WEBSITE: Record<string, string> = {
  landing: '/dash/website',
}

// Tabs renamed or merged inside org settings. Usage became Plan & usage, then
// Overview (the first tab); Features merged into General (its own section).
export const RENAMED_IN_SETTINGS: Record<string, string> = {
  usage: 'overview',
  plan: 'overview',
  'plan-usage': 'overview',
  features: 'general#features',
}

/** The first tab, and where /dash/org/settings itself lands. */
export const DEFAULT_SETTINGS_TAB = 'overview'

/**
 * Where an old settings URL now lives, keeping its query (?section=…) and
 * any hash it had; a target's own hash (#features) wins. Null when the
 * subpage was not renamed.
 */
export function renamedSettingsUrl(subpage: string, search = '', hash = ''): string | null {
  const target = RENAMED_IN_SETTINGS[subpage]
  if (!target) return null
  const [tab, targetHash] = target.split('#')
  const h = targetHash ? `#${targetHash}` : hash
  return `/dash/org/settings/${tab}${search}${h}`
}

export function isMovedSubpage(subpage: string | null | undefined): boolean {
  return (
    !!subpage &&
    (subpage in MOVED_TO_DEVELOPERS || subpage in MOVED_TO_USERS || subpage in MOVED_TO_COURSES || subpage in MOVED_TO_WEBSITE || subpage in RENAMED_IN_SETTINGS)
  )
}
