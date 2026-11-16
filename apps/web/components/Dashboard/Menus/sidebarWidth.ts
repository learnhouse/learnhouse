import { useSyncExternalStore } from 'react'

// Width and collapsed state of the dashboard sidebar, remembered per browser.
// The pure helpers below hold the rules (clamping, snapping, keyboard steps);
// the small store at the bottom shares one value between the sidebar and its
// resize handle and keeps the server render on the defaults.

export const SIDEBAR_DEFAULT_WIDTH = 240
export const SIDEBAR_MIN_WIDTH = 200
export const SIDEBAR_MAX_WIDTH = 360
export const SIDEBAR_COLLAPSED_WIDTH = 64
/** A drag that ends narrower than this snaps to the icon-only rail. */
export const SIDEBAR_SNAP_COLLAPSE_BELOW = 150
export const SIDEBAR_KEY_STEP = 16
export const SIDEBAR_KEY_STEP_LARGE = 48

export const SIDEBAR_WIDTH_KEY = 'dash-menu-width'
// Older key, kept so people who collapsed the sidebar before stay collapsed.
export const SIDEBAR_COLLAPSED_KEY = 'dash-menu-collapsed'

export type SidebarPrefs = { width: number; collapsed: boolean }

export const DEFAULT_SIDEBAR_PREFS: SidebarPrefs = Object.freeze({
  width: SIDEBAR_DEFAULT_WIDTH,
  collapsed: false,
}) as SidebarPrefs

export function clampSidebarWidth(value: number): number {
  if (!Number.isFinite(value)) return SIDEBAR_DEFAULT_WIDTH
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(value)))
}

export function parseStoredWidth(raw: string | null | undefined): number {
  if (raw == null || raw.trim() === '') return SIDEBAR_DEFAULT_WIDTH
  const n = Number(raw)
  return Number.isFinite(n) ? clampSidebarWidth(n) : SIDEBAR_DEFAULT_WIDTH
}

/**
 * Where a drag lands. `deltaX` is the raw pointer movement; in RTL the handle
 * sits on the left edge, so moving left widens the sidebar.
 */
export function resolveDragWidth(startWidth: number, deltaX: number, rtl: boolean): SidebarPrefs {
  const raw = startWidth + (rtl ? -deltaX : deltaX)
  if (raw < SIDEBAR_SNAP_COLLAPSE_BELOW) {
    return { width: clampSidebarWidth(startWidth), collapsed: true }
  }
  return { width: clampSidebarWidth(raw), collapsed: false }
}

/**
 * Keyboard control for the resize handle (an ARIA window splitter). Arrows
 * step toward or away from the content, flipped in RTL; Shift takes bigger
 * steps. Shrinking past the minimum collapses, growing from collapsed opens
 * at the minimum. Home and Enter reset, End goes to the maximum. Returns null
 * for keys the handle doesn't use.
 */
export function keyboardResize(
  key: string,
  { width, collapsed, rtl, large = false }: SidebarPrefs & { rtl: boolean; large?: boolean },
): SidebarPrefs | null {
  const step = large ? SIDEBAR_KEY_STEP_LARGE : SIDEBAR_KEY_STEP
  if (key === 'Home' || key === 'Enter') return { ...DEFAULT_SIDEBAR_PREFS }
  if (key === 'End') return { width: SIDEBAR_MAX_WIDTH, collapsed: false }

  let direction = 0
  if (key === 'ArrowRight') direction = rtl ? -1 : 1
  else if (key === 'ArrowLeft') direction = rtl ? 1 : -1
  else return null

  if (collapsed) {
    return direction > 0 ? { width: SIDEBAR_MIN_WIDTH, collapsed: false } : { width, collapsed: true }
  }
  if (direction < 0 && width <= SIDEBAR_MIN_WIDTH) return { width, collapsed: true }
  return { width: clampSidebarWidth(width + direction * step), collapsed: false }
}

type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem'>

export function readSidebarPrefs(storage: KeyValueStorage | null | undefined): SidebarPrefs {
  if (!storage) return DEFAULT_SIDEBAR_PREFS
  try {
    return {
      width: parseStoredWidth(storage.getItem(SIDEBAR_WIDTH_KEY)),
      collapsed: storage.getItem(SIDEBAR_COLLAPSED_KEY) === 'true',
    }
  } catch {
    return DEFAULT_SIDEBAR_PREFS
  }
}

export function writeSidebarPrefs(storage: KeyValueStorage | null | undefined, prefs: SidebarPrefs): void {
  if (!storage) return
  try {
    storage.setItem(SIDEBAR_WIDTH_KEY, String(clampSidebarWidth(prefs.width)))
    storage.setItem(SIDEBAR_COLLAPSED_KEY, String(prefs.collapsed))
  } catch {
    /* private mode or blocked storage: the choice lasts for this page only */
  }
}

// ── Store ────────────────────────────────────────────────────────────────

function browserStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

let current: SidebarPrefs | null = null
const listeners = new Set<() => void>()

function getSnapshot(): SidebarPrefs {
  if (current === null) current = readSidebarPrefs(browserStorage())
  return current
}

function getServerSnapshot(): SidebarPrefs {
  return DEFAULT_SIDEBAR_PREFS
}

function onStorage(e: StorageEvent) {
  if (e.key !== SIDEBAR_WIDTH_KEY && e.key !== SIDEBAR_COLLAPSED_KEY) return
  current = readSidebarPrefs(browserStorage())
  listeners.forEach((l) => l())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  if (listeners.size === 1 && typeof window !== 'undefined') {
    window.addEventListener('storage', onStorage)
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0 && typeof window !== 'undefined') {
      window.removeEventListener('storage', onStorage)
    }
  }
}

export function setSidebarPrefs(next: Partial<SidebarPrefs>): void {
  const prev = getSnapshot()
  const merged: SidebarPrefs = {
    width: next.width === undefined ? prev.width : clampSidebarWidth(next.width),
    collapsed: next.collapsed ?? prev.collapsed,
  }
  if (merged.width === prev.width && merged.collapsed === prev.collapsed) return
  current = merged
  writeSidebarPrefs(browserStorage(), merged)
  listeners.forEach((l) => l())
}

/** The sidebar's width and collapsed state; the defaults on the server. */
export function useSidebarPrefs(): SidebarPrefs {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
