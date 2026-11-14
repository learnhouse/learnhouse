'use client'
import React from 'react'

type Node = { type?: string; text?: string; attrs?: Record<string, any>; marks?: { type: string; attrs?: any }[]; content?: Node[] }

/**
 * A note rendered read-only, straight from its (server-sanitized) TipTap JSON
 * with React elements: text is always escaped and only the note schema's few
 * node types exist, so nothing in a note can turn into markup or script.
 * `onLink` decides what a link does (a #heading link scrolls the lesson, or
 * opens it from the My notes page).
 */
export function NoteView({
  doc,
  onLink,
  className = '',
}: {
  doc: Node | null | undefined
  onLink?: (_href: string, _event: React.MouseEvent<HTMLAnchorElement>) => void
  className?: string
}) {
  const inline = (nodes: Node[] = [], keyBase = ''): React.ReactNode[] =>
    nodes.map((n, i) => {
      const key = `${keyBase}-${i}`
      if (n.type === 'hardBreak') return <br key={key} />
      if (n.type !== 'text') return null
      let el: React.ReactNode = n.text
      const marks = n.marks ?? []
      if (marks.some((m) => m.type === 'code')) el = <code className="rounded bg-neutral-100 px-1 py-px text-[0.92em]">{el}</code>
      if (marks.some((m) => m.type === 'bold')) el = <strong className="font-semibold">{el}</strong>
      if (marks.some((m) => m.type === 'italic')) el = <em>{el}</em>
      if (marks.some((m) => m.type === 'strike')) el = <s>{el}</s>
      const link = marks.find((m) => m.type === 'link')
      const href = typeof link?.attrs?.href === 'string' ? link.attrs.href : ''
      if (href && /^(https?:|mailto:|\/(?!\/)|#)/i.test(href)) {
        const external = /^(https?:|mailto:)/i.test(href)
        el = (
          <a
            href={href}
            className="text-sky-700 underline decoration-sky-700/30 underline-offset-2 hover:decoration-sky-700"
            {...(external ? { target: '_blank', rel: 'noopener noreferrer nofollow' } : {})}
            onClick={(e) => {
              if (!external && onLink) {
                e.preventDefault()
                onLink(href, e)
              }
            }}
          >
            {el}
          </a>
        )
      }
      return <React.Fragment key={key}>{el}</React.Fragment>
    })

  const block = (n: Node, key: string): React.ReactNode => {
    const kids = n.content ?? []
    switch (n.type) {
      case 'paragraph':
        return <p key={key} className="min-h-[1em]">{inline(kids, key)}</p>
      case 'heading':
        return <p key={key} className="font-semibold text-neutral-900">{inline(kids, key)}</p>
      case 'blockquote':
        return (
          <blockquote key={key} className="border-s-2 border-amber-300 ps-3 text-neutral-600">
            {kids.map((k, i) => block(k, `${key}-${i}`))}
          </blockquote>
        )
      case 'horizontalRule':
        return <hr key={key} className="border-neutral-200" />
      case 'bulletList':
        return <ul key={key} className="list-disc ps-5 space-y-0.5">{kids.map((k, i) => block(k, `${key}-${i}`))}</ul>
      case 'orderedList':
        return (
          <ol key={key} start={Number(n.attrs?.start) || 1} className="list-decimal ps-5 space-y-0.5">
            {kids.map((k, i) => block(k, `${key}-${i}`))}
          </ol>
        )
      case 'listItem':
        return <li key={key}>{kids.map((k, i) => block(k, `${key}-${i}`))}</li>
      case 'taskList':
        return <ul key={key} className="space-y-0.5">{kids.map((k, i) => block(k, `${key}-${i}`))}</ul>
      case 'taskItem': {
        const checked = !!n.attrs?.checked
        return (
          <li key={key} className="flex items-start gap-2">
            <span
              aria-hidden
              className={`mt-[3px] grid size-3.5 shrink-0 place-items-center rounded-[4px] ring-1 ${checked ? 'bg-emerald-500 ring-emerald-500 text-white' : 'bg-white ring-neutral-300'}`}
            >
              {checked && (
                <svg viewBox="0 0 12 12" className="size-2.5"><path d="M2.5 6.2 5 8.5l4.5-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
              )}
            </span>
            <span className={`min-w-0 flex-1 ${checked ? 'text-neutral-400 line-through' : ''}`}>
              {kids.map((k, i) => block(k, `${key}-${i}`))}
            </span>
          </li>
        )
      }
      default:
        return <React.Fragment key={key}>{kids.map((k, i) => block(k, `${key}-${i}`))}</React.Fragment>
    }
  }

  return (
    <div className={`lh-note-view space-y-1.5 text-sm leading-relaxed text-neutral-800 break-words ${className}`} dir="auto">
      {(doc?.content ?? []).map((n, i) => block(n, `b${i}`))}
    </div>
  )
}

export default NoteView
