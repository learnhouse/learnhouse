'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { Notepad } from '@phosphor-icons/react'
import { buttonClass } from '@components/Dashboard/Shared/DashKit/buttons'
import { toggleNotes, useNotesState } from '@/lib/notes/notesBus'
import { useActivityNotes } from './useNotes'

/**
 * Opens the lesson's notes panel; the badge counts the learner's notes on
 * this lesson. `variant="icon"` is the round phone button, `dark` the focus
 * mode bar over a video.
 */
export default function NotesButton({
  activityUuid,
  variant = 'button',
  dark = false,
}: {
  activityUuid: string
  variant?: 'button' | 'icon'
  dark?: boolean
}) {
  const { t } = useTranslation()
  const { data } = useActivityNotes(activityUuid)
  const count = Array.isArray(data) ? data.length : 0
  const { open } = useNotesState()
  const label = t('notes.button', { defaultValue: 'Notes' })
  const aria = count
    ? `${label} (${t('notes.count', { count, defaultValue: '{{count}} notes' })})`
    : label

  const badge = count > 0 && (
    <span
      className={`min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-semibold leading-[18px] text-center tabular-nums ${
        dark ? 'bg-white/15 text-white' : 'bg-amber-100 text-amber-800'
      }`}
      aria-hidden
    >
      {count > 99 ? '99+' : count}
    </span>
  )

  if (variant === 'icon') {
    return (
      <button
        type="button"
        onClick={toggleNotes}
        aria-label={aria}
        aria-expanded={open}
        title={label}
        className="lh-press relative grid size-11 shrink-0 place-items-center rounded-full text-gray-500 active:bg-black/5"
      >
        <Notepad size={19} weight={open ? 'fill' : 'bold'} />
        {count > 0 && (
          <span className="absolute top-1.5 end-1.5 min-w-[15px] h-[15px] px-[3px] rounded-full bg-amber-500 text-[9px] font-bold leading-[15px] text-center text-white tabular-nums ring-2 ring-white" aria-hidden>
            {count > 99 ? '99+' : count}
          </span>
        )}
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={toggleNotes}
      aria-label={aria}
      aria-expanded={open}
      title={`${label} (N)`}
      className={
        dark
          ? 'inline-flex h-8 items-center gap-1.5 rounded-xl px-3 text-[13px] font-medium text-white/85 bg-white/10 ring-1 ring-inset ring-white/10 hover:bg-white/15'
          : buttonClass('secondary', 'md', open ? 'bg-neutral-50! text-neutral-900!' : '')
      }
    >
      <Notepad size={14} weight={open ? 'fill' : 'regular'} className={dark ? '' : 'text-amber-600'} />
      {label}
      {badge}
    </button>
  )
}
