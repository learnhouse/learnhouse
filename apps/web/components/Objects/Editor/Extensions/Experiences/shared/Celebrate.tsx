'use client'
/*
 A short confetti-like burst for a completed experience. Pure CSS
 (styles/block-theme.css, `.lh-exp-burst`), about 900ms, no library. With
 prefers-reduced-motion the particles are hidden and only a soft glow fades.
 Decorative only: aria-hidden, never blocks clicks.
*/
import React from 'react'

const COLORS = ['#f59e0b', '#10b981', '#3b82f6', '#ec4899', '#8b5cf6', '#14b8a6']
const PARTICLES = 14

export interface CelebrateProps {
  show: boolean
}

export function Celebrate({ show }: CelebrateProps) {
  // Re-key on every rising edge so the animation replays on a second win.
  const [run, setRun] = React.useState(0)
  const prev = React.useRef(false)
  React.useEffect(() => {
    if (show && !prev.current) setRun((n) => n + 1)
    prev.current = show
  }, [show])
  if (!show || run === 0) return null
  return (
    <span key={run} aria-hidden className="lh-exp-burst">
      <span className="lh-exp-burst-glow" />
      {Array.from({ length: PARTICLES }, (_, i) => {
        const angle = (360 / PARTICLES) * i + (i % 2 ? 8 : -8)
        const dist = 56 + ((i * 37) % 40)
        return (
          <span
            key={i}
            className="lh-exp-burst-dot"
            style={
              {
                '--lh-exp-a': `${angle}deg`,
                '--lh-exp-d': `${dist}px`,
                '--lh-exp-c': COLORS[i % COLORS.length],
                animationDelay: `${(i % 3) * 40}ms`,
              } as React.CSSProperties
            }
          />
        )
      })}
    </span>
  )
}

export default Celebrate
