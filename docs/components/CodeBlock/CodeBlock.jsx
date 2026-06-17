'use client'

import { useState, useRef, useCallback } from 'react'

function CopyButton({ getText }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(async () => {
    const text = getText()
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
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

export default function CodeBlock({ children, 'data-filename': filename, 'data-language': language, ...props }) {
  const codeRef = useRef(null)

  const getText = useCallback(() => {
    if (!codeRef.current) return ''
    return codeRef.current.textContent || ''
  }, [])

  return (
    <div className="lh-code-block">
      {filename && (
        <div className="lh-code-header">
          <span className="lh-code-filename">{filename}</span>
          <CopyButton getText={getText} />
        </div>
      )}
      <div className="lh-code-body" ref={codeRef}>
        {!filename && <CopyButton getText={getText} />}
        <pre>{children}</pre>
      </div>
    </div>
  )
}
