'use client'

import { useEffect, useRef, useState } from 'react'
import { Copy, Check, CaretDown, FileText, OpenAiLogo, Sparkle } from '@phosphor-icons/react/dist/ssr'

const SITE_URL = 'https://docs.learnhouse.app'

/**
 * "Copy page" plus a menu to read the page as Markdown or hand it to an AI
 * assistant. Every page has a Markdown twin at `<route>.md`.
 */
export default function PageActions({ route }) {
  const [copied, setCopied] = useState(false)
  const [open, setOpen] = useState(false)
  const menuRef = useRef(null)
  const mdPath = `${route === '/' ? '/index' : route}.md`
  const mdUrl = `${SITE_URL}${mdPath}`
  const prompt = `Read ${mdUrl} so I can ask questions about it.`

  useEffect(() => {
    if (!open) return
    const close = (e) => menuRef.current && !menuRef.current.contains(e.target) && setOpen(false)
    const esc = (e) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', esc)
    }
  }, [open])

  const copy = async () => {
    try {
      const text = await fetch(mdPath).then((r) => (r.ok ? r.text() : Promise.reject(r.status)))
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className="lh-page-actions" ref={menuRef}>
      <button type="button" className="lh-page-actions-main" onClick={copy}>
        {copied ? <Check size={13} weight="bold" /> : <Copy size={13} weight="bold" />}
        {copied ? 'Copied' : 'Copy page'}
      </button>
      <button
        type="button"
        className="lh-page-actions-toggle"
        aria-label="More page actions"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <CaretDown size={12} weight="bold" />
      </button>
      {open && (
        <div className="lh-page-actions-menu" role="menu">
          <a role="menuitem" href={mdPath} target="_blank" rel="noopener">
            <FileText size={15} />
            <span>
              View as Markdown
              <small>Plain text for AI tools</small>
            </span>
          </a>
          <a role="menuitem" href={`https://chatgpt.com/?hints=search&q=${encodeURIComponent(prompt)}`} target="_blank" rel="noopener noreferrer">
            <OpenAiLogo size={15} />
            <span>
              Open in ChatGPT
              <small>Ask questions about this page</small>
            </span>
          </a>
          <a role="menuitem" href={`https://claude.ai/new?q=${encodeURIComponent(prompt)}`} target="_blank" rel="noopener noreferrer">
            <Sparkle size={15} />
            <span>
              Open in Claude
              <small>Ask questions about this page</small>
            </span>
          </a>
        </div>
      )}
    </div>
  )
}
