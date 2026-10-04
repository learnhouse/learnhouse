/*
 Turn a user-pasted URL into something an <iframe> can actually render.

 Shared by the Embed activity and the Library media viewer, so an EMBED media
 row plays in-app instead of sending the user off to the original site.
*/

/** Extract a YouTube video id from common URL shapes, or null. */
export function youTubeId(url: string): string | null {
  try {
    const u = new URL(url)
    const host = u.hostname.replace(/^www\./, '')
    if (host === 'youtu.be') {
      return u.pathname.split('/').filter(Boolean)[0] || null
    }
    if (host.endsWith('youtube.com') || host.endsWith('youtube-nocookie.com')) {
      const v = u.searchParams.get('v')
      if (v) return v
      const parts = u.pathname.split('/').filter(Boolean)
      const i = parts.findIndex((p) => p === 'embed' || p === 'shorts' || p === 'v')
      if (i !== -1 && parts[i + 1]) return parts[i + 1]
    }
  } catch {
    /* not a parseable URL */
  }
  return null
}

/** Vimeo video id, or null. */
export function vimeoId(url: string): string | null {
  try {
    const u = new URL(url)
    if (!u.hostname.replace(/^www\./, '').endsWith('vimeo.com')) return null
    const id = u.pathname.split('/').filter(Boolean).find((p) => /^\d+$/.test(p))
    return id || null
  } catch {
    return null
  }
}

/**
 Private-link hash of an unlisted Vimeo video, or null. Vimeo refuses to embed
 such a video without it, so it has to survive the rewrite to the player URL.
 It arrives as `?h=<hash>` on player links and as the path segment after the
 id on share links (`vimeo.com/<id>/<hash>`).
*/
export function vimeoHash(url: string, id: string): string | null {
  try {
    const u = new URL(url)
    const h = u.searchParams.get('h')
    if (h && /^[a-z0-9]+$/i.test(h)) return h
    const parts = u.pathname.split('/').filter(Boolean)
    const next = parts[parts.indexOf(id) + 1]
    if (next && /^[a-f0-9]{6,}$/i.test(next)) return next
  } catch {
    /* not a parseable URL */
  }
  return null
}

export function toEmbedUrl(url: string): string {
  const yt = youTubeId(url)
  if (yt) return `https://www.youtube.com/embed/${yt}?autoplay=0&rel=0`

  const vimeo = vimeoId(url)
  if (vimeo) {
    const hash = vimeoHash(url, vimeo)
    return `https://player.vimeo.com/video/${vimeo}${hash ? `?h=${hash}` : ''}`
  }

  // Google Docs/Sheets/Slides → preview
  const googleDocMatch = url.match(
    /^(https?:\/\/docs\.google\.com\/(?:document|spreadsheets|presentation)\/d\/[^/]+)/
  )
  if (googleDocMatch) {
    return `${googleDocMatch[1]}/preview`
  }

  // Google Forms → embedded
  const googleFormMatch = url.match(
    /^(https?:\/\/docs\.google\.com\/forms\/d\/[^/]+)/
  )
  if (googleFormMatch) {
    return `${googleFormMatch[1]}/viewform?embedded=true`
  }

  // Figma → embed host
  if (/^https?:\/\/(www\.)?figma\.com\//.test(url)) {
    return `https://www.figma.com/embed?embed_host=learnhouse&url=${encodeURIComponent(url)}`
  }

  // Loom → /share/ to /embed/
  const loomMatch = url.match(/^(https?:\/\/www\.loom\.com)\/share\/(.+)$/)
  if (loomMatch) {
    return `${loomMatch[1]}/embed/${loomMatch[2]}`
  }

  // Canva design → embed
  if (url.includes('canva.com/design/')) {
    return url.includes('?') ? `${url}&embed` : `${url}?embed`
  }

  // Miro → embed
  const miroMatch = url.match(/^(https?:\/\/miro\.com\/app\/board\/)(.+)$/)
  if (miroMatch) {
    return `https://miro.com/app/live-embed/${miroMatch[2]}`
  }

  return url
}
