import { getUriWithOrg } from '@services/config/config'

export type LibraryContext = 'dashboard' | 'public'

/**
 * Guard for binding an external URL to an anchor href: only allow http(s) so an
 * untrusted scheme (e.g. javascript:) from a user-entered embed URL can't run.
 */
export function safeExternalUrl(url?: string | null): string | null {
  if (!url) return null
  return /^https?:\/\//i.test(url) ? url : null
}

/**
 * Internal navigation URL for a resource placed in the library, by type.
 * Mirrors each resource's canonical link (and uuid-prefix handling) used by its
 * own card elsewhere in the app. Returns null for types handled separately
 * (courses use CourseThumbnail; media links to its file/embed URL).
 */
export function resourceHref(
  type: string,
  resource: any,
  orgslug: string,
  ctx: LibraryContext
): string | null {
  if (!resource) return null
  const dash = ctx === 'dashboard'
  switch (type) {
    case 'communities': {
      const id = (resource.community_uuid || '').replace('community_', '')
      return id
        ? getUriWithOrg(orgslug, dash ? `/dash/communities/${id}/general` : `/community/${id}`)
        : null
    }
    case 'boards': {
      const id = (resource.board_uuid || '').replace('board_', '')
      return id
        ? getUriWithOrg(orgslug, dash ? `/dash/boards/${id}/general` : `/board/${id}`)
        : null
    }
    case 'podcasts': {
      const id = (resource.podcast_uuid || '').replace('podcast_', '')
      return id
        ? getUriWithOrg(orgslug, dash ? `/dash/podcasts/podcast/${id}/general` : `/podcast/${id}`)
        : null
    }
    case 'playgrounds': {
      // Playgrounds use the full prefixed uuid and have no separate dash route.
      return resource.playground_uuid
        ? getUriWithOrg(orgslug, `/playground/${resource.playground_uuid}`)
        : null
    }
    default:
      return null
  }
}
