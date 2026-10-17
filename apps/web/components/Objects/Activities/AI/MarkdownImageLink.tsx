import React from 'react'

// Model output must not auto-load remote images (prompt-injection exfil), so
// render markdown images as a plain link instead.
export function MarkdownImageLink({ src, alt, className }: { src?: unknown; alt?: string; className?: string }) {
  const label = alt || 'image'
  let href: string | null = null
  if (typeof src === 'string') {
    try {
      if (new URL(src).protocol === 'https:') href = src
    } catch {
      href = null
    }
  }
  if (!href) return <span className={className}>[{label}]</span>
  return (
    <a href={href} target="_blank" rel="noopener noreferrer nofollow" className={className}>
      [{label}]
    </a>
  )
}

export default MarkdownImageLink
