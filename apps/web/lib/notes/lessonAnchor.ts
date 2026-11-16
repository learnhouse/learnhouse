'use client'

/** Scroll the lesson to a heading id (a quote's link back, a heading anchor). */
export function scrollToLessonAnchor(ref: string): boolean {
  let el: HTMLElement | null = null
  try {
    el = document.querySelector<HTMLElement>(`[data-lesson-content] #${CSS.escape(ref)}`) ?? document.getElementById(ref)
  } catch {
    el = null
  }
  if (!el) return false
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' })
  el.classList.add('lh-note-target')
  window.setTimeout(() => el?.classList.remove('lh-note-target'), 1600)
  return true
}

type Anchor = { kind: string; ref?: string | null; label?: string | null; seconds?: number | null } | null | undefined

export type NoteMenuAction = 'jump' | 'copy' | 'delete'

/** The note card menu: the same actions for every card, saved, new or being written. */
export function noteMenuActions(anchor: Anchor): NoteMenuAction[] {
  const canJump = !!anchor && (anchor.kind === 'video' ? anchor.seconds != null : !!anchor.ref)
  return canJump ? ['jump', 'copy', 'delete'] : ['copy', 'delete']
}
