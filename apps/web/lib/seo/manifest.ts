/**
 * Per-org Web App Manifest: installable on phones with the org's own name,
 * colors and icon (never LearnHouse branding on a white-label org).
 */
export type ManifestInput = {
  name: string
  description?: string | null
  lang?: string
  themeColor?: string
  icons: { src: string; type?: string; purpose?: string }[]
}

export function imageMime(src: string): string | undefined {
  const ext = src.toLowerCase().split('?')[0].split('.').pop()
  return ({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', svg: 'image/svg+xml', ico: 'image/x-icon', gif: 'image/gif' } as Record<string, string>)[ext || '']
}

/** Short name for home screens: Chrome truncates past ~12 characters. */
export function shortName(name: string): string {
  const clean = name.replace(/\s+/g, ' ').trim()
  if (clean.length <= 12) return clean
  const first = clean.split(' ')[0]
  return first.length <= 12 ? first : clean.slice(0, 12)
}

export function buildManifest(input: ManifestInput) {
  const seen = new Set<string>()
  const icons = input.icons
    .filter((i) => i.src && !seen.has(i.src) && seen.add(i.src))
    .map((i) => ({ src: i.src, sizes: 'any', ...(i.type || imageMime(i.src) ? { type: i.type || imageMime(i.src) } : {}), ...(i.purpose ? { purpose: i.purpose } : {}) }))
  return {
    name: input.name,
    short_name: shortName(input.name),
    ...(input.description ? { description: input.description.slice(0, 300) } : {}),
    lang: input.lang || 'en',
    start_url: '/',
    scope: '/',
    id: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: input.themeColor || '#ffffff',
    ...(icons.length ? { icons } : {}),
  }
}
