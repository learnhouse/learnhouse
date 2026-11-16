/**
 * Markdown for AI search and LLM tools: Markdown alternates of public pages
 * (`/course/x.md`) and the org's `/llms.txt` / `/llms-full.txt`. Pure
 * functions over the API's anonymous-safe data; the API already dropped
 * anything private, sold or noindexed.
 */
import { clipDescription, parseLearnings } from './meta'

type PMNode = { type?: string; text?: string; attrs?: Record<string, any>; marks?: { type: string; attrs?: Record<string, any> }[]; content?: PMNode[] }

const MAX_MD = 200_000

// Only what would turn text into links or HTML; emphasis characters stay
// readable (`snake_case`, 2*3) since this is read by people and models.
function escapeInline(text: string): string {
  return text.replace(/([\\[\]<>])/g, '\\$1')
}

function safeUrl(url: unknown): string | null {
  const value = String(url ?? '').trim()
  return /^(https?:|mailto:|\/)/i.test(value) ? value.replace(/[()\s]/g, (c) => encodeURIComponent(c)) : null
}

function inline(nodes: PMNode[] | undefined): string {
  return (nodes || [])
    .map((n) => {
      if (n.type === 'hardBreak') return '  \n'
      if (n.type === 'text') {
        let t = escapeInline(n.text || '')
        const marks = n.marks || []
        if (marks.some((m) => m.type === 'code')) t = `\`${(n.text || '').replace(/`/g, 'ˋ')}\``
        if (marks.some((m) => m.type === 'bold')) t = `**${t}**`
        if (marks.some((m) => m.type === 'italic')) t = `*${t}*`
        if (marks.some((m) => m.type === 'strike')) t = `~~${t}~~`
        const link = marks.find((m) => m.type === 'link')
        const href = link && safeUrl(link.attrs?.href)
        if (href) t = `[${t}](${href})`
        return t
      }
      if (n.type === 'mention') return `@${n.attrs?.label || n.attrs?.id || ''}`
      if (n.type === 'math' || n.type === 'inlineMath') return `$${n.attrs?.latex || n.attrs?.math || ''}$`
      return inline(n.content)
    })
    .join('')
}

function block(node: PMNode, depth = 0): string {
  const indent = '  '.repeat(depth)
  switch (node.type) {
    case 'doc':
      return blocks(node.content, depth)
    case 'paragraph': {
      const text = inline(node.content).trim()
      return text ? `${indent}${text}` : ''
    }
    case 'heading': {
      const level = Math.min(6, Math.max(2, Number(node.attrs?.level) + 1 || 2))
      return `${'#'.repeat(level)} ${inline(node.content).trim()}`
    }
    case 'bulletList':
    case 'taskList':
      return (node.content || [])
        .map((li) => `${indent}- ${blocks(li.content, depth + 1).trimStart()}`)
        .join('\n')
    case 'orderedList':
      return (node.content || [])
        .map((li, i) => `${indent}${(Number(node.attrs?.start) || 1) + i}. ${blocks(li.content, depth + 1).trimStart()}`)
        .join('\n')
    case 'blockquote':
      return blocks(node.content, depth)
        .split('\n')
        .map((l) => `> ${l}`)
        .join('\n')
    case 'codeBlock': {
      const lang = String(node.attrs?.language || '').replace(/[^\w+-]/g, '')
      const code = (node.content || []).map((c) => c.text || '').join('')
      return `\`\`\`${lang}\n${code.replace(/```/g, 'ˋˋˋ')}\n\`\`\``
    }
    case 'horizontalRule':
      return '---'
    case 'image':
    case 'blockImage': {
      const src = safeUrl(node.attrs?.src)
      return src ? `![${escapeInline(String(node.attrs?.alt || ''))}](${src})` : ''
    }
    case 'table':
      return table(node)
    default: {
      // Custom blocks (callouts, embeds, quizzes...): keep their readable text
      // and any public link they point to.
      const inner = blocks(node.content, depth)
      const src = safeUrl(node.attrs?.src || node.attrs?.url || node.attrs?.href)
      const label = node.attrs?.title || node.attrs?.name
      if (!inner && src) return `[${escapeInline(String(label || src))}](${src})`
      return inner
    }
  }
}

