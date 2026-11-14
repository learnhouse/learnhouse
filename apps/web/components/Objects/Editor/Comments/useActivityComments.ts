'use client'
import React from 'react'
import type { Editor } from '@tiptap/core'
import {
  type CommentThread,
  type CommentThreadList,
  listCommentThreads,
} from '@services/courses/activityComments'

// Thread list for one activity, kept fresh while several people edit.
//
// In collaborative mode the Y doc is shared, so a mutation bumps
// `meta.commentsRev` in it and every other client refetches at once. Without
// collaboration (legacy manual-save mode) there is no shared channel: poll
// every 30 s while the tab is visible, and refetch when it regains focus.

export const POLL_MS = 30_000
const META_MAP = 'meta'
const REV_KEY = 'commentsRev'

type YMapLike = {
  get: (_key: string) => unknown
  set: (_key: string, _value: unknown) => void
  observe: (_fn: (_event: unknown, _tr: { local: boolean }) => void) => void
  unobserve: (_fn: (_event: unknown, _tr: { local: boolean }) => void) => void
}
type YDocLike = { getMap: (_name: string) => YMapLike }

/**
 * The Y doc the editor collaborates on, read from TipTap's Collaboration
 * extension, so comments need no wiring from the collaboration code.
 */
export function findEditorYDoc(editor: Editor | null | undefined): YDocLike | null {
  const ext = editor?.extensionManager?.extensions?.find((e) => e.name === 'collaboration')
  const opts = (ext?.options ?? {}) as { document?: YDocLike | null; fragment?: { doc?: YDocLike | null } | null }
  return opts.document ?? opts.fragment?.doc ?? null
}

export function useActivityComments(editor: Editor | null, activityUuid: string, token: string | undefined) {
  const [data, setData] = React.useState<CommentThreadList | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const tokenRef = React.useRef(token)
  React.useEffect(() => {
    tokenRef.current = token
  }, [token])
  const inflight = React.useRef<Promise<void> | null>(null)
  const again = React.useRef(false)

  const refetch = React.useCallback(async (): Promise<void> => {
    // Coalesce bursts (several remote bumps at once) into one trailing fetch.
    if (inflight.current) {
      again.current = true
      return inflight.current
    }
    const run = async () => {
      do {
        again.current = false
        const t = tokenRef.current
        if (!t || !activityUuid) return
        try {
          const list = await listCommentThreads(activityUuid, t)
          setData({ ...list, threads: Array.isArray(list?.threads) ? list.threads : [] })
          setError(null)
        } catch (e: any) {
          setError(e?.message || 'error')
        }
      } while (again.current)
    }
    inflight.current = run().finally(() => {
      inflight.current = null
    })
    return inflight.current
  }, [activityUuid])

  // Live channel: the shared Y doc when collaborating, polling otherwise.
  const [ydoc, setYdoc] = React.useState<YDocLike | null>(() => findEditorYDoc(editor))
  React.useEffect(() => {
    setYdoc(findEditorYDoc(editor))
  }, [editor])

  React.useEffect(() => {
    refetch()
  }, [refetch, token])

  React.useEffect(() => {
    if (!ydoc) return
    const meta = ydoc.getMap(META_MAP)
    const onChange = (_event: unknown, tr: { local: boolean }) => {
      if (!tr.local) refetch()
    }
    meta.observe(onChange)
    return () => meta.unobserve(onChange)
  }, [ydoc, refetch])

  React.useEffect(() => {
    if (ydoc) return
    const tick = () => {
      if (document.visibilityState === 'visible') refetch()
      // Collaboration may have connected since: switch channel.
      const found = findEditorYDoc(editor)
      if (found) setYdoc(found)
    }
    const id = window.setInterval(tick, POLL_MS)
    const onFocus = () => refetch()
    window.addEventListener('focus', onFocus)
    return () => {
      window.clearInterval(id)
      window.removeEventListener('focus', onFocus)
    }
  }, [ydoc, editor, refetch])

  /** Tell the other editors that comments changed. */
  const bump = React.useCallback(() => {
    if (!ydoc) return
    const meta = ydoc.getMap(META_MAP)
    const rev = Number(meta.get(REV_KEY)) || 0
    meta.set(REV_KEY, rev + 1)
  }, [ydoc])

  /** Merge a thread the API returned after a mutation, then signal others. */
  const applyThread = React.useCallback(
    (thread: CommentThread) => {
      setData((prev) => {
        if (!prev) return prev
        const live = thread.comments.length > 0 && !thread.comments.every((c) => c.deleted)
        const others = prev.threads.filter((t) => t.thread_uuid !== thread.thread_uuid)
        const exists = others.length !== prev.threads.length
        let threads = others
        if (live) {
          threads = exists
            ? prev.threads.map((t) => (t.thread_uuid === thread.thread_uuid ? thread : t))
            : [...prev.threads, thread]
        }
        return { ...prev, threads }
      })
      bump()
    },
    [bump]
  )

  return { data, error, refetch, applyThread, collaborative: !!ydoc }
}
