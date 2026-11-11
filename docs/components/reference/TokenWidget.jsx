'use client'

import { useState } from 'react'
import { Key, Eye, EyeSlash, X, CheckCircle } from '@phosphor-icons/react/dist/ssr'
import { useApiToken } from './TokenContext'

function maskToken(token) {
  if (token.length <= 10) return token.slice(0, 3) + '••••'
  return `${token.slice(0, 6)}••••${token.slice(-4)}`
}

/**
 * Paste-once token input. When a token is set, every code example on the
 * reference substitutes it in place of the placeholder and the playground
 * uses it as the bearer token. It never leaves the browser otherwise.
 */
export default function TokenWidget({ compact = false }) {
  const { token, setToken, clearToken } = useApiToken()
  const [draft, setDraft] = useState('')
  const [visible, setVisible] = useState(false)
  const [warning, setWarning] = useState('')

  const apply = () => {
    const value = draft.trim()
    if (!value) return
    setWarning(
      /^lh_[A-Za-z0-9_-]+$/.test(value)
        ? ''
        : 'Not an lh_ API token. Kept anyway (a session JWT works for session-only endpoints).'
    )
    setToken(value)
    setDraft('')
    setVisible(false)
  }

  return (
    <div className={`lhr-token ${compact ? 'lhr-token-compact' : ''}`}>
      {token ? (
        <div className="lhr-token-row lhr-token-set">
          <CheckCircle size={15} weight="fill" className="lhr-token-icon lhr-token-icon-ok" />
          <code className="lhr-token-mask" title="Token in use">
            {visible ? token : maskToken(token)}
          </code>
          <button
            type="button"
            className="lhr-iconbtn"
            onClick={() => setVisible((v) => !v)}
            aria-label={visible ? 'Hide token' : 'Show token'}
          >
            {visible ? <EyeSlash size={14} /> : <Eye size={14} />}
          </button>
          <button
            type="button"
            className="lhr-iconbtn"
            onClick={() => {
              clearToken()
              setWarning('')
            }}
            aria-label="Forget token"
            title="Forget token"
          >
            <X size={14} />
          </button>
        </div>
      ) : (
        <div className="lhr-token-row">
          <Key size={15} weight="fill" className="lhr-token-icon" />
          <input
            type={visible ? 'text' : 'password'}
            className="lhr-token-input"
            placeholder="lh_ token"
            aria-label="API token"
            value={draft}
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && apply()}
          />
          <button
            type="button"
            className="lhr-iconbtn"
            onClick={() => setVisible((v) => !v)}
            aria-label={visible ? 'Hide token' : 'Show token'}
          >
            {visible ? <EyeSlash size={14} /> : <Eye size={14} />}
          </button>
          <button type="button" className="lhr-btn lhr-btn-primary lhr-btn-xs" onClick={apply} disabled={!draft.trim()}>
            Use
          </button>
        </div>
      )}
      {warning && <p className="lhr-token-warning">{warning}</p>}
      {!compact && (
        <p className="lhr-token-note">
          Stays in this browser (localStorage). It replaces the placeholder in every example and
          signs playground requests. Use a least-privilege token.
        </p>
      )}
    </div>
  )
}
