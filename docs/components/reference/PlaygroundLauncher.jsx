'use client'

import { useState } from 'react'
import dynamic from 'next/dynamic'
import { Play } from '@phosphor-icons/react/dist/ssr'

// The playground (form state, proxy calls, history) is only downloaded when
// a visitor opens it, so it costs nothing on the initial page load.
const Playground = dynamic(() => import('./Playground'), {
  ssr: false,
  loading: () => <div className="lhr-play lhr-play-loading">Loading playground…</div>,
})

export default function PlaygroundLauncher(props) {
  const [open, setOpen] = useState(false)
  if (open) return <Playground {...props} onClose={() => setOpen(false)} />
  return (
    <button
      type="button"
      className="lhr-try"
      onClick={() => setOpen(true)}
      onMouseEnter={() => import('./Playground')}
      onFocus={() => import('./Playground')}
    >
      <span className="lhr-try-icon">
        <Play size={11} weight="fill" />
      </span>
      <span className="lhr-try-text">
        <strong>Try it</strong>
        <span>Send a live request with your token</span>
      </span>
    </button>
  )
}
