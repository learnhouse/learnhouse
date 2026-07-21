'use client'

import { useState } from 'react'

/**
 * Status-code-tabbed response examples. The JSON is highlighted server-side
 * (shiki) — this component only switches between pre-rendered blocks.
 */
export default function ResponseExamples({ responses }) {
  const withExamples = (responses || []).filter((r) => r.exampleHtml)
  const [active, setActive] = useState(withExamples[0]?.status)
  if (!withExamples.length) return null

  const current = withExamples.find((r) => r.status === active) || withExamples[0]

  return (
    <div className="lh-ref-codepanel lh-ref-responsepanel">
      <div className="lh-ref-codepanel-head">
        <span className="lh-ref-codepanel-title">Response</span>
        <div className="lh-ref-codepanel-tabs" role="tablist">
          {withExamples.map((r) => (
            <button
              key={r.status}
              role="tab"
              aria-selected={current.status === r.status}
              className={`lh-ref-codepanel-tab lh-ref-status-tab lh-ref-status-${r.status[0]}xx ${
                current.status === r.status ? 'lh-ref-codepanel-tab-active' : ''
              }`}
              onClick={() => setActive(r.status)}
            >
              {r.status}
            </button>
          ))}
        </div>
      </div>
      <div className="lh-ref-codepanel-body">
        <div className="lh-ref-code" dangerouslySetInnerHTML={{ __html: current.exampleHtml }} />
      </div>
    </div>
  )
}
