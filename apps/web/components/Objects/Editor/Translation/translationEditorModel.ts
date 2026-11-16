// Pure helpers for editing an activity translation (per-locale collab room,
// locale-scoped API calls). Unit tested in tests/activity-translation-editor.test.mjs.

/** Collab room of an activity: `activity:{uuid}` (source) or `activity:{uuid}:{locale}`. */
export function activityRoomName(activityUuid: string, locale?: string | null): string {
  return locale ? `activity:${activityUuid}:${locale}` : `activity:${activityUuid}`
}

/** `url` with `locale=` added (no-op without a locale). */
export function withLocaleQuery(url: string, locale?: string | null): string {
  if (!locale) return url
  return `${url}${url.includes('?') ? '&' : '?'}locale=${encodeURIComponent(locale)}`
}

export type TranslationBanner = 'none' | 'outdated'

/** Which notice the translation pane shows above the editor. */
export function translationBanner(t: { outdated?: boolean } | null | undefined): TranslationBanner {
  return t?.outdated ? 'outdated' : 'none'
}

/** Version numbers to compare in the history diff, or null when unknown. */
export function sourceDiffRange(t: { source_version?: number | null; current_source_version?: number | null } | null | undefined) {
  const from = t?.source_version
  const to = t?.current_source_version
  if (typeof from !== 'number' || typeof to !== 'number' || from >= to) return null
  return { from, to }
}

/**
 * Plain text of a ProseMirror document, one line per block (text nodes and
 * the text-like attrs Atlas also translates: alt, title, caption, summary).
 * Used for the "what changed in the source" diff.
 */
export function docPlainText(doc: unknown): string {
  const lines: string[] = []
  const TEXT_ATTRS = ['alt', 'title', 'caption', 'summary', 'question', 'label']
  const walk = (node: any): string => {
    if (!node || typeof node !== 'object') return ''
    if (node.type === 'text') return String(node.text ?? '')
    const children = Array.isArray(node.content) ? node.content : []
    const inline = children.every((c: any) => c?.type === 'text' || c?.type === 'hardBreak' || !c?.content)
    const attrs = node.attrs && typeof node.attrs === 'object' ? node.attrs : {}
    for (const key of TEXT_ATTRS) {
      if (typeof attrs[key] === 'string' && attrs[key].trim()) lines.push(attrs[key].trim())
    }
    if (inline && children.length) {
      const text = children.map((c: any) => (c?.type === 'hardBreak' ? '\n' : walk(c))).join('')
      if (text.trim()) lines.push(text.trim())
      return ''
    }
    children.forEach((c: any) => {
      const text = walk(c)
      if (text.trim()) lines.push(text.trim())
    })
    return ''
  }
  walk(doc)
  return lines.join('\n')
}
