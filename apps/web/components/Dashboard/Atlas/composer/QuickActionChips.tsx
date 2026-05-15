'use client'

import React from 'react'

import { Sparkles } from 'lucide-react'

import { useAtlasMini } from '../AtlasMiniContext'

// Contextual prompt suggestions above the composer textarea. The chips
// change based on what's currently in focus (activity → activity-flavoured
// prompts; course-only → course-flavoured; nothing → onboarding prompts).

interface Props {
  onPick: (prompt: string) => void
  disabled?: boolean
}

export default function QuickActionChips({ onPick, disabled }: Props) {
  const { pageContext } = useAtlasMini()
  const prompts = pickPrompts(pageContext)
  if (prompts.length === 0) return null
  return (
    <div className="flex flex-wrap items-center gap-1.5 px-4 pt-2">
      <Sparkles size={11} className="text-violet-300/70" />
      {prompts.map((p) => (
        <button
          key={p}
          type="button"
          onClick={() => onPick(p)}
          disabled={disabled}
          className="inline-flex items-center rounded-full bg-white/[0.03] hover:bg-white/[0.06] ring-1 ring-inset ring-white/[0.08] hover:ring-violet-400/30 disabled:opacity-40 disabled:cursor-not-allowed text-white/65 hover:text-white/95 px-2.5 py-0.5 text-[11px] transition-colors"
        >
          {p}
        </button>
      ))}
    </div>
  )
}

function pickPrompts(ctx: ReturnType<typeof useAtlasMini>['pageContext']): string[] {
  if (ctx?.activity_uuid) {
    return [
      'Make this shorter',
      'Rewrite with a friendlier tone',
      'Translate to French',
      'Add a 3-question quiz',
    ]
  }
  if (ctx?.course_uuid) {
    return [
      'Summarize this course',
      'Add a new chapter at the end',
      'Publish every activity',
      'Reorder chapters by topic',
    ]
  }
  return [
    'Show my 5 most recent courses',
    'Plan a course about distributed systems',
    'List all my draft courses',
  ]
}
