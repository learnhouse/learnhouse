// The course-completion screen (CourseEndView) and its editor.
//
// Each course can set its own screen in `extra_metadata.course_end` (course
// editor → Certification tab). Text it leaves empty falls back to the
// organization-level config (the old org setting, kept for orgs that set it),
// then to the screen's built-in defaults.

export interface CourseEndConfig {
  message?: string
  button_text?: string
  button_link?: string
}

// Per-course options on top of the org-level fields. Mirrors
// CourseCompletionConfig in apps/api/src/db/courses/courses.py.
export interface CourseCompletionConfig extends CourseEndConfig {
  title?: string
  show_confetti?: boolean
  show_back_button?: boolean
  secondary_button_text?: string
  secondary_button_link?: string
}

export interface CourseEndButton {
  // null means "use the default translated label".
  text: string | null
  href: string
  external: boolean
}

export const COURSE_END_LIMITS = {
  title: 120,
  message: 500,
  buttonText: 60,
  link: 2048,
} as const

const DEFAULT_LINK = '/courses'
const TEXT_FIELDS = ['message', 'button_text', 'button_link'] as const

/** The organization-level config (v2: customization, v1: general). */
export function getOrgCourseEndConfig(org: any): CourseEndConfig {
  const config = org?.config?.config
  return config?.customization?.course_end || config?.general?.course_end || {}
}

/** The course's own config, or null when it uses the organization default. */
export function getCourseCompletionConfig(course: any): CourseCompletionConfig | null {
  const value = course?.extra_metadata?.course_end
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null
}

/**
 * The config the completion screen renders: the course's own values first,
 * then the organization's for any text the course leaves empty.
 */
export function getCourseEndConfig(org: any, course?: any): CourseCompletionConfig {
  const orgConfig = getOrgCourseEndConfig(org)
  const courseConfig = course === undefined ? null : getCourseCompletionConfig(course)
  if (!courseConfig) return orgConfig

  const merged: CourseCompletionConfig = { ...courseConfig }
  for (const key of TEXT_FIELDS) {
    if (!(courseConfig[key] || '').trim() && orgConfig[key]) merged[key] = orgConfig[key]
  }
  return merged
}

/** True for an internal path ("/courses") or an absolute http(s) URL. */
export function isSafeCourseEndLink(link: string): boolean {
  const value = link.trim()
  return /^https?:\/\//i.test(value) || (value.startsWith('/') && !value.startsWith('//'))
}

export function isExternalCourseEndLink(link: string): boolean {
  return /^https?:\/\//i.test(link.trim())
}

/**
 * The extra button shown next to "Back to Course". With nothing configured it
 * points at the course catalog, so learners always have a way onward.
 *
 * The API already rejects unsafe links; the same allowlist is applied here so a
 * value that reached the config some other way still cannot become a
 * javascript: href.
 */
export function resolveCourseEndButton(config: CourseEndConfig): CourseEndButton {
  const link = (config.button_link || '').trim()
  const text = (config.button_text || '').trim() || null

  if (link && isSafeCourseEndLink(link)) {
    return { text, href: link, external: isExternalCourseEndLink(link) }
  }
  return { text, href: DEFAULT_LINK, external: false }
}

/** The optional second button: shown only with both a label and a safe link. */
export function resolveSecondaryButton(config: CourseCompletionConfig): (CourseEndButton & { text: string }) | null {
  const link = (config.secondary_button_link || '').trim()
  const text = (config.secondary_button_text || '').trim()
  if (!text || !link || !isSafeCourseEndLink(link)) return null
  return { text, href: link, external: isExternalCourseEndLink(link) }
}

/** Flags default to on: a config saved without them shows the full screen. */
export function courseEndFlags(config: CourseCompletionConfig): { confetti: boolean; backButton: boolean } {
  return {
    confetti: config.show_confetti !== false,
    backButton: config.show_back_button !== false,
  }
}
