'use client'

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import AtlasMiniPanel from './AtlasMiniPanel'

// The Atlas mini panel needs to live ABOVE Next.js route segments that
// remount on navigation (e.g. the course-edit `[subpage]` tabs) — otherwise
// switching tabs unmounts the panel and the user loses their chat. This
// provider keeps the panel mounted once at the dashboard-layout level and
// exposes a toggle to any descendant that wants to open it.

// Active-page hint passed through to the Atlas agent so it doesn't have to
// ask "which course?" when the user is obviously already viewing one. Only
// course-level info today; chapter / activity are reserved for future use.
export interface AtlasPageContext {
  course_uuid?: string
  course_name?: string
  chapter_id?: number
  chapter_name?: string
  activity_uuid?: string
  activity_name?: string
}

// A structured "attached reference" the user pinned via the chip button on
// an activity or chapter row. Travels to the backend so the agent can resolve
// vague references like "this" / "fill this" against an already-known uuid
// instead of trying to interpret a quoted string in the user's message.
export interface AtlasReference {
  type: 'activity' | 'chapter'
  uuid: string
  name: string
  parent_course_uuid: string
  parent_chapter_id?: number
  parent_chapter_name?: string
  activity_type?: string
}

const MAX_ATTACHED_REFS = 5

interface AtlasMiniContextValue {
  open: boolean
  setOpen: (open: boolean) => void
  toggle: () => void
  input: string
  setInput: (v: string) => void
  appendToInput: (text: string) => void
  focusInput: () => void
  registerInputRef: (el: HTMLTextAreaElement | null) => void
  pageContext: AtlasPageContext | null
  setPageContext: (ctx: AtlasPageContext | null) => void
  attachedReferences: AtlasReference[]
  attachReference: (ref: AtlasReference) => void
  removeReference: (uuid: string) => void
  clearReferences: () => void
}

const AtlasMiniContext = createContext<AtlasMiniContextValue | null>(null)

export function useAtlasMini(): AtlasMiniContextValue {
  const ctx = useContext(AtlasMiniContext)
  if (!ctx) {
    throw new Error('useAtlasMini must be used inside <AtlasMiniProvider>')
  }
  return ctx
}

export function AtlasMiniProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState('')
  const [pageContext, setPageContext] = useState<AtlasPageContext | null>(null)
  const [attachedReferences, setAttachedReferences] = useState<AtlasReference[]>([])
  const inputElRef = useRef<HTMLTextAreaElement | null>(null)
  const toggle = useCallback(() => setOpen((v) => !v), [])

  const focusInput = useCallback(() => {
    const el = inputElRef.current
    if (!el) return
    el.focus()
    const len = el.value.length
    try {
      el.setSelectionRange(len, len)
    } catch {
      /* setSelectionRange may throw on inputs of certain types; ignored */
    }
  }, [])

  const appendToInput = useCallback((text: string) => {
    if (!text) return
    setInput((prev) => {
      const trimmedPrev = prev.replace(/\s+$/, '')
      if (!trimmedPrev) return text
      const sep = trimmedPrev.endsWith('\n') ? '' : '\n'
      return `${trimmedPrev}${sep}${text}`
    })
    setOpen(true)
    // Focus on next tick once the panel/textarea is mounted/visible.
    setTimeout(focusInput, 0)
  }, [focusInput])

  const registerInputRef = useCallback((el: HTMLTextAreaElement | null) => {
    inputElRef.current = el
  }, [])

  const attachReference = useCallback(
    (ref: AtlasReference) => {
      if (!ref?.uuid) return
      setAttachedReferences((prev) => {
        // Dedupe by (type, uuid); move to the end if already present so
        // the most recently re-attached reference reads as freshest.
        const filtered = prev.filter(
          (r) => !(r.type === ref.type && r.uuid === ref.uuid),
        )
        const next = [...filtered, ref]
        return next.length > MAX_ATTACHED_REFS
          ? next.slice(next.length - MAX_ATTACHED_REFS)
          : next
      })
      setOpen(true)
      setTimeout(focusInput, 0)
    },
    [focusInput],
  )

  const removeReference = useCallback((uuid: string) => {
    setAttachedReferences((prev) => prev.filter((r) => r.uuid !== uuid))
  }, [])

  const clearReferences = useCallback(() => {
    setAttachedReferences([])
  }, [])

  const value = useMemo(
    () => ({
      open,
      setOpen,
      toggle,
      input,
      setInput,
      appendToInput,
      focusInput,
      registerInputRef,
      pageContext,
      setPageContext,
      attachedReferences,
      attachReference,
      removeReference,
      clearReferences,
    }),
    [
      open,
      toggle,
      input,
      appendToInput,
      focusInput,
      registerInputRef,
      pageContext,
      attachedReferences,
      attachReference,
      removeReference,
      clearReferences,
    ],
  )

  return (
    <AtlasMiniContext.Provider value={value}>
      {/*
        The mini panel pushes the page rather than overlaying it. We
        reserve a slot on the right by shrinking the available width
        when ``open`` flips. The panel itself is position:fixed and
        animates in from off-screen; the wrapper just trims the layout
        so the dashboard never sits under the panel.
      */}
      <div
        className="atlas-mini-shift"
        style={{
          marginRight: open ? 'min(460px, 100vw)' : 0,
          transition: 'margin-right 200ms ease-in-out',
        }}
      >
        {children}
      </div>
      <AtlasMiniPanel open={open} onClose={() => setOpen(false)} />
    </AtlasMiniContext.Provider>
  )
}

// Register an active-page context with Atlas for the lifetime of the
// mounting component. Wrapping pages/components call this with the
// course / chapter / activity they're showing; on unmount the context is
// cleared so a different page can take over without leaking stale state.
export function useRegisterAtlasPageContext(ctx: AtlasPageContext | null) {
  const { setPageContext } = useAtlasMini()
  // Stringify to a stable key so callers can pass freshly-built objects
  // each render without forcing repeated set/clear cycles.
  const key = ctx ? JSON.stringify(ctx) : null
  useEffect(() => {
    setPageContext(ctx)
    return () => {
      setPageContext(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
}
