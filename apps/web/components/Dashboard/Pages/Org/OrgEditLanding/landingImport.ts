import { LandingPageSettings, LandingSection } from './landing_types'

export const LANDING_SECTION_TYPES = [
  'hero', 'text-and-image', 'logos', 'people', 'featured-courses', 'video',
  'rich-text', 'features', 'stats', 'testimonials', 'faq', 'cta', 'gallery', 'spacer',
  'pricing', 'steps', 'columns', 'image', 'embed', 'banner', 'countdown',
] as const

const MAX_SECTIONS = 60

/**
 * Parse an exported landing file. Returns null unless it is an object with a
 * `sections` array whose every entry has a known `type`, so a random JSON file
 * can never replace the page with something the renderer does not understand.
 */
export function parseLandingImport(text: string): { sections: LandingSection[]; settings?: LandingPageSettings } | null {
  let data: any
  try {
    data = JSON.parse(text)
  } catch {
    return null
  }
  const sections = data?.sections
  if (!Array.isArray(sections) || sections.length === 0 || sections.length > MAX_SECTIONS) return null
  const known = new Set<string>(LANDING_SECTION_TYPES)
  if (!sections.every((section) => section && typeof section === 'object' && known.has(section.type))) return null
  const settings = data.settings && typeof data.settings === 'object' && !Array.isArray(data.settings) ? data.settings : undefined
  return { sections, settings }
}
