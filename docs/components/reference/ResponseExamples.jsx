'use client'

import { useCallback, useRef, useState } from 'react'
import CopyButton from './CopyButton'

function statusClass(status) {
  return `lhr-status lhr-status-${String(status)[0]}xx`
}

/**
 * Status-tabbed response examples. JSON is highlighted on the server and
 * every example is in the HTML; this only toggles which one is visible.
 * Receives just `[{ status, html }]`, never the schema trees.
 */
export default function ResponseExamples({ examples }) {
  const [active, setActive] = useState(examples[0]?.status)
  const panesRef = useRef({})
  const getText = useCallback(() => panesRef.current[active]?.textContent || '', [active])
  if (!examples.length) return null

  return (
    <div className="lhr-panel">
      <div className="lhr-panel-head">
        <span className="lhr-label">Response</span>
        <div className="lhr-chips" role="tablist" aria-label="Status code">
          {examples.map((r) => (
            <button
              key={r.status}
              type="button"
              role="tab"
              aria-selected={active === r.status}
              className={`lhr-chip lhr-chip-status ${active === r.status ? 'lhr-chip-active' : ''}`}
              onClick={() => setActive(r.status)}
            >
              <span className={statusClass(r.status)} aria-hidden="true" />
              {r.status}
            </button>
          ))}
        </div>
      </div>
      <div className="lhr-panel-body">
        <CopyButton getText={getText} label="Copy response" className="lhr-panel-copy" />
        {examples.map((r) => (
          <div
            key={r.status}
            ref={(el) => {
              panesRef.current[r.status] = el
            }}
            className="lhr-code lhr-code-response"
            hidden={active !== r.status}
            dangerouslySetInnerHTML={{ __html: r.html }}
          />
        ))}
      </div>
    </div>
  )
}
