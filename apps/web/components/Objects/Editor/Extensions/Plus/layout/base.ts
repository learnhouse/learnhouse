/*
 The few pieces the layout views share with their loading fallbacks
 (views/fallbacks.tsx), kept apart from shared.tsx so the always-loaded
 fallbacks don't pull in the editing helpers and icons.
*/
import React from 'react'
import type { LayoutTone } from './layoutModel'

const noopSubscribe = () => () => {}

/**
 * False on the server and while hydrating, true afterwards (and right away
 * for a client-only render). Interactive layouts (tabs) render their no-JS
 * form until then, so server HTML shows every panel and hydration matches.
 */
export function useHydrated(): boolean {
  return React.useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  )
}

/** Soft tinted surface, ring and ink per tone (palette classes, so dark mode and block themes remap them). */
export const TONE_CLASSES: Record<LayoutTone, { card: string; ink: string; icon: string; dot: string; soft: string }> = {
  neutral: { card: 'bg-neutral-50 ring-neutral-200/70', ink: 'text-neutral-800', icon: 'text-neutral-500', dot: 'bg-neutral-700 text-white', soft: 'bg-neutral-100 text-neutral-700' },
  blue: { card: 'bg-blue-50/70 ring-blue-200/70', ink: 'text-blue-950', icon: 'text-blue-600', dot: 'bg-blue-600 text-white', soft: 'bg-blue-100 text-blue-700' },
  teal: { card: 'bg-teal-50/70 ring-teal-200/70', ink: 'text-teal-950', icon: 'text-teal-600', dot: 'bg-teal-600 text-white', soft: 'bg-teal-100 text-teal-700' },
  green: { card: 'bg-green-50/70 ring-green-200/70', ink: 'text-green-950', icon: 'text-green-600', dot: 'bg-green-600 text-white', soft: 'bg-green-100 text-green-700' },
  amber: { card: 'bg-amber-50/70 ring-amber-200/70', ink: 'text-amber-950', icon: 'text-amber-600', dot: 'bg-amber-500 text-white', soft: 'bg-amber-100 text-amber-800' },
  rose: { card: 'bg-rose-50/70 ring-rose-200/70', ink: 'text-rose-950', icon: 'text-rose-600', dot: 'bg-rose-600 text-white', soft: 'bg-rose-100 text-rose-700' },
}
