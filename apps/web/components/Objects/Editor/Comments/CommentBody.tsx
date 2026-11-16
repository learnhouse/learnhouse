'use client'
import React from 'react'
import { getUserAvatarMediaDirectory } from '@services/media/media'
import type { CommentAuthor } from '@services/courses/activityComments'
import { parseBody } from './commentFormat'

export function authorName(author: CommentAuthor | null | undefined, fallback: string): string {
  if (!author) return fallback
  const full = `${author.first_name || ''} ${author.last_name || ''}`.trim()
  return full || author.username
}

function avatarSrc(author: CommentAuthor): string {
  const img = author.avatar_image || ''
  if (!img) return ''
  return /^https?:\/\//.test(img) ? img : getUserAvatarMediaDirectory(author.user_uuid, img)
}

export function CommentAvatar({ author, size = 24 }: { author: CommentAuthor | null | undefined; size?: number }) {
  const [broken, setBroken] = React.useState(false)
  const src = author && !broken ? avatarSrc(author) : ''
  const initial = (author ? authorName(author, '?') : '?').charAt(0).toUpperCase()
  if (src) {
    return (
      <img
        src={src}
        alt=""
        onError={() => setBroken(true)}
        style={{ width: size, height: size }}
        className="shrink-0 rounded-full object-cover bg-neutral-100 ring-1 ring-black/5"
      />
    )
  }
  return (
    <span
      aria-hidden
      style={{ width: size, height: size, fontSize: Math.round(size * 0.45) }}
      className="shrink-0 rounded-full bg-neutral-200 text-neutral-600 font-semibold flex items-center justify-center"
    >
      {initial}
    </span>
  )
}

/** A comment's text: markdown-lite rendered as elements, never as HTML. */
export function CommentBody({ body, knownUsernames }: { body: string; knownUsernames?: Set<string> }) {
  const lines = React.useMemo(() => parseBody(body), [body])
  return (
    <div className="text-[13px] leading-[1.5] text-neutral-800 break-words [overflow-wrap:anywhere]">
      {lines.map((tokens, i) => (
        <p key={i} className="min-h-[1em]">
          {tokens.map((tok, j) => {
            switch (tok.kind) {
              case 'bold':
                return <strong key={j} className="font-semibold">{tok.text}</strong>
              case 'italic':
                return <em key={j}>{tok.text}</em>
              case 'code':
                return (
                  <code key={j} className="px-1 py-px rounded bg-neutral-100 text-[12px] font-mono text-neutral-800">
                    {tok.text}
                  </code>
                )
              case 'link':
                return (
                  <a
                    key={j}
                    href={tok.href}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    className="text-sky-700 underline underline-offset-2 hover:text-sky-800"
                  >
                    {tok.text}
                  </a>
                )
              case 'mention': {
                const known = !knownUsernames || knownUsernames.has(tok.username.toLowerCase())
                return known ? (
                  <span key={j} className="rounded px-0.5 font-medium text-sky-700 bg-sky-50">
                    {tok.text}
                  </span>
                ) : (
                  <React.Fragment key={j}>{tok.text}</React.Fragment>
                )
              }
              default:
                return <React.Fragment key={j}>{tok.text}</React.Fragment>
            }
          })}
        </p>
      ))}
    </div>
  )
}
