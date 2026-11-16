'use client'
import { useSyncExternalStore } from 'react'

/**
 * Focus mode preference for the course reader, shared by the activity page
 * and the org header (which steps aside while it's on). Phones keep their own
 * key: a preference set on a desktop shouldn't take over a phone, and back.
 *
 * Read through useSyncExternalStore so the first client render already knows
 * the preference: no flash of the regular layout when an activity opens.
 */
export const FOCUS_MODE_EVENT = 'focusModeChange'

const storageKey = (phone: boolean) => (phone ? 'globalFocusModeMobile' : 'globalFocusMode')

export function readFocusPref(phone: boolean): boolean {
  try {
    return localStorage.getItem(storageKey(phone)) === 'true'
  } catch {
    return false
  }
}

export function writeFocusPref(phone: boolean, value: boolean) {
  try {
    localStorage.setItem(storageKey(phone), String(value))
  } catch {
    /* private mode: the toggle still works for this page view */
    memory[storageKey(phone)] = value
  }
  window.dispatchEvent(new CustomEvent(FOCUS_MODE_EVENT, { detail: { isFocusMode: value, phone } }))
}

// Fallback when storage throws, so the toggle keeps working in-session.
const memory: Record<string, boolean> = {}

function subscribe(onChange: () => void) {
  window.addEventListener(FOCUS_MODE_EVENT, onChange)
  window.addEventListener('storage', onChange)
  return () => {
    window.removeEventListener(FOCUS_MODE_EVENT, onChange)
    window.removeEventListener('storage', onChange)
  }
}

export function useFocusPref(phone: boolean): boolean {
  return useSyncExternalStore(
    subscribe,
    () => {
      const key = storageKey(phone)
      return key in memory ? memory[key] : readFocusPref(phone)
    },
    () => false,
  )
}
