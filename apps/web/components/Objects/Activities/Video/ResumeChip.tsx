'use client'

import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowCounterClockwise, X } from '@phosphor-icons/react'
import { formatClock } from './videoSource'

/**
 * "Resumed at 3:12 · Start over", shown over a player that picked up where the
 * learner left off. Hides itself after a few seconds.
 */
export default function ResumeChip({ seconds, onStartOver }: { seconds: number | null; onStartOver: () => void }) {
  const { t } = useTranslation()
  // The position this chip was closed for; a new resume shows it again.
  const [hiddenFor, setHiddenFor] = useState<number | null>(null)
  useEffect(() => {
    if (seconds == null) return
    const timer = setTimeout(() => setHiddenFor(seconds), 8000)
    return () => clearTimeout(timer)
  }, [seconds])
  if (seconds == null || hiddenFor === seconds) return null
  return (
    <div
      role="status"
      className="absolute top-3 start-3 z-30 flex items-center gap-1 rounded-full bg-black/70 py-1 ps-3 pe-1 text-xs font-medium text-white shadow-lg ring-1 ring-white/10 backdrop-blur-md animate-in fade-in slide-in-from-top-1 duration-200 motion-reduce:animate-none"
    >
      <span className="tabular-nums">{t('activities.video_resumed_at', { time: formatClock(seconds), defaultValue: 'Resumed at {{time}}' })}</span>
      <button
        type="button"
        onClick={() => {
          setHiddenFor(seconds)
          onStartOver()
        }}
        className="ms-1 inline-flex items-center gap-1 rounded-full bg-white/15 px-2.5 py-1 hover:bg-white/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
      >
        <ArrowCounterClockwise size={12} weight="bold" />
        {t('activities.video_start_over', 'Start over')}
      </button>
      <button
        type="button"
        onClick={() => setHiddenFor(seconds)}
        aria-label={t('common.close', 'Close')}
        className="inline-flex size-6 items-center justify-center rounded-full hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
      >
        <X size={11} weight="bold" />
      </button>
    </div>
  )
}
