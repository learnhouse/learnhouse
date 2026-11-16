'use client'
import React from 'react'
import { parseRichText, type RichInline } from '@/lib/profile/profile'

// Renders the profile's light markup as React nodes (never HTML), so text is
// always escaped and links are limited to what parseRichText let through.
function Inline({ nodes }: { nodes: RichInline[] }) {
  return (
    <>
      {nodes.map((n, i) => {
        switch (n.type) {
          case 'text':
            return <React.Fragment key={i}>{n.value}</React.Fragment>
          case 'br':
            return <br key={i} />
          case 'strong':
            return (
              <strong key={i} className="font-semibold text-neutral-900">
                <Inline nodes={n.children} />
              </strong>
            )
          case 'em':
            return (
              <em key={i}>
                <Inline nodes={n.children} />
              </em>
            )
          case 'link':
            return (
              <a
                key={i}
                href={n.href}
                target={n.href.startsWith('mailto:') ? undefined : '_blank'}
                rel="noopener noreferrer nofollow ugc"
                className="lh-t-link font-medium text-neutral-900 underline decoration-neutral-300 underline-offset-2 hover:decoration-current break-words"
              >
                {n.text}
              </a>
            )
        }
      })}
    </>
  )
}

export default function RichText({ value, className = '' }: { value: string | undefined; className?: string }) {
  const blocks = React.useMemo(() => parseRichText(value), [value])
  if (!blocks.length) return null
  return (
    <div dir="auto" className={`space-y-3 text-[15px] leading-relaxed text-neutral-700 break-words ${className}`}>
      {blocks.map((b, i) =>
        b.type === 'p' ? (
          <p key={i}>
            <Inline nodes={b.children} />
          </p>
        ) : (
          <ul key={i} className="list-disc ps-5 space-y-1 marker:text-neutral-300">
            {b.items.map((item, j) => (
              <li key={j}>
                <Inline nodes={item} />
              </li>
            ))}
          </ul>
        )
      )}
    </div>
  )
}
