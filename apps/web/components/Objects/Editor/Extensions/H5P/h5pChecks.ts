/*
 Author-facing checks for an H5P embed URL, on top of normalizeH5PUrl
 (lib/media/h5pUrl). Pure, unit tested in tests/editor-blocks-embeds.test.mjs.

 None of these refuse a URL the normalizer accepted (self-hosted H5P comes in
 every shape); they tell the author when the frame is likely to stay blank.
*/

export type H5PFrameProblem = 'mixed_content' | 'same_site' | null

/**
 * A reason the browser itself will refuse to show the frame.
 * - mixed_content: an http:// frame on an https:// lesson is blocked outright.
 * - same_site: pointing the block at this LearnHouse site would frame our own
 *   pages (it renders a login or a lesson, never an activity).
 */
export function frameProblemFor(url: string, pageOrigin: string | null | undefined): H5PFrameProblem {
  if (!url) return null
  let target: URL
  try {
    target = new URL(url)
  } catch {
    return null
  }
  if (!pageOrigin) return null
  let page: URL
  try {
    page = new URL(pageOrigin)
  } catch {
    return null
  }
  if (target.origin === page.origin) return 'same_site'
  const localTarget = target.hostname === 'localhost' || target.hostname === '127.0.0.1'
  if (page.protocol === 'https:' && target.protocol === 'http:' && !localTarget) return 'mixed_content'
  return null
}

/**
 * True when the URL looks like an H5P embed endpoint rather than a content
 * page. Mirrors the shapes normalizeH5PUrl recognises; anything else may still
 * work (it's a hint, not a rule).
 */
export function looksLikeH5PEmbed(url: string): boolean {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return false
  }
  const path = u.pathname.replace(/\/+$/, '').toLowerCase()
  if (path.endsWith('/embed') || path.includes('/embed/') || path.endsWith('/embed.php')) return true
  if ((u.searchParams.get('action') || '').toLowerCase() === 'h5p_embed') return true
  if (u.searchParams.has('embed')) return true
  return false
}

/** The page a learner can open in a new tab: the content page, not the bare embed. */
export function openableH5PUrl(url: string): string {
  try {
    const u = new URL(url)
    const host = u.hostname.toLowerCase()
    if ((host === 'h5p.com' || host.endsWith('.h5p.com')) && /\/content\/[^/]+\/embed\/?$/i.test(u.pathname)) {
      u.pathname = u.pathname.replace(/\/embed\/?$/i, '')
    }
    return u.toString()
  } catch {
    return url
  }
}
