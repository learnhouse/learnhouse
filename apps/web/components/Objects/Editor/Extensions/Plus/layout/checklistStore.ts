/*
 Learner ticks for checklists. They live in the learner's browser only
 (localStorage, `lh:checklist:<activity>:<blockId>`), never in the document.
 The list and its items are separate node views (separate React roots in the
 editor), so they share this tiny store to stay in step.
*/

type Ticks = Record<string, boolean>
type Listener = () => void

const cache = new Map<string, Ticks>()
const listeners = new Map<string, Set<Listener>>()
const EMPTY: Ticks = Object.freeze({}) as Ticks

function read(key: string): Ticks {
  const hit = cache.get(key)
  if (hit) return hit
  let ticks: Ticks = EMPTY
  try {
    const raw = typeof window !== 'undefined' ? window.localStorage?.getItem(key) : null
    const parsed = raw ? JSON.parse(raw) : null
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      ticks = Object.fromEntries(Object.entries(parsed).filter(([, v]) => typeof v === 'boolean')) as Ticks
    }
  } catch {
    // Private mode, blocked storage or bad JSON: start empty.
  }
  cache.set(key, ticks)
  return ticks
}

function emit(key: string) {
  listeners.get(key)?.forEach((fn) => fn())
}

export const checklistStore = {
  get(key: string): Ticks {
    return read(key)
  },
  /** The server render and the first client render agree on "nothing ticked yet". */
  getServer(): Ticks {
    return EMPTY
  },
  set(key: string, itemKey: string, checked: boolean) {
    const next = { ...read(key), [itemKey]: checked }
    cache.set(key, next)
    try {
      window.localStorage?.setItem(key, JSON.stringify(next))
    } catch {
      // Quota or blocked storage: the tick still holds for this page view.
    }
    emit(key)
  },
  reset(key: string) {
    cache.set(key, EMPTY)
    try {
      window.localStorage?.removeItem(key)
    } catch {
      // ignore
    }
    emit(key)
  },
  subscribe(key: string, fn: Listener) {
    let set = listeners.get(key)
    if (!set) listeners.set(key, (set = new Set()))
    set.add(fn)
    return () => {
      set!.delete(fn)
    }
  },
  /** Tests only. */
  _clear() {
    cache.clear()
  },
}

/** Whether an item counts as done: the learner's tick wins over the author's default. */
export function isTicked(ticks: Ticks, itemKey: string, authorChecked: boolean): boolean {
  return typeof ticks[itemKey] === 'boolean' ? ticks[itemKey] : authorChecked
}
