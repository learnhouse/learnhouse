// A small markdown subset rendered as React elements: paragraphs, headings,
// lists, fenced code, tables, quotes, **bold**, *italic*, `code` and
// [links](…). Server text is never injected as HTML; React escapes it.
import React from 'react'
import type { ReactNode } from 'react'

/** http(s), mailto, or a relative path; anything else (javascript:, data:…) is not linked. */
export function safeHref(raw: string, base?: string): string | undefined {
  const href = raw.trim()
  if (/^(https?:|mailto:)/i.test(href)) return href
  if (href.startsWith('/') && !href.startsWith('//') && !href.includes('\\')) {
    return base ? `${base.replace(/\/+$/, '')}${href}` : href
  }
  if (href.startsWith('#')) return href
  return undefined
}

export interface MarkdownOptions {
  linkBase?: string
  linkTarget?: string
}

const INLINE = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*|__[^_\n]+__)|(\*[^*\s][^*\n]*\*|_[^_\s][^_\n]*_)|(\[[^\]\n]+\]\([^)\s]+\))/g

export function inline(text: string, opts: MarkdownOptions = {}, keyBase = 'i'): ReactNode[] {
  const out: ReactNode[] = []
  let last = 0
  let n = 0
  for (const m of text.matchAll(INLINE)) {
    const at = m.index ?? 0
    if (at > last) out.push(text.slice(last, at))
    const token = m[0]
    const key = `${keyBase}${n++}`
    if (m[1]) out.push(<code key={key}>{token.slice(1, -1)}</code>)
    else if (m[2]) out.push(<strong key={key}>{inline(token.slice(2, -2), opts, key)}</strong>)
    else if (m[3]) out.push(<em key={key}>{inline(token.slice(1, -1), opts, key)}</em>)
    else if (m[4]) {
      const close = token.indexOf('](')
      const label = token.slice(1, close)
      const href = safeHref(token.slice(close + 2, -1), opts.linkBase)
      out.push(
        href ? (
          <a key={key} href={href} target={opts.linkTarget ?? '_blank'} rel="noopener noreferrer">
            {inline(label, opts, key)}
          </a>
        ) : (
          <React.Fragment key={key}>{label}</React.Fragment>
        ),
      )
    }
    last = at + token.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

const splitRow = (line: string) =>
  line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim())

/** Renders markdown-ish text as React elements (no HTML injection). */
export function Markdown({ text, className, ...opts }: { text: string; className?: string } & MarkdownOptions) {
  const lines = (text ?? '').replace(/\r\n?/g, '\n').split('\n')
  const blocks: ReactNode[] = []
  let i = 0
  let k = 0
  const key = () => `b${k++}`
  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) {
      i++
      continue
    }
    const fence = line.match(/^\s*```\s*([\w+-]*)/)
    if (fence) {
      const body: string[] = []
      i++
      while (i < lines.length && !/^\s*```/.test(lines[i])) body.push(lines[i++])
      i++
      blocks.push(
        <pre key={key()} className="lh-agent-code" data-language={fence[1] || undefined}>
          <code>{body.join('\n')}</code>
        </pre>,
      )
      continue
    }
    const heading = line.match(/^(#{1,6})\s+(.*)$/)
    if (heading) {
      const level = Math.min(heading[1].length + 2, 6)
      blocks.push(React.createElement(`h${level}`, { key: key(), className: 'lh-agent-md-heading' }, inline(heading[2], opts)))
      i++
      continue
    }
    if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      const head = splitRow(line)
      i += 2
      const rows: string[][] = []
      while (i < lines.length && /^\s*\|/.test(lines[i])) rows.push(splitRow(lines[i++]))
      blocks.push(
        <div key={key()} className="lh-agent-table-wrap">
          <table className="lh-agent-table">
            <thead>
              <tr>{head.map((h, j) => <th key={j}>{inline(h, opts)}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri}>{r.map((c, j) => <td key={j}>{inline(c, opts)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>,
      )
      continue
    }
    if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) {
      const ordered = /^\s*\d/.test(line)
      const items: string[] = []
      while (i < lines.length && /^\s*([-*+]|\d+[.)])\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*([-*+]|\d+[.)])\s+/, ''))
        i++
      }
      const children = items.map((it, j) => {
        const task = it.match(/^\[([ xX])\]\s+(.*)$/)
        return (
          <li key={j}>
            {task ? <span aria-hidden="true">{task[1] === ' ' ? '☐ ' : '☑ '}</span> : null}
            {inline(task ? task[2] : it, opts)}
          </li>
        )
      })
      blocks.push(ordered ? <ol key={key()}>{children}</ol> : <ul key={key()}>{children}</ul>)
      continue
    }
    if (/^\s*>/.test(line)) {
      const quote: string[] = []
      while (i < lines.length && /^\s*>/.test(lines[i])) quote.push(lines[i++].replace(/^\s*>\s?/, ''))
      blocks.push(<blockquote key={key()}>{inline(quote.join(' '), opts)}</blockquote>)
      continue
    }
    const para: string[] = []
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^\s*(```|#{1,6}\s|[-*+]\s|\d+[.)]\s|>|\|)/.test(lines[i])
    ) {
      para.push(lines[i++])
    }
    if (!para.length) para.push(lines[i++])
    const parts: ReactNode[] = []
    para.forEach((p, j) => {
      if (j) parts.push(<br key={`br${j}`} />)
      parts.push(...inline(p, opts, `p${j}_`))
    })
    blocks.push(<p key={key()}>{parts}</p>)
  }
  return <div className={className ? `lh-agent-md ${className}` : 'lh-agent-md'}>{blocks}</div>
}
