'use client'
import React, { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowBendUpLeft, Copy, DotsThree, Play, Quotes, Trash } from '@phosphor-icons/react'
import { buttonClass } from '@components/Dashboard/Shared/DashKit/buttons'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@components/ui/dropdown-menu'
import { formatTimestamp } from '@/lib/notes/noteMarkdown'
import { noteMenuActions, scrollToLessonAnchor } from '@/lib/notes/lessonAnchor'
import { seekLessonVideo } from '@/lib/notes/videoClock'
import type { NoteAnchor } from '@services/notes/notes'

export function jumpToAnchor(anchor: NoteAnchor) {
  if (anchor.kind === 'video' && anchor.seconds != null) seekLessonVideo(anchor.seconds)
  else if (anchor.ref) scrollToLessonAnchor(anchor.ref)
}

export function AnchorChip({ anchor }: { anchor: NoteAnchor }) {
  const { t } = useTranslation()
  if (anchor.kind === 'video' && anchor.seconds != null) {
    return (
      <button
        type="button"
        onClick={() => jumpToAnchor(anchor)}
        className="inline-flex h-6 items-center gap-1 rounded-md bg-sky-50 px-1.5 text-xs font-semibold tabular-nums text-sky-700 ring-1 ring-inset ring-sky-600/15 hover:bg-sky-100"
        title={t('notes.play_from', { defaultValue: 'Play from {{time}}', time: formatTimestamp(anchor.seconds) })}
      >
        <Play size={11} weight="fill" className="rtl:-scale-x-100" />
        {formatTimestamp(anchor.seconds)}
      </button>
    )
  }
  if (anchor.ref || anchor.label) {
    return (
      <button
        type="button"
        onClick={() => jumpToAnchor(anchor)}
        className="inline-flex h-6 min-w-0 max-w-full items-center gap-1 rounded-md bg-amber-50 px-1.5 text-xs font-medium text-amber-800 ring-1 ring-inset ring-amber-600/15 hover:bg-amber-100"
        title={t('notes.go_to_section', { defaultValue: 'Go to this section' })}
      >
        <Quotes size={11} weight="fill" className="shrink-0" />
        <span className="truncate" dir="auto">{anchor.label || anchor.ref}</span>
      </button>
    )
  }
  return null
}

const MENU_ITEM = 'text-[13px] text-neutral-700 focus:bg-neutral-100 focus:text-neutral-900'

/**
 * The top row of every note card, whether the note is saved, brand new or
 * being written: where it points, when it changed, and one actions menu
 * (jump to the spot, copy the text, delete). Delete asks again inline, in the
 * card, never with a browser dialog.
 */
export default function NoteCardHeader({
  anchor,
  updatedLabel,
  updatedTitle,
  getText,
  onDelete,
  initialConfirming = false,
}: {
  anchor?: NoteAnchor | null
  updatedLabel?: string | null
  updatedTitle?: string
  /** The note's current words (the live editor's for the note being written). */
  getText: () => string
  onDelete: () => Promise<unknown> | void
  /** Start on the delete confirmation (tests). */
  initialConfirming?: boolean
}) {
  const { t } = useTranslation()
  const [confirming, setConfirming] = useState(initialConfirming)
  const [deleting, setDeleting] = useState(false)
  const [copied, setCopied] = useState(false)
  const confirmRef = useRef<HTMLButtonElement>(null)
  const actions = noteMenuActions(anchor)

  useEffect(() => {
    if (confirming) confirmRef.current?.focus()
  }, [confirming])
  useEffect(() => {
    if (!copied) return
    const id = window.setTimeout(() => setCopied(false), 1500)
    return () => window.clearTimeout(id)
  }, [copied])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(getText())
      setCopied(true)
    } catch {
      /* clipboard refused (insecure context, permissions): nothing to show */
    }
  }

  const remove = async () => {
    setDeleting(true)
    try {
      await onDelete()
    } finally {
      setDeleting(false)
      setConfirming(false)
    }
  }

  if (confirming) {
    return (
      <div
        className="mb-2 flex min-h-6 flex-wrap items-center gap-2 rounded-lg bg-rose-50 px-2 py-1.5 ring-1 ring-inset ring-rose-600/10"
        role="group"
        data-confirm-delete=""
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation()
            setConfirming(false)
          }
        }}
      >
        <span className="me-auto text-xs font-medium text-rose-800">{t('notes.delete_question', { defaultValue: 'Delete this note?' })}</span>
        <button ref={confirmRef} type="button" onClick={() => void remove()} disabled={deleting} className={buttonClass('danger', 'sm', 'h-6! px-2! text-[11px]!')}>
          {t('notes.delete_confirm', { defaultValue: 'Delete' })}
        </button>
        <button type="button" onClick={() => setConfirming(false)} className={buttonClass('ghost', 'sm', 'h-6! px-2! text-[11px]!')}>
          {t('common.cancel')}
        </button>
      </div>
    )
  }

  return (
    <div className="mb-2 flex min-h-6 items-center gap-2">
      {anchor && <AnchorChip anchor={anchor} />}
      <span className="ms-auto shrink-0 text-[11px] text-neutral-400" title={updatedTitle} aria-live="polite">
        {copied ? t('notes.copied', { defaultValue: 'Copied' }) : updatedLabel}
      </span>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            data-note-actions=""
            aria-label={t('notes.actions', { defaultValue: 'Note actions' })}
            title={t('notes.actions', { defaultValue: 'Note actions' })}
            onMouseDown={(e) => e.preventDefault()}
            className="grid size-6 shrink-0 place-items-center rounded-md text-neutral-400 hover:bg-neutral-100 hover:text-neutral-800 data-[state=open]:bg-neutral-100 data-[state=open]:text-neutral-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/15"
          >
            <DotsThree size={16} weight="bold" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="min-w-[11rem] rounded-xl border-neutral-200 bg-white p-1 text-neutral-800 shadow-[0_8px_24px_-8px_rgba(0,0,0,0.18)]"
          style={{ zIndex: 'var(--z-tooltip)' }}
        >
          {actions.includes('jump') && anchor && (
            <DropdownMenuItem className={MENU_ITEM} onSelect={() => jumpToAnchor(anchor)}>
              {anchor.kind === 'video' ? <Play size={14} className="rtl:-scale-x-100" /> : <ArrowBendUpLeft size={14} className="rtl:-scale-x-100" />}
              {anchor.kind === 'video' && anchor.seconds != null
                ? t('notes.play_from', { defaultValue: 'Play from {{time}}', time: formatTimestamp(anchor.seconds) })
                : t('notes.go_to_section', { defaultValue: 'Go to this section' })}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem className={MENU_ITEM} disabled={!getText().trim()} onSelect={() => void copy()}>
            <Copy size={14} />
            {t('notes.copy_text', { defaultValue: 'Copy text' })}
          </DropdownMenuItem>
          <DropdownMenuSeparator className="bg-neutral-100" />
          <DropdownMenuItem className="text-[13px] text-rose-600 focus:bg-rose-50 focus:text-rose-700" onSelect={() => setConfirming(true)}>
            <Trash size={14} />
            {t('notes.delete', { defaultValue: 'Delete note' })}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
