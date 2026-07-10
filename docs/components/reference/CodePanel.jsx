'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useApiToken } from './TokenContext'
import { TOKEN_PLACEHOLDER, LANG_STORAGE_KEY } from '../../lib/reference/config'

const LANGS = [
  { key: 'curl', label: 'cURL' },
  { key: 'js', label: 'JavaScript' },
  { key: 'python', label: 'Python' },
]

const LANG_EVENT = 'lh-ref-lang'

function CopyButton({ getText }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(getText())
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {}
  }, [getText])
  return (
    <button className="lh-code-copy" onClick={handleCopy} aria-label="Copy code">
      {copied ? (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      ) : (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
          <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
        </svg>
      )}
    </button>
  )
}

/**
 * Substitute the visitor's token into pre-highlighted shiki HTML by walking
 * text nodes only — the highlighted markup is server-generated and trusted;
 * the token is user input and is inserted purely as text.
 */
function substituteToken(container, html, token) {
  container.innerHTML = html // pristine server HTML first, so token changes/clears re-apply cleanly
  if (!token) return
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
  let node
  while ((node = walker.nextNode())) {
    if (node.textContent.includes(TOKEN_PLACEHOLDER)) {
      node.textContent = node.textContent.replaceAll(TOKEN_PLACEHOLDER, token)
    }
  }
}

/**
 * Language-tabbed code panel. The selected language is shared across every
 * panel on the site (localStorage + a same-tab custom event).
 */
export default function CodePanel({ snippets, title = 'Request' }) {
  const { token } = useApiToken()
  const [lang, setLang] = useState('curl')
  const codeRef = useRef(null)

  useEffect(() => {
    try {
      const stored = localStorage.getItem(LANG_STORAGE_KEY)
      if (stored && snippets[stored]) setLang(stored)
    } catch {}
    const onLang = (e) => {
      if (e.detail && snippets[e.detail]) setLang(e.detail)
    }
    window.addEventListener(LANG_EVENT, onLang)
    return () => window.removeEventListener(LANG_EVENT, onLang)
  }, [snippets])

  const selectLang = (key) => {
    setLang(key)
    try {
      localStorage.setItem(LANG_STORAGE_KEY, key)
    } catch {}
    window.dispatchEvent(new CustomEvent(LANG_EVENT, { detail: key }))
  }

  const active = snippets[lang] || snippets.curl

  useEffect(() => {
    if (codeRef.current && active) substituteToken(codeRef.current, active.html, token)
  }, [active, token])

  const getText = useCallback(
    () => (active ? active.raw.replaceAll(TOKEN_PLACEHOLDER, token || TOKEN_PLACEHOLDER) : ''),
    [active, token]
  )

  return (
    <div className="lh-ref-codepanel">
      <div className="lh-ref-codepanel-head">
        <span className="lh-ref-codepanel-title">{title}</span>
        <div className="lh-ref-codepanel-tabs" role="tablist">
          {LANGS.filter((l) => snippets[l.key]).map((l) => (
            <button
              key={l.key}
              role="tab"
              aria-selected={lang === l.key}
              className={`lh-ref-codepanel-tab ${lang === l.key ? 'lh-ref-codepanel-tab-active' : ''}`}
              onClick={() => selectLang(l.key)}
            >
              {l.label}
            </button>
          ))}
        </div>
      </div>
      <div className="lh-ref-codepanel-body">
        <CopyButton getText={getText} />
        <div ref={codeRef} className="lh-ref-code" />
      </div>
    </div>
  )
}
