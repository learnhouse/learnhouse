'use client'
import React, { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { useMediaQuery } from 'usehooks-ts'
import { NotePencil } from '@phosphor-icons/react'
import { Dialog, DialogContent, DialogTitle } from '@components/ui/dialog'
import { useShortcut } from '@/lib/shortcuts/ShortcutsContext'
import { captureToNotes, closeNotes, toggleNotes, useNotesState } from '@/lib/notes/notesBus'
import type { NoteAnchor } from '@services/notes/notes'

// The panel (and TipTap with it) loads the first time notes are opened.
const NotesPanel = lazy(() => import('./NotesPanel'))

type Bubble = { top: number; left: number; quote: string; anchor: NoteAnchor | null }

const STAGE = '.lh-vt-stage'

function headingAnchorFor(range: Range, stage: Element): NoteAnchor | null {
  const headings = Array.from(stage.querySelectorAll<HTMLElement>('h1[id],h2[id],h3[id],h4[id],h5[id],h6[id]'))
  let found: HTMLElement | null = null
  for (const h of headings) {
    // The heading comes before (or contains) the start of the selection.
    const pos = h.compareDocumentPosition(range.startContainer)
    if (pos & Node.DOCUMENT_POSITION_FOLLOWING || pos & Node.DOCUMENT_POSITION_CONTAINED_BY || h.contains(range.startContainer)) found = h
    else break
  }
  if (!found) return null
  return { kind: 'heading', ref: found.id, label: (found.textContent || '').trim().slice(0, 200) || null }
}

/** "Add to notes" under a text selection in the lesson. */
function SelectionNoteBubble() {
  const { t } = useTranslation()
  const [bubble, setBubble] = useState<Bubble | null>(null)

  const measure = useCallback(() => {
    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return setBubble(null)
    const text = sel.toString().trim()
    if (text.length < 2) return setBubble(null)
    const range = sel.getRangeAt(0)
    const start = range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement
    const stage = start?.closest(STAGE)
    if (!stage || start?.closest('[data-notes-panel], input, textarea, [role="dialog"]')) return setBubble(null)
    const rect = range.getBoundingClientRect()
    if (!rect.width && !rect.height) return setBubble(null)
    const width = 150
    const below = rect.bottom + 8
    const top = below + 40 > window.innerHeight ? Math.max(8, rect.top - 44) : below
    const left = Math.min(window.innerWidth - width - 8, Math.max(8, rect.left + rect.width / 2 - width / 2))
    setBubble({ top, left, quote: text, anchor: headingAnchorFor(range, stage) })
  }, [])

  useEffect(() => {
    let frame = 0
    const schedule = () => {
      if (frame) cancelAnimationFrame(frame)
      frame = requestAnimationFrame(measure)
    }
    document.addEventListener('selectionchange', schedule)
    document.addEventListener('scroll', schedule, { capture: true, passive: true })
    window.addEventListener('resize', schedule)
    return () => {
      if (frame) cancelAnimationFrame(frame)
      document.removeEventListener('selectionchange', schedule)
      document.removeEventListener('scroll', schedule, { capture: true })
      window.removeEventListener('resize', schedule)
    }
  }, [measure])

  if (!bubble || typeof document === 'undefined') return null
  return createPortal(
    <div style={{ position: 'fixed', top: bubble.top, left: bubble.left, zIndex: 'var(--z-tooltip)' }} className="animate-in fade-in-0 zoom-in-95 duration-150">
      <button
        type="button"
        data-notes-capture=""
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          captureToNotes({ quote: bubble.quote, anchor: bubble.anchor })
          window.getSelection()?.removeAllRanges()
          setBubble(null)
        }}
        className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-neutral-900 px-3 text-[13px] font-medium text-white shadow-[0_6px_20px_-6px_rgba(0,0,0,0.45)] ring-1 ring-black/10 hover:bg-neutral-800"
      >
        <NotePencil size={14} weight="bold" className="text-amber-300" />
        {t('notes.add_to_notes', { defaultValue: 'Add to notes' })}
      </button>
    </div>,
    document.body
  )
}

/**
 * Hosts a lesson's notes: the side panel beside the lesson from lg up, a
 * sheet below, the `n` shortcut and the selection bubble. Mounted only for a
 * signed-in learner on a published lesson.
 */
export default function NotesHost({
  activity,
  shortcutsReady = true,
}: {
  activity: { activity_uuid: string; activity_type?: string; name?: string }
  shortcutsReady?: boolean
}) {
  const { t } = useTranslation()
  const { open } = useNotesState()
  const wide = useMediaQuery('(min-width: 1024px)', { initializeWithValue: false })

  useShortcut(
    { id: 'activity.notes', keys: 'n', label: t('notes.shortcut', { defaultValue: 'Open or close notes' }), group: 'page', run: toggleNotes },
    shortcutsReady
  )

  // Leaving the lesson page closes the panel.
  useEffect(() => () => closeNotes(), [])

  return (
    <>
      <SelectionNoteBubble />
      {open && wide && (
        <aside
          className="lh-notes-side sticky self-start w-[340px] xl:w-[360px] shrink-0 overflow-hidden rounded-2xl bg-white nice-shadow animate-in fade-in-0 slide-in-from-right-2 rtl:slide-in-from-left-2 duration-200 print:hidden"
          aria-label={t('notes.title', { defaultValue: 'My notes' })}
        >
          <Suspense fallback={<div className="h-full animate-pulse bg-neutral-50" />}>
            <NotesPanel activity={activity} variant="side" />
          </Suspense>
        </aside>
      )}
      <Dialog open={open && !wide} onOpenChange={(v) => !v && closeNotes()}>
        <DialogContent className="flex h-[min(85dvh,720px)] flex-col p-0 bg-white sm:max-w-lg overflow-hidden">
          <DialogTitle className="sr-only">{t('notes.title', { defaultValue: 'My notes' })}</DialogTitle>
          <div className="min-h-0 flex-1 pt-3">
            <Suspense fallback={<div className="h-full animate-pulse bg-neutral-50" />}>
              {open && !wide && <NotesPanel activity={activity} variant="sheet" />}
            </Suspense>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
