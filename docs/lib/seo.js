// Search results show about 155 characters of a meta description. Cut longer
// ones at the last sentence or word boundary that fits, instead of letting the
// search engine truncate mid-word or replace the description with page text.
export function clampDescription(text, max = 158) {
  if (!text) return text
  const clean = text.replace(/\s+/g, ' ').trim()
  if (clean.length <= max) return clean
  const cut = clean.slice(0, max)
  const sentence = cut.match(/^(.*[.!?])\s/)
  if (sentence && sentence[1].length >= max * 0.6) return sentence[1]
  return cut.replace(/[\s,;:—–-]+\S*$/, '').replace(/[,;:]$/, '') + '…'
}

const SITE_URL = 'https://docs.learnhouse.app'

/** Open Graph and Twitter tags for a page. Without them a page inherits the home page's. */
export function socialMetadata({ title, description, path, image = '/og' }) {
  // Generated /og cards are 1200x630; other images keep their own size.
  const size = image.startsWith('/og') ? { width: 1200, height: 630 } : {}
  const images = [{ url: `${SITE_URL}${image}`, ...size, alt: title }]
  return {
    openGraph: { type: 'article', title, description, url: `${SITE_URL}${path}`, siteName: 'LearnHouse Docs', images },
    twitter: { card: 'summary_large_image', title, description, images: [images[0].url] },
  }
}
