/** Gallery filters (pure, unit tested in tests/landing-v2.test.mjs). */

export interface GalleryTemplate {
  id: string
  name: string
  description: string
  category?: string
  scheme?: 'light' | 'dark'
  tags?: string[]
  legacy?: boolean
}

/** Templates for the gallery: legacy recipe templates are left out. */
export function galleryTemplates<T extends GalleryTemplate>(templates: T[]): T[] {
  return templates.filter((t) => !t.legacy)
}

/** Category, light/dark and text filters; `label` adds the translated name to the search. */
export function filterTemplates<T extends GalleryTemplate>(templates: T[], f: { category?: string; scheme?: string; query?: string }, label?: (_t: T) => string): T[] {
  const q = (f.query || '').trim().toLowerCase()
  return templates.filter((t) => {
    if (f.category && f.category !== 'all' && t.category !== f.category) return false
    if (f.scheme && f.scheme !== 'all' && (t.scheme || 'light') !== f.scheme) return false
    if (q) {
      const hay = [t.id, t.name, t.description, t.category, ...(t.tags || []), label ? label(t) : ''].join(' ').toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
}
