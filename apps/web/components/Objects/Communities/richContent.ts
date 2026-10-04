import type { Community } from '@services/communities/communities'

/**
 * Rich content (currently: YouTube embeds) in community discussions is
 * opt-in per community through the `allow_rich_content` moderation setting.
 * The API validates every post server-side; these helpers only decide what
 * the editor offers and what the reader renders.
 */

export const RICH_NODE_TYPES = new Set(['youtube'])

const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
  'youtu.be',
  'www.youtu.be',
])

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/

export function isRichContentAllowed(
  community: Pick<Community, 'moderation_settings'> | null | undefined
): boolean {
  return community?.moderation_settings?.allow_rich_content === true
}

/**
 * Returns the 11-character video id when `url` is a YouTube watch, share,
 * shorts or embed link on a known YouTube host, otherwise `null`.
 * Mirrors `extract_youtube_video_id` on the API.
 */
export function extractYoutubeVideoId(url: string | null | undefined): string | null {
  if (!url || typeof url !== 'string') return null
  let parsed: URL
  try {
    parsed = new URL(url.trim())
  } catch {
    return null
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
  const host = parsed.hostname.toLowerCase()
  if (!YOUTUBE_HOSTS.has(host)) return null

  const parts = parsed.pathname.split('/').filter(Boolean)
  let candidate: string | null = null
  if (host.endsWith('youtu.be')) {
    candidate = parts[0] ?? null
  } else if (parts.length > 1 && ['embed', 'shorts', 'live', 'v'].includes(parts[0])) {
    candidate = parts[1]
  } else {
    candidate = parsed.searchParams.get('v')
  }
  return candidate && YOUTUBE_ID.test(candidate) ? candidate : null
}

/** Canonical watch URL for a video id, the form both the editor and the API accept. */
export function youtubeWatchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`
}

/**
 * Removes rich nodes (embeds) from a tiptap document, replacing each with a
 * paragraph holding the original link. Used when a community does not allow
 * rich content so older posts still render as text instead of an empty
 * document (tiptap discards a whole document containing an unknown node).
 */
export function stripRichContent(doc: any): any {
  if (!doc || typeof doc !== 'object') return doc

  const visit = (node: any): any[] => {
    if (!node || typeof node !== 'object') return [node]
    if (RICH_NODE_TYPES.has(node.type)) {
      const src = typeof node.attrs?.src === 'string' ? node.attrs.src : ''
      if (!src) return []
      return [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: src, marks: [{ type: 'link', attrs: { href: src } }] },
          ],
        },
      ]
    }
    if (!Array.isArray(node.content)) return [node]
    return [{ ...node, content: node.content.flatMap(visit) }]
  }

  const [stripped] = visit(doc)
  return stripped
}

/** True when a tiptap document contains at least one rich (embed) node. */
export function hasRichContent(doc: any): boolean {
  if (!doc || typeof doc !== 'object') return false
  if (RICH_NODE_TYPES.has(doc.type)) return true
  return Array.isArray(doc.content) && doc.content.some(hasRichContent)
}
