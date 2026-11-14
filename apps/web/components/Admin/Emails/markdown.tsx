'use client'
import React from 'react'

// A tiny markdown preview for email templates. It builds React elements (no
// innerHTML anywhere), so whatever is typed is escaped by React. Supports
// paragraphs, - / * / 1. lists, **bold**, *italic*, [text](url) with
// https/mailto links only and `{{variables}}` filled from sample values.
// The server renders the real email; this only shows the shape while typing.

export const SAMPLE_VALUES: Record<string, string> = {
  org_name: 'Kitebase Academy',
  org_url: 'https://kitebase.learnhouse.io',
  admin_name: 'Maya',
  plan: 'Pro',
  login_url: 'https://kitebase.learnhouse.io/login',
  days_left: '3',
  poc_end_date: 'Nov 30, 2026',
  support_email: 'support@learnhouse.app',
  date: 'Nov 9, 2026',
}

/** `{{name}}` placeholders found in a text. */
export function findVariables(text: string): string[] {
  const out = new Set<string>()
  for (const m of text.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)) out.add(m[1])
  return Array.from(out)
}

export function fillVariables(text: string, values: Record<string, string> = SAMPLE_VALUES): string {
  return text.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (all, name: string) => values[name] ?? all)
}

function safeUrl(url: string): string | null {
  const u = url.trim()
  return /^(https:\/\/|mailto:)/i.test(u) ? u : null
}

let keySeq = 0
function inline(text: string): React.ReactNode[] {
  const out: React.ReactNode[] = []
  // Links first, then bold, then italic (non-greedy, one pass each).
  const re = /\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*|\*([^*]+)\*/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index))
    const k = `i${keySeq++}`
    if (m[1] !== undefined) {
      const href = safeUrl(m[2])
      out.push(
        href ? (
          <a key={k} href={href} target="_blank" rel="noopener noreferrer" className="text-sky-600 underline underline-offset-2">
            {m[1]}
          </a>
        ) : (
          <span key={k}>{m[1]}</span>
        )
      )
    } else if (m[3] !== undefined) out.push(<strong key={k}>{m[3]}</strong>)
    else if (m[4] !== undefined) out.push(<em key={k}>{m[4]}</em>)
    last = m.index + m[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

export function MarkdownPreview({ source, values = SAMPLE_VALUES, className = '' }: { source: string; values?: Record<string, string>; className?: string }) {
  const lines = fillVariables(source || '', values).split(/\r?\n/)
  const blocks: React.ReactNode[] = []
  let para: string[] = []
  let list: { ordered: boolean; items: string[] } | null = null
  const flushPara = () => {
    if (para.length) blocks.push(<p key={`p${blocks.length}`}>{inline(para.join(' '))}</p>)
    para = []
  }
  const flushList = () => {
    if (!list) return
    const items = list.items.map((it, i) => <li key={i}>{inline(it)}</li>)
    blocks.push(
      list.ordered ? (
        <ol key={`l${blocks.length}`} className="list-decimal ps-5 space-y-1">
          {items}
        </ol>
      ) : (
        <ul key={`l${blocks.length}`} className="list-disc ps-5 space-y-1">
          {items}
        </ul>
      )
    )
    list = null
  }
  for (const line of lines) {
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line)
    const num = /^\s*\d+[.)]\s+(.*)$/.exec(line)
    if (bullet || num) {
      flushPara()
      const ordered = !!num
      if (!list || list.ordered !== ordered) {
        flushList()
        list = { ordered, items: [] }
      }
      list.items.push((bullet ?? num)![1])
    } else if (!line.trim()) {
      flushPara()
      flushList()
    } else {
      flushList()
      para.push(line.trim())
    }
  }
  flushPara()
  flushList()
  return <div className={`space-y-3 text-sm leading-relaxed text-neutral-700 break-words ${className}`}>{blocks}</div>
}