function table(node: PMNode): string {
  const rows = (node.content || []).map((row) => (row.content || []).map((cell) => blocks(cell.content).replace(/\n+/g, ' ').replace(/\|/g, '\\|').trim()))
  if (!rows.length) return ''
  const width = Math.max(...rows.map((r) => r.length))
  const pad = (r: string[]) => [...r, ...Array(width - r.length).fill('')]
  const [head, ...rest] = rows
  return [`| ${pad(head).join(' | ')} |`, `| ${Array(width).fill('---').join(' | ')} |`, ...rest.map((r) => `| ${pad(r).join(' | ')} |`)].join('\n')
}

function blocks(nodes: PMNode[] | undefined, depth = 0): string {
  return (nodes || [])
    .map((n) => block(n, depth))
    .filter((s) => s.trim() !== '')
    .join(depth ? '\n' : '\n\n')
}

/** Markdown of a ProseMirror/Tiptap document (object or JSON string). Plain text passes through. */
export function pmToMarkdown(doc: unknown): string {
  let node: any = doc
  if (typeof doc === 'string') {
    const trimmed = doc.trim()
    if (!trimmed) return ''
    try {
      node = JSON.parse(trimmed)
    } catch {
      return trimmed.slice(0, MAX_MD)
    }
  }
  if (!node || typeof node !== 'object') return ''
  return block(node.type ? node : { type: 'doc', content: node.content || [] }).trim().slice(0, MAX_MD)
}

function oneLine(text?: string | null, max = 200): string {
  return clipDescription(text || '', max).replace(/\n/g, ' ')
}

function mdLink(name: string, url: string, note?: string | null): string {
  const label = escapeInline(name.replace(/\s+/g, ' ').trim() || url)
  const line = `- [${label}](${url})`
  const desc = oneLine(note, 220)
  return desc ? `${line}: ${desc}` : line
}

