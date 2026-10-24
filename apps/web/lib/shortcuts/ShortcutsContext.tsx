'use client'
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  IGNORED_ANCESTORS,
  SequenceMatcher,
  expandBindings,
  isActivationKeyOnControl,
  isIgnoredTarget,
  tokenFromEvent,
} from './matcher'

export type ShortcutGroup = 'global' | 'navigation' | 'page'

export interface ShortcutAction {
  /** Stable id; re-registering the same id replaces the previous action. */
  id: string
  /** Binding as shown to the user: `j`, `?`, `g c`. */
  keys: string
  /** Extra bindings that fire the same action (`arrowdown` next to `j`). */
  aliases?: string[]
  /** Translated label for hints, the help sheet and the palette. */
  label: string
  group: ShortcutGroup
  run: () => void
  /** Fire even when focus is inside a dialog (the help sheet's own toggle). */
  allowInDialog?: boolean
  /** Listed but not offered as a palette action (navigation is already a page entry). */
  hideFromPalette?: boolean
}

interface ShortcutsValue {
  actions: ShortcutAction[]
  register: (_action: ShortcutAction) => () => void
  helpOpen: boolean
  setHelpOpen: (_open: boolean) => void
}

const ShortcutsContext = createContext<ShortcutsValue | null>(null)

/**
 * Owns the single keydown listener for the learner-facing app. Pages and
 * components register actions while mounted; the help sheet and the command
 * palette read the same list, so a shortcut is never documented in one
 * place and bound in another.
 */
export function ShortcutsProvider({ children }: { children: React.ReactNode }) {
  const [actions, setActions] = useState<ShortcutAction[]>([])
  const [helpOpen, setHelpOpen] = useState(false)
  const actionsRef = useRef<ShortcutAction[]>([])
  actionsRef.current = actions

  const register = useCallback((action: ShortcutAction) => {
    setActions((prev) => [...prev.filter((a) => a.id !== action.id), action])
    return () => {
      setActions((prev) => prev.filter((a) => a !== action && a.id !== action.id))
    }
  }, [])

  useEffect(() => {
    const matcher = new SequenceMatcher<string>(() => expandBindings(actionsRef.current))
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.repeat) return
      const token = tokenFromEvent(e)
      if (!token) return
      const target = e.target as HTMLElement | null
      if (isActivationKeyOnControl(token, target ? { tagName: target.tagName, role: target.getAttribute('role') } : null)) return
      const inDialog = !!target?.closest?.('[role="dialog"]')
      const ignored = isIgnoredTarget(
        target
          ? {
              tagName: target.tagName,
              isContentEditable: target.isContentEditable,
              matchesAncestor: (sel) => !!target.closest?.(sel),
            }
          : null,
      )
      if (ignored && !inDialog) {
        matcher.reset()
        return
      }
      const result = matcher.feed(token)
      if (!result.fired) return
      const action = actionsRef.current.find((a) => a.id === result.fired!.id)
      if (!action) return
      if (ignored && !action.allowInDialog) return
      e.preventDefault()
      action.run()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const value = useMemo(
    () => ({ actions, register, helpOpen, setHelpOpen }),
    [actions, register, helpOpen],
  )
  return <ShortcutsContext.Provider value={value}>{children}</ShortcutsContext.Provider>
}

export function useShortcuts(): ShortcutsValue {
  const ctx = useContext(ShortcutsContext)
  if (!ctx) throw new Error('useShortcuts must be used within ShortcutsProvider')
  return ctx
}

/** Same as `useShortcuts` but tolerates being rendered outside the provider (embeds, previews). */
export function useOptionalShortcuts(): ShortcutsValue | null {
  return useContext(ShortcutsContext)
}

/**
 * Register one action for as long as the component is mounted and
 * `enabled` is true. `run` is read through a ref, so callers can pass a
 * fresh closure every render without re-registering.
 */
export function useShortcut(
  action: Omit<ShortcutAction, 'run'> & { run: () => void },
  enabled: boolean = true,
): void {
  const ctx = useOptionalShortcuts()
  const runRef = useRef(action.run)
  runRef.current = action.run
  const { id, keys, label, group, allowInDialog, hideFromPalette } = action
  const aliasKey = action.aliases?.join('|') ?? ''
  // Depend on the stable `register`, never on the context object: that
  // object changes with every registration, which would re-run this effect
  // and register again without end.
  const register = ctx?.register

  useEffect(() => {
    if (!register || !enabled) return
    return register({
      id,
      keys,
      aliases: aliasKey ? aliasKey.split('|') : undefined,
      label,
      group,
      allowInDialog,
      hideFromPalette,
      run: () => runRef.current(),
    })
  }, [register, enabled, id, keys, aliasKey, label, group, allowInDialog, hideFromPalette])
}

export { IGNORED_ANCESTORS }
