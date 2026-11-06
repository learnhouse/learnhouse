'use client'

import { useCallback, useState } from 'react'
import { Check, Copy } from '@phosphor-icons/react/dist/ssr'

/** Small icon button that copies `getText()` and flips to a check for 2s. */
export default function CopyButton({ getText, label = 'Copy', className = '' }) {
  const [copied, setCopied] = useState(false)
  const onClick = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(getText())
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {}
  }, [getText])
  return (
    <button
      type="button"
      className={`lhr-iconbtn ${className}`}
      onClick={onClick}
      aria-label={copied ? 'Copied' : label}
      title={copied ? 'Copied' : label}
    >
      {copied ? <Check size={14} weight="bold" /> : <Copy size={14} />}
    </button>
  )
}
