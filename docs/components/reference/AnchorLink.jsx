'use client'

import { useState } from 'react'
import { LinkSimple, Check } from '@phosphor-icons/react/dist/ssr'

/**
 * Permalink for an operation heading: updates the URL hash and copies the
 * full link to the clipboard.
 */
export default function AnchorLink({ id, label }) {
  const [copied, setCopied] = useState(false)
  const onClick = async (e) => {
    e.preventDefault()
    const url = `${location.origin}${location.pathname}#${id}`
    history.replaceState(null, '', `#${id}`)
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {}
  }
  return (
    <a
      href={`#${id}`}
      className="lhr-anchor"
      onClick={onClick}
      aria-label={copied ? 'Link copied' : `Copy link to ${label}`}
      title={copied ? 'Link copied' : 'Copy link'}
    >
      {copied ? <Check size={13} weight="bold" /> : <LinkSimple size={13} weight="bold" />}
    </a>
  )
}
