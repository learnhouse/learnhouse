/**
 * Discussions store their body as a tiptap/ProseMirror JSON document
 * ({"type":"doc","content":[…]}). Old posts may also be plain strings.
 * Return a flat preview string either way.
 */
export function extractPreviewText(raw: string | undefined | null): string {
  if (!raw) return ''
  const trimmed = raw.trim()
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return trimmed

  try {
    const parsed = JSON.parse(trimmed)
    const parts: string[] = []
    const walk = (node: any): void => {
      if (!node) return
      if (typeof node === 'string') {
        parts.push(node)
        return
      }
      if (Array.isArray(node)) {
        node.forEach(walk)
        return
      }
      if (typeof node.text === 'string') parts.push(node.text)
      if (node.content) walk(node.content)
    }
    walk(parsed)
    return parts.join(' ').replace(/\s+/g, ' ').trim()
  } catch {
    return trimmed
  }
}
