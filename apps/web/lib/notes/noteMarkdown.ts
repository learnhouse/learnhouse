/**
 * Learner notes as Markdown (export) and the small text helpers the notes UI
 * shares: timestamps, word counts, an empty-document check.
 */

type Node = { type?: string; text?: string; attrs?: Record<string, any>; marks?: { type: string; attrs?: any }[]; content?: Node[] }

export function formatTimestamp(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds || 0))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`
}

export function countWords(text: string): number {
  const trimmed = (text || '').trim()
  if (!trimmed) return 0
  // CJK scripts don't separate words with spaces: count their characters.
  const cjk = trimmed.match(/[぀-ヿ㐀-䶿一-鿿가-힯]/g)?.length ?? 0
  const rest = trimmed.replace(/[぀-ヿ㐀-䶿一-鿿가-힯]/g, ' ')
  const words = rest.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length
  return words + cjk
}

export function isEmptyDoc(doc: Node | null | undefined): boolean {
  const walk = (n: Node | undefined): boolean => {
    if (!n) return true
    if (n.type === 'text') return !(n.text || '').trim()
    if (n.type === 'horizontalRule') return false
    return (n.content ?? []).every(walk)
  }
  return walk(doc ?? undefined)
}

function escapeMd(text: string): string {
  return text.replace(/([\\`*_[\]])/g, '\\$1')
}

function inline(nodes: Node[] = []): string {
  return nodes
    .map((n) => {
      if (n.type === 'hardBreak') return '  \n'
      if (n.type !== 'text') return ''
      let out = escapeMd(n.text || '')
      const marks = n.marks ?? []
      if (marks.some((m) => m.type === 'code')) out = '`' + (n.text || '').replace(/`/g, "'") + '`'
      if (marks.some((m) => m.type === 'bold')) out = `**${out}**`
      if (marks.some((m) => m.type === 'italic')) out = `*${out}*`
      if (marks.some((m) => m.type === 'strike')) out = `~~${out}~~`
      const link = marks.find((m) => m.type === 'link')
      if (link?.attrs?.href) out = `[${out}](${String(link.attrs.href).replace(/\)/g, '%29')})`
      return out
    })
    .join('')
}

function block(node: Node, indent = ''): string[] {
  const kids = node.content ?? []
  switch (node.type) {
    case 'paragraph':
      return [indent + inline(kids)]
    case 'heading': {
      const level = Math.min(6, Math.max(1, Number(node.attrs?.level) || 3) + 2)
      return [`${indent}${'#'.repeat(level)} ${inline(kids)}`]
    }
    case 'blockquote':
      return kids.flatMap((k) => block(k)).map((line) => `${indent}> ${line}`.trimEnd())
    case 'horizontalRule':
      return [`${indent}---`]
    case 'bulletList':
    case 'orderedList':
    case 'taskList': {
      const start = Number(node.attrs?.start) || 1
      return kids.flatMap((item, i) => {
        const marker =
          node.type === 'orderedList'
            ? `${start + i}.`
            : node.type === 'taskList'
              ? `- [${item.attrs?.checked ? 'x' : ' '}]`
              : '-'
        const [first = '', ...rest] = (item.content ?? []).flatMap((k) => block(k, ''))
        const pad = ' '.repeat(marker.length + 1)
        return [`${indent}${marker} ${first}`, ...rest.map((l) => `${indent}${pad}${l}`)]
      })
    }
    default:
      return kids.flatMap((k) => block(k, indent))
  }
}

export function docToMarkdown(doc: Node | null | undefined): string {
  if (!doc) return ''
  const parts = (doc.content ?? []).map((n) => block(n).join('\n'))
  return parts.filter((p) => p.trim() !== '').join('\n\n')
}

export type MarkdownNote = {
  content: Node
  anchor?: { kind: string; label?: string | null; seconds?: number | null } | null
  updated_at: string
  activity: { name: string; chapter_name?: string | null; url?: string }
}

/** One course's notes, grouped by lesson in the order given. */
export function notesToMarkdown(
  courseName: string,
  notes: MarkdownNote[],
  labels: { exported: string; at: (_time: string) => string },
  exportedAt: string
): string {
  const lines: string[] = [`# ${courseName}`, '', `_${labels.exported} ${exportedAt}_`]
  let lesson: string | null = null
  for (const note of notes) {
    if (note.activity.name !== lesson) {
      lesson = note.activity.name
      const chapter = note.activity.chapter_name ? `${note.activity.chapter_name} · ` : ''
      const title = note.activity.url ? `[${escapeMd(lesson)}](${note.activity.url})` : escapeMd(lesson)
      lines.push('', `## ${chapter}${title}`)
    }
    const anchor = note.anchor
    const where =
      anchor?.kind === 'video' && anchor.seconds != null
        ? labels.at(formatTimestamp(anchor.seconds))
        : anchor?.label
          ? `§ ${anchor.label}`
          : ''
    lines.push('')
    if (where) lines.push(`**${escapeMd(where)}**`, '')
    lines.push(docToMarkdown(note.content) || '_…_')
  }
  return lines.join('\n') + '\n'
}
