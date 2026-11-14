'use client'
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'

// One Save for the whole course editor.
//
// Course metadata (name, tags, SEO, visibility...) already lives in the course
// context and goes out through `updateCourse`. Everything else a tab edits
// that has its own endpoint (drip schedule, certificate design, contributor
// roles, chapter and activity names) registers a draft here instead of
// shipping its own Save button. The header Save persists every dirty draft in
// one go and reports failures per section.
//
// Drafts live in the editor layout, above the tab bodies, so switching tabs
// keeps them. A section's save function is captured when it is registered and
// kept after the tab unmounts, so Save still works for a tab you left.

export type SectionSaver<T> = (value: T) => Promise<void>

type SectionMeta = {
  label: string
  // Which tab the section belongs to, for the unsaved dot in the tab bar.
  tab: string
  save: SectionSaver<any>
  // Returns a message when the draft cannot be saved as is.
  validate?: (value: any) => string | null
}

export type SectionFailure = { id: string; label: string; message: string }

type DraftState = {
  drafts: Record<string, unknown>
  errors: Record<string, string>
  // Label and tab per registered section, for rendering.
  labels: Record<string, { label: string; tab: string }>
}

type Ctx = {
  state: DraftState
  metaRef: React.MutableRefObject<Map<string, SectionMeta>>
  register: (id: string, label: string, tab: string) => void
  setDraft: (id: string, value: unknown) => void
  clearDraft: (id: string) => void
  saveDrafts: (onProgress?: (done: number, total: number) => void) => Promise<SectionFailure[]>
}

const CourseEditorSaveContext = createContext<Ctx | null>(null)

export function CourseEditorSaveProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<DraftState>({ drafts: {}, errors: {}, labels: {} })
  const stateRef = useRef(state)
  useEffect(() => {
    stateRef.current = state
  }, [state])
  const metaRef = useRef(new Map<string, SectionMeta>())

  const register = useCallback((id: string, label: string, tab: string) => {
    setState((s) => {
      const current = s.labels[id]
      if (current && current.label === label && current.tab === tab) return s
      return { ...s, labels: { ...s.labels, [id]: { label, tab } } }
    })
  }, [])

  const setDraft = useCallback((id: string, value: unknown) => {
    setState((s) => {
      const errors = { ...s.errors }
      delete errors[id]
      return { ...s, drafts: { ...s.drafts, [id]: value }, errors }
    })
  }, [])

  const clearDraft = useCallback((id: string) => {
    setState((s) => {
      const drafts = { ...s.drafts }
      const errors = { ...s.errors }
      delete drafts[id]
      delete errors[id]
      return { ...s, drafts, errors }
    })
  }, [])

  const saveDrafts = useCallback(async (onProgress?: (done: number, total: number) => void) => {
    const entries = Object.entries(stateRef.current.drafts)
    const failures: SectionFailure[] = []
    const label = (id: string) => metaRef.current.get(id)?.label ?? id

    // Validate everything first so a bad field never leaves half the
    // sections saved and the other half not.
    for (const [id, value] of entries) {
      const message = metaRef.current.get(id)?.validate?.(value)
      if (message) failures.push({ id, label: label(id), message })
    }
    if (failures.length > 0) {
      setState((s) => ({
        ...s,
        errors: { ...s.errors, ...Object.fromEntries(failures.map((f) => [f.id, f.message])) },
      }))
      return failures
    }

    let done = 0
    for (const [id, value] of entries) {
      const meta = metaRef.current.get(id)
      if (!meta) continue
      try {
        await meta.save(value)
        setState((s) => {
          // Keep a draft edited again while its save was in flight.
          if (s.drafts[id] !== value) return s
          const drafts = { ...s.drafts }
          const errors = { ...s.errors }
          delete drafts[id]
          delete errors[id]
          return { ...s, drafts, errors }
        })
      } catch (e: any) {
        const message = typeof e?.message === 'string' && e.message ? e.message : String(e ?? '')
        failures.push({ id, label: meta.label, message })
        setState((s) => ({ ...s, errors: { ...s.errors, [id]: message } }))
      }
      done += 1
      onProgress?.(done, entries.length)
    }
    return failures
  }, [])

  const value = useMemo(
    () => ({ state, metaRef, register, setDraft, clearDraft, saveDrafts }),
    [state, register, setDraft, clearDraft, saveDrafts]
  )

  return <CourseEditorSaveContext.Provider value={value}>{children}</CourseEditorSaveContext.Provider>
}

// Editor-wide view of the drafts, for the header Save and the tab bar.
// Safe outside the provider (the community editor reuses SaveState): it then
// reports no drafts.
export function useEditorDrafts() {
  const ctx = useContext(CourseEditorSaveContext)
  const ids = ctx ? Object.keys(ctx.state.drafts) : []
  const labels = ctx?.state.labels ?? {}
  const dirtyTabs = new Set(ids.map((id) => labels[id]?.tab).filter(Boolean) as string[])
  return {
    hasDrafts: ids.length > 0,
    draftCount: ids.length,
    dirtyLabels: ids.map((id) => labels[id]?.label ?? id),
    dirtyTabs,
    errors: ctx?.state.errors ?? {},
    saveDrafts: ctx?.saveDrafts ?? (async () => []),
  }
}

// Whether one section's draft holds unsaved edits, for the sub-tab dots.
// Safe outside the provider (reports false).
export function useDraftDirty(id: string): boolean {
  const ctx = useContext(CourseEditorSaveContext)
  return !!ctx && id in ctx.state.drafts
}

// A tab's draft. `value` is undefined until the user edits something, so the
// tab shows server data until then: `const current = draft.value ?? fromServer`.
export function useSectionDraft<T>(id: string, meta: SectionMeta) {
  const ctx = useContext(CourseEditorSaveContext)
  if (!ctx) throw new Error('useSectionDraft must be used inside CourseEditorSaveProvider')
  const { metaRef, register, setDraft, clearDraft, state } = ctx

  // Refresh the saver after every render so it closes over the latest token
  // and ids; it stays registered after unmount so Save works from another tab.
  useEffect(() => {
    metaRef.current.set(id, meta)
  })
  useEffect(() => {
    register(id, meta.label, meta.tab)
  }, [id, meta.label, meta.tab, register])

  return {
    value: state.drafts[id] as T | undefined,
    dirty: id in state.drafts,
    error: state.errors[id] as string | undefined,
    set: useCallback((next: T) => setDraft(id, next), [id, setDraft]),
    clear: useCallback(() => clearDraft(id), [id, clearDraft]),
  }
}

// Warns before the tab closes or the user follows a link out of the editor
// while anything is unsaved. Links inside the editor (tab switches) keep the
// drafts, so they pass through.
export function useLeaveGuard(dirty: boolean, editorBasePath: string, message: string) {
  useEffect(() => {
    if (!dirty) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      const anchor = (e.target as HTMLElement | null)?.closest?.('a[href]') as HTMLAnchorElement | null
      if (!anchor || anchor.target === '_blank' || anchor.hasAttribute('download')) return
      let url: URL
      try {
        url = new URL(anchor.href, window.location.href)
      } catch {
        return
      }
      if (url.origin !== window.location.origin) return
      if (url.pathname.startsWith(editorBasePath)) return
      if (!window.confirm(message)) {
        e.preventDefault()
        e.stopPropagation()
      }
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    // Capture phase, so the confirm runs before Next's Link handler navigates.
    document.addEventListener('click', onClick, true)
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload)
      document.removeEventListener('click', onClick, true)
    }
  }, [dirty, editorBasePath, message])
}
