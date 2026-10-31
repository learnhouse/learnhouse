import { useSyncExternalStore } from 'react'

// Whether variable chips show their name ("First name") or a sample value
// ("Ada"). Shared by the toolbar toggle and every chip in the editor.
let showValues = false
const listeners = new Set<() => void>()

export function setShowVariableValues(value: boolean): void {
  showValues = value
  listeners.forEach((listener) => listener())
}

export function useShowVariableValues(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => showValues,
    () => false
  )
}
