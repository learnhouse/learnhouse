/* Where an embed block's iframe points. Pure, unit tested. */

// Legacy render path: blocks saved before smart paste stored the raw link and
// only YouTube was rewritten at render time. Kept as-is so they look the same.
export const getYouTubeEmbedUrl = (url: string): string => {
  try {
    const parsedUrl = new URL(url)
    const isYoutubeHostname =
      parsedUrl.hostname === 'youtube.com' ||
      parsedUrl.hostname === 'www.youtube.com' ||
      parsedUrl.hostname === 'youtu.be' ||
      parsedUrl.hostname === 'www.youtu.be'
    if (!isYoutubeHostname) return url
    const youtubeRegex = /(?:youtube\.com\/(?:[^/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?/\s]{11})/i
    const match = url.match(youtubeRegex)
    if (match && match[1] && match[1].length === 11) {
      return `https://www.youtube.com/embed/${match[1]}?autoplay=0&rel=0`
    }
    return url
  } catch {
    return url
  }
}

/** The iframe src for a stored embed: new blocks store it ready to use. */
export function resolveEmbedSrc(embedUrl: string, provider: string | null | undefined): string {
  return provider ? embedUrl : getYouTubeEmbedUrl(embedUrl)
}