function frontmatter(fields: Record<string, string | number | undefined | null>): string {
  const lines = Object.entries(fields)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}: ${JSON.stringify(String(v))}`)
  return `---\n${lines.join('\n')}\n---\n\n`
}

function dateOnly(value?: string | null): string | undefined {
  const m = String(value || '').match(/^\d{4}-\d{2}-\d{2}/)
  return m ? m[0] : undefined
}

export type MdContext = {
  /** Absolute origin, no trailing slash. */
  base: string
  /** Canonical HTML URL of the page this Markdown mirrors. */
  canonical: string
}

const enc = encodeURIComponent

/** Markdown alternate of one public page (shape: API `/seo/markdown/...`). */
export function markdownFor(data: any, ctx: MdContext): string {
  const org = data?.org?.name || ''
  const head = (title: string, extra: Record<string, any> = {}) =>
    frontmatter({ title, source: ctx.canonical, site: org, ...extra })
  switch (data?.type) {
    case 'course': {
      const c = data.course
      const out = [head(c.name, { updated: dateOnly(c.updated), language: c.language || undefined }), `# ${c.name}`, '']
      if (c.description) out.push(c.description, '')
      if (c.authors?.length) out.push(`Instructors: ${c.authors.join(', ')}`, '')
      const learnings = parseLearnings(c.learnings)
      if (learnings.length) out.push('## What you will learn', '', ...learnings.map((l: string) => `- ${l}`), '')
      if (c.about) out.push('## About this course', '', pmToMarkdown(c.about), '')
      out.push(...outlineMd(c.key, c.outline || [], ctx.base))
      return finish(out)
    }
    case 'activity': {
      const c = data.course
      const a = data.activity
      const out = [head(a.name, { course: c.name, updated: dateOnly(a.updated) }), `# ${a.name}`, '']
      out.push(`Part of [${escapeInline(c.name)}](${ctx.base}/course/${enc(c.key)})${a.chapter ? `, chapter “${a.chapter}”` : ''}.`, '')
      const body = pmToMarkdown(a.content)
      if (body) out.push(body, '')
      else out.push(`This lesson is a ${String(a.type || '').replace('TYPE_', '').toLowerCase()} activity. Open it on the website: ${ctx.canonical}`, '')
      return finish(out)
    }
    case 'path': {
      const p = data.path
      const out = [head(p.name), `# ${p.name}`, '']
      if (p.description) out.push(p.description, '')
      if (p.level) out.push(`Level: ${p.level}`, '')
      if (p.about) out.push(pmToMarkdown(p.about), '')
      if (p.courses?.length) {
        out.push('## Courses in this path', '')
        p.courses.forEach((c: any, i: number) => out.push(`${i + 1}. [${escapeInline(c.name)}](${ctx.base}/course/${enc(c.key)})${c.required === false ? ' (elective)' : ''}${c.description ? `: ${oneLine(c.description)}` : ''}`))
        out.push('')
      }
      return finish(out)
    }
    case 'podcast': {
      const p = data.podcast
      const out = [head(p.name), `# ${p.name}`, '']
      if (p.description) out.push(p.description, '')
      if (p.about) out.push(pmToMarkdown(p.about), '')
      if (p.episodes?.length) {
        out.push('## Episodes', '')
        for (const e of p.episodes) {
          const mins = e.duration_seconds ? ` (${Math.max(1, Math.round(e.duration_seconds / 60))} min)` : ''
          out.push(`### ${e.number ? `${e.number}. ` : ''}${e.title}${mins}`, '')
          if (e.description) out.push(pmToMarkdown(e.description), '')
        }
      }
      return finish(out)
    }
    case 'community': {
      const c = data.community
      const out = [head(c.name), `# ${c.name}`, '']
      if (c.description) out.push(c.description, '')
      if (data.threads?.length) {
        out.push('## Recent discussions', '')
        for (const t of data.threads) {
          out.push(`- [${escapeInline(t.title)}](${ctx.base}/community/${enc(c.key)}/${t.segment}) · ${t.replies} ${t.replies === 1 ? 'reply' : 'replies'}${t.answered ? ' · answered' : ''}`)
        }
        out.push('')
      }
      return finish(out)
    }
    case 'thread': {
      const c = data.community
      const t = data.thread
      const out = [head(t.title, { community: c.name, author: t.author, published: dateOnly(t.published) }), `# ${t.title}`, '']
      out.push(`Asked in [${escapeInline(c.name)}](${ctx.base}/community/${enc(c.key)})${t.author ? ` by ${t.author}` : ''}${dateOnly(t.published) ? ` on ${dateOnly(t.published)}` : ''} · ${t.upvotes} upvotes`, '')
      const body = pmToMarkdown(t.content)
      if (body) out.push(body, '')
      const comments = t.comments || []
      const accepted = comments.find((x: any) => x.accepted)
      if (accepted) out.push('## Accepted answer', '', `**${accepted.author || 'Member'}** (${accepted.upvotes} upvotes):`, '', pmToMarkdown(accepted.content), '')
      const rest = comments.filter((x: any) => !x.accepted)
      if (rest.length) {
        out.push(`## Replies (${rest.length})`, '')
        for (const r of rest) out.push(`**${r.author || 'Member'}**${dateOnly(r.published) ? ` · ${dateOnly(r.published)}` : ''} · ${r.upvotes} upvotes`, '', pmToMarkdown(r.content), '')
      }
      return finish(out)
    }
    default:
      return ''
  }
}

function outlineMd(courseKey: string, outline: any[], base: string): string[] {
  if (!outline.length) return []
  const out = ['## Course outline', '']
  let chapter: string | null = null
  for (const a of outline) {
    if (a.chapter !== chapter) {
      chapter = a.chapter
      out.push(`### ${chapter}`, '')
    }
    out.push(a.public ? `- [${escapeInline(a.name)}](${base}/course/${enc(courseKey)}/activity/${enc(a.key)})` : `- ${escapeInline(a.name)} (members only)`)
  }
  out.push('')
  return out
}

