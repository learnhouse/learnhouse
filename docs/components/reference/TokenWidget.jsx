'use client'

import { useState } from 'react'
import { Key, Eye, EyeSlash, X, CheckCircle } from '@phosphor-icons/react/dist/ssr'
import { useApiToken } from './TokenContext'

function maskToken(token) {
  if (token.length <= 10) return token.slice(0, 3) + '••••'
  return `${token.slice(0, 6)}••••••••${token.slice(-4)}`
}

/**
 * Paste-once token input. When a token is set, every code example on the
 * reference substitutes it in place of the placeholder and the playground
 * uses it as the bearer token.
 */
export default function TokenWidget({ compact = false }) {
  const { token, setToken, clearToken } = useApiToken()
  const [draft, setDraft] = useState('')
  const [visible, setVisible] = useState(false)
  const [warning, setWarning] = useState('')

  const apply = () => {
    const value = draft.trim()
    if (!value) return
    if (!/^lh_[A-Za-z0-9_-]+$/.test(value)) {
      setWarning('That does not look like an lh_ API token — using it anyway.')
    } else {
      setWarning('')
    }
    setToken(value)
    setDraft('')
    setVisible(false)
  }

  if (token) {
    return (
      <div className={`lh-ref-token lh-ref-token-set ${compact ? 'lh-ref-token-compact' : ''}`}>
        <CheckCircle size={15} weight="fill" className="lh-ref-token-check" />
        <code className="lh-ref-token-mask">{visible ? token : maskToken(token)}</code>
        <button
          type="button"
          className="lh-ref-token-icon-btn"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? 'Hide token' : 'Show token'}
        >
          {visible ? <EyeSlash size={14} /> : <Eye size={14} />}
        </button>
        <button
          type="button"
          className="lh-ref-token-icon-btn"
          onClick={() => {
            clearToken()
            setWarning('')
          }}
          aria-label="Clear token"
        >
          <X size={14} />
        </button>
      </div>
    )
  }

  return (
    <div className={`lh-ref-token ${compact ? 'lh-ref-token-compact' : ''}`}>
      <div className="lh-ref-token-row">
        <Key size={15} weight="fill" className="lh-ref-token-key" />
        <input
          type={visible ? 'text' : 'password'}
          className="lh-ref-token-input"
          placeholder="Paste your lh_ API token…"
          value={draft}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && apply()}
        />
        <button
          type="button"
          className="lh-ref-token-icon-btn"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? 'Hide token' : 'Show token'}
        >
          {visible ? <EyeSlash size={14} /> : <Eye size={14} />}
        </button>
        <button type="button" className="lh-ref-token-apply" onClick={apply} disabled={!draft.trim()}>
          Use
        </button>
      </div>
      {warning && <p className="lh-ref-token-warning">{warning}</p>}
      {!compact && (
        <p className="lh-ref-token-note">
          Stored only in your browser — it is substituted into every example and used by the
          playground. Prefer a least-privilege token.
        </p>
      )}
    </div>
  )
}
