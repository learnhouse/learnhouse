export interface CourseEndConfig {
  message?: string
  button_text?: string
  button_link?: string
}

export interface CourseEndButton {
  // null means "use the default translated label".
  text: string | null
  href: string
  external: boolean
}

const DEFAULT_LINK = '/courses'

/** Read the course-completion customization from an org (v2: customization, v1: general). */
export function getCourseEndConfig(org: any): CourseEndConfig {
  const config = org?.config?.config
  return config?.customization?.course_end || config?.general?.course_end || {}
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

  if (/^https?:\/\//i.test(link)) {
    return { text, href: link, external: true }
  }
  if (link.startsWith('/') && !link.startsWith('//')) {
    return { text, href: link, external: false }
  }
  return { text, href: DEFAULT_LINK, external: false }
}
