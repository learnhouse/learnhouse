// Where comment threads sit in the document, which ones lost their text, and
// how their cards stack in the rail. Pure functions: no React, no DOM, so they
// are unit-tested directly (tests/activity-comments.test.mjs).

import type { Node as PMNode } from '@tiptap/pm/model'
import { COMMENT_MARK } from './commentContent'

export type CommentAnchor = {
  /** First position covered by the thread's mark. */
  from: number
  /** Last position covered (exclusive). */
  to: number
}

/**
 * Every thread id the document's comment marks point at, with the range from
 * its first to its last marked character. A thread split by later edits keeps
 * one anchor spanning all its pieces, like Google Docs.
 */
export function collectCommentAnchors(doc: PMNode): Map<string, CommentAnchor> {
  const anchors = new Map<string, CommentAnchor>()
  doc.descendants((node, pos) => {
    if (!node.isText || !node.marks.length) return
    for (const mark of node.marks) {
      if (mark.type.name !== COMMENT_MARK) continue
      const id = mark.attrs.threadId
      if (typeof id !== 'string' || !id) continue
      const end = pos + node.nodeSize
      const prev = anchors.get(id)
      if (!prev) anchors.set(id, { from: pos, to: end })
      else {
        if (pos < prev.from) prev.from = pos
        if (end > prev.to) prev.to = end
      }
    }
  })
  return anchors
}

/** Thread ids marked on the document (cheap check for paste filtering). */
export function commentThreadIds(doc: PMNode): Set<string> {
  return new Set(collectCommentAnchors(doc).keys())
}

export type ThreadLike = { thread_uuid: string; status: 'open' | 'resolved'; created_at: string }

export type ThreadGroups<T extends ThreadLike> = {
  /** Open threads anchored in the text, in document order. */
  anchored: T[]
  /** Open threads whose text is gone (deleted, or a stale version loaded). */
  detached: T[]
  /** Resolved threads; anchored ones first in document order, then the rest by date. */
  resolved: T[]
}

/** Split threads into what the rail shows where. */
export function groupThreads<T extends ThreadLike>(
  threads: T[],
  anchors: Map<string, CommentAnchor>
): ThreadGroups<T> {
  const byPos = (a: T, b: T) => {
    const pa = anchors.get(a.thread_uuid)
    const pb = anchors.get(b.thread_uuid)
    if (pa && pb) return pa.from - pb.from || pa.to - pb.to || a.created_at.localeCompare(b.created_at)
    if (pa) return -1
    if (pb) return 1
    return a.created_at.localeCompare(b.created_at)
  }
  const anchored: T[] = []
  const detached: T[] = []
  const resolved: T[] = []
  for (const thread of Array.isArray(threads) ? threads : []) {
    if (thread.status === 'resolved') resolved.push(thread)
    else if (anchors.has(thread.thread_uuid)) anchored.push(thread)
    else detached.push(thread)
  }
  anchored.sort(byPos)
  detached.sort((a, b) => a.created_at.localeCompare(b.created_at))
  resolved.sort(byPos)
  return { anchored, detached, resolved }
}

export type CardBox = {
  id: string
  /** Where the card would like to sit: its anchor's top, in rail pixels. */
  desired: number
  height: number
}

/**
 * Card tops for the rail. Cards keep document order and never overlap: each
 * sits at its anchor unless the card above pushes it down. When one card is
 * active it sits exactly at its anchor and the cards above it move up to make
 * room (they may go above 0 only if they must), which is how Google Docs
 * keeps the focused comment next to its text.
 */
export function layoutCards(cards: CardBox[], activeId: string | null, gap = 8): Map<string, number> {
  const tops = new Map<string, number>()
  if (!cards.length) return tops
  const activeIndex = activeId ? cards.findIndex((c) => c.id === activeId) : -1

  if (activeIndex < 0) {
    let bottom = -Infinity
    for (const card of cards) {
      const top = Math.max(card.desired, bottom + gap)
      tops.set(card.id, top)
      bottom = top + card.height
    }
    return tops
  }

  const active = cards[activeIndex]
  tops.set(active.id, active.desired)
  // Below the active card: push down.
  let bottom = active.desired + active.height
  for (let i = activeIndex + 1; i < cards.length; i++) {
    const card = cards[i]
    const top = Math.max(card.desired, bottom + gap)
    tops.set(card.id, top)
    bottom = top + card.height
  }
  // Above it: push up.
  let ceiling = active.desired
  for (let i = activeIndex - 1; i >= 0; i--) {
    const card = cards[i]
    const top = Math.min(card.desired, ceiling - gap - card.height)
    tops.set(card.id, top)
    ceiling = top
  }
  return tops
}
