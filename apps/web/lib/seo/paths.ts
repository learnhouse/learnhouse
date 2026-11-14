/**
 * Public URL paths for resources. A resource's URL uses its slug when it has
 * one and falls back to its uuid (without the `course_`-style prefix); old
 * uuid URLs redirect to the slug URL, so either works as a link, but the slug
 * form saves the redirect.
 */

export type SeoResourceType = 'course' | 'path' | 'podcast' | 'community' | 'folder'

export const RESOURCE_PREFIX: Record<SeoResourceType, string> = {
  course: 'course_',
  path: 'path_',
  podcast: 'podcast_',
  community: 'community_',
  folder: 'folder_',
}

const SEGMENT: Record<SeoResourceType, string> = {
  course: '/course/',
  path: '/path/',
  podcast: '/podcast/',
  community: '/community/',
  folder: '/library/folder/',
}

export function stripResourcePrefix(type: SeoResourceType, uuid: string | null | undefined): string {
  const value = String(uuid ?? '')
  const prefix = RESOURCE_PREFIX[type]
  return value.startsWith(prefix) ? value.slice(prefix.length) : value
}

/** The key public URLs use: the slug, else the bare uuid. */
export function resourceKey(type: SeoResourceType, resource: { slug?: string | null; [k: string]: any } | null | undefined, uuid?: string | null): string {
  if (resource?.slug) return resource.slug
  return stripResourcePrefix(type, uuid ?? resource?.[`${type}_uuid`])
}

export function resourcePath(type: SeoResourceType, resource: { slug?: string | null; [k: string]: any } | null | undefined, uuid?: string | null): string {
  return `${SEGMENT[type]}${resourceKey(type, resource, uuid)}`
}

/** `/course/{slug|uuid}` for a course object (any shape with course_uuid/slug). */
export function coursePath(course: { slug?: string | null; course_uuid?: string | null } | null | undefined): string {
  return resourcePath('course', course)
}

/** URL prefix of a resource type, with slashes (`/course/`, `/library/folder/`). */
export function resourceSegment(type: SeoResourceType): string {
  return SEGMENT[type]
}