function finish(lines: string[]): string {
  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`.slice(0, MAX_MD)
}

/**
 * `/llms.txt` (llmstxt.org): the org in one paragraph, then sections of links
 * to its public content, each with a one-line description. `full` (for
 * `/llms-full.txt`) adds course outlines, episodes and top threads.
 */
export function buildLlmsTxt(data: any, base: string, opts: { full?: boolean; extra?: { title: string; links: { name: string; url: string; note?: string }[] }[] } = {}): string {
  const org = data.org || {}
  const summary = oneLine(data.seo?.default_meta_description || org.description || org.about || `${org.name} learning platform`, 400)
  const out: string[] = [`# ${org.name}`, '', `> ${summary}`, '']
  if (org.about && org.about !== org.description) out.push(oneLine(org.about, 1200), '')
  out.push(
    `Learning content from ${org.name}. Every link below is a public page; most have a Markdown version at the same URL with \`.md\` appended.`,
    '',
  )
  const section = (title: string, lines: string[]) => {
    if (lines.length) out.push(`## ${title}`, '', ...lines, '')
  }
  section(
    'Courses',
    (data.courses || []).flatMap((c: any) => {
      const lines = [mdLink(c.name, `${base}/course/${enc(c.key)}`, c.description)]
      if (opts.full) {
        if (c.authors?.length) lines.push(`  - Instructors: ${c.authors.join(', ')}`)
        for (const a of (c.outline || []).filter((x: any) => x.public)) lines.push(`  - [${escapeInline(a.name)}](${base}/course/${enc(c.key)}/activity/${enc(a.key)})`)
      }
      return lines
    }),
  )
  section(
    'Learning paths',
    (data.paths || []).flatMap((p: any) => [
      mdLink(p.name, `${base}/path/${enc(p.key)}`, p.description),
      ...(opts.full ? (p.courses || []).map((c: any) => `  - ${escapeInline(c.name)}${c.required === false ? ' (elective)' : ''}`) : []),
    ]),
  )
  section(
    'Podcasts',
    (data.podcasts || []).flatMap((p: any) => [
      mdLink(p.name, `${base}/podcast/${enc(p.key)}`, p.description),
      ...(opts.full ? (p.episodes || []).map((e: any) => `  - ${e.number ? `${e.number}. ` : ''}${escapeInline(e.title)}`) : []),
    ]),
  )
  section(
    'Communities',
    (data.communities || []).flatMap((c: any) => [
      mdLink(c.name, `${base}/community/${enc(c.key)}`, c.description),
      ...(opts.full ? (c.threads || []).map((t: any) => `  - [${escapeInline(t.title)}](${base}/community/${enc(c.key)}/${t.segment})${t.answered ? ' (answered)' : ''}`) : []),
    ]),
  )
  section('Library', (data.folders || []).map((f: any) => mdLink(f.name, `${base}/library/folder/${enc(f.key)}`, f.description)))
  for (const extra of opts.extra || []) section(extra.title, extra.links.map((l) => mdLink(l.name, l.url, l.note)))
  const optional = [`- [Sitemap](${base}/sitemap.xml)`, `- [What's new (RSS)](${base}/feed.xml)`]
  if (!opts.full) optional.unshift(`- [Full content index](${base}/llms-full.txt): every public lesson, episode and top discussion`)
  section('Optional', optional)
  return `${out.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`
}

/** Public HTML path → the Markdown alternate's path (`/course/x` → `/course/x.md`). */
export function markdownPath(htmlPath: string): string {
  const clean = htmlPath.split(/[?#]/)[0].replace(/\/+$/, '')
  return clean ? `${clean}.md` : '/index.md'
}

export { parseMarkdownPath } from './publicRoutes'

/** Canonical HTML path of the page a Markdown payload describes (current slugs). */
export function canonicalPathFor(data: any): string | null {
  switch (data?.type) {
    case 'course':
      return `/course/${enc(data.course.key)}`
    case 'activity':
      return `/course/${enc(data.course.key)}/activity/${enc(data.activity.key)}`
    case 'path':
      return `/path/${enc(data.path.key)}`
    case 'podcast':
      return `/podcast/${enc(data.podcast.key)}`
    case 'community':
      return `/community/${enc(data.community.key)}`
    case 'thread':
      return `/community/${enc(data.community.key)}/${data.thread.segment}`
    default:
      return null
  }
}
