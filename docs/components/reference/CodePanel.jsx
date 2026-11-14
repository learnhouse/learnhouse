'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useApiToken } from './TokenContext'
import CopyButton from './CopyButton'
import { TOKEN_PLACEHOLDER, LANG_STORAGE_KEY } from '../../lib/reference/config'

const LANGS = [
  { key: 'curl', label: 'cURL' },
  { key: 'sdk', label: 'SDK' },
  { key: 'js', label: 'fetch' },
  { key: 'python', label: 'Python' },
]

const LANG_EVENT = 'lh-ref-lang'

/**
 * Restore the pane's pristine server HTML, then substitute the visitor's
 * token by walking text nodes only. The highlighted markup is generated on
 * the server and trusted; the token is user input and only ever set as text.
 */
function substituteToken(pane, html, token) {
  if (!pane) return
  if (pane.dataset.token === (token || '')) return
  pane.innerHTML = html
  pane.dataset.token = token || ''
  if (!token) return
  const walker = document.createTreeWalker(pane, NodeFilter.SHOW_TEXT)
  let node
  while ((node = walker.nextNode())) {
    if (node.textContent.includes(TOKEN_PLACEHOLDER)) {
      node.textContent = node.textContent.replaceAll(TOKEN_PLACEHOLDER, token)
    }
  }
}

/**
 * Language-tabbed code panel. Every language is server-rendered (so the code
 * is in the HTML for readers, crawlers and no-JS), inactive panes are just
 * hidden. The chosen language is shared by every panel on the site
 * (localStorage + a same-tab event).
 */
export default function CodePanel({ snippets, title = 'Request', tabs = LANGS }) {
  const { token } = useApiToken()
  const langs = tabs.filter((l) => snippets[l.key])
  const [lang, setLang] = useState(langs[0]?.key)
  const panesRef = useRef({})

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

  useEffect(() => {
    for (const { key } of langs) substituteToken(panesRef.current[key], snippets[key], token)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, snippets])

  const selectLang = (key) => {
    setLang(key)
    try {
      localStorage.setItem(LANG_STORAGE_KEY, key)
    } catch {}
    window.dispatchEvent(new CustomEvent(LANG_EVENT, { detail: key }))
  }

  const getText = useCallback(() => panesRef.current[lang]?.textContent || '', [lang])

  return (
    <div className="lhr-panel">
      <div className="lhr-panel-head">
        <span className="lhr-label">{title}</span>
        {langs.length === 1 ? (
          <span className="lhr-chip lhr-chip-static">{langs[0].label}</span>
        ) : (
        <div className="lhr-chips" role="tablist" aria-label="Language">
          {langs.map((l) => (
            <button
              key={l.key}
              type="button"
              role="tab"
              aria-selected={lang === l.key}
              className={`lhr-chip ${lang === l.key ? 'lhr-chip-active' : ''}`}
              onClick={() => selectLang(l.key)}
            >
              {l.label}
            </button>
          ))}
        </div>
        )}
      </div>
      <div className="lhr-panel-body">
        <CopyButton getText={getText} label="Copy code" className="lhr-panel-copy" />
        {langs.map((l) => (
          <div
            key={l.key}
            ref={(el) => {
              panesRef.current[l.key] = el
            }}
            className="lhr-code"
            hidden={lang !== l.key}
            suppressHydrationWarning
            dangerouslySetInnerHTML={{ __html: snippets[l.key] }}
          />
        ))}
      </div>
    </div>
  )
}
