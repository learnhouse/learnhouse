import type { LandingSection } from '@components/Dashboard/Pages/Org/OrgEditLanding/landing_types'
import type { SessionStatus } from '@components/Contexts/AuthContext'
import { youTubeId, vimeoId, toEmbedUrl } from '@/lib/media/embedUrl'

/**
 * Whether a landing section should render for the current visitor.
 *
 * Audience-restricted sections stay hidden while the session is still
 * loading, so a signed-in learner never sees the visitor-only hero flash by.
 */
export function isSectionVisible(section: LandingSection, status: SessionStatus): boolean {
  const visibility = section.visibility || 'everyone'
  if (visibility === 'everyone') return true
  if (status === 'loading') return false
  return visibility === 'logged_in'
    ? status === 'authenticated'
    : status === 'unauthenticated'
}

export type LandingVideoSource =
  | { kind: 'embed'; src: string }
  | { kind: 'file'; src: string }
  | null

/**
 * Only known video hosts become an iframe. Anything else http(s) is treated
 * as a video file, so an arbitrary page can never be framed on the landing.
 */
export function resolveLandingVideo(url: string): LandingVideoSource {
  const trimmed = (url || '').trim()
  if (!/^https?:\/\//i.test(trimmed)) return null
  const isLoom = /^https?:\/\/www\.loom\.com\/(share|embed)\//.test(trimmed)
  if (youTubeId(trimmed) || vimeoId(trimmed) || isLoom) {
    return { kind: 'embed', src: toEmbedUrl(trimmed) }
  }
  return { kind: 'file', src: trimmed }
}
