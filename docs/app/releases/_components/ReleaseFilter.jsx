'use client'

import { useState } from 'react'

const FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'app', label: 'App' },
  { value: 'cli', label: 'CLI' },
]

/**
 * Filter chips for the timeline. The releases themselves are server-rendered
 * children; filtering only flips a data attribute that the CSS keys off.
 */
export default function ReleaseFilter({ counts, children }) {
  const [filter, setFilter] = useState('all')
  return (
    <div className="lhr-timeline" data-filter={filter}>
      <div className="lhr-chips" role="group" aria-label="Filter releases">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            className="lhr-chip"
            aria-pressed={filter === f.value}
            onClick={() => setFilter(f.value)}
          >
            {f.label}
            <span className="lhr-chip-count">{counts[f.value]}</span>
          </button>
        ))}
      </div>
      {children}
    </div>
  )
}
