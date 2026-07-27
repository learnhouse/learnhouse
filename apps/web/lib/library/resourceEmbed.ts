import { getUriWithOrg } from '@services/config/config'

/*
 Route resolution for a Library resource, shared by the Resource activity and
 the Library editor block. Mirrors resourceHref's uuid-prefix handling.
*/

export type ResourceKind =
  | 'course'
  | 'podcast'
  | 'community'
  | 'board'
  | 'playground'
  | 'media'

/**
 * Base internal route for a Library resource. Boards live at a top-level
 * chrome-free route; the other kinds live under the (withmenu) group (see
 * buildEmbedUrl for the chrome=none suppression used when embedding).
 * `media` has no page of its own — it is rendered by MediaViewer instead.
 */
export function buildResourceUrl(
  kind: ResourceKind,
  resourceUuid: string,
  orgslug: string
): string | null {
  if (!resourceUuid) return null
  switch (kind) {
    case 'board':
      return getUriWithOrg(orgslug, `/board/${resourceUuid.replace('board_', '')}`)
    case 'community':
      return getUriWithOrg(orgslug, `/community/${resourceUuid.replace('community_', '')}`)
    case 'podcast':
      return getUriWithOrg(orgslug, `/podcast/${resourceUuid.replace('podcast_', '')}`)
    case 'playground':
      // Playgrounds use the full prefixed uuid.
      return getUriWithOrg(orgslug, `/playground/${resourceUuid}`)
    case 'course':
      return getUriWithOrg(orgslug, `/course/${resourceUuid.replace('course_', '')}`)
    default:
      return null
  }
}

// Boards already render chrome-free; the (withmenu) kinds need ?chrome=none.
export function buildEmbedUrl(kind: ResourceKind, baseUrl: string): string {
  if (kind === 'board') return baseUrl
  return baseUrl.includes('?') ? `${baseUrl}&chrome=none` : `${baseUrl}?chrome=none`
}
