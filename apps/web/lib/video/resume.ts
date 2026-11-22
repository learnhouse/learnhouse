/*
 Where a learner left a video, and the speed they like, kept in this browser.

 Per device on purpose: no account data, nothing sent anywhere. Every storage
 call is guarded (private windows and blocked storage throw) and every read is
 validated, so a broken value only means "start from the top".
*/

const POSITION_PREFIX = 'lh:video-position:'
const RATE_KEY = 'lh:video-rate'
/** Ignore positions this close to the start: not worth a jump. */
export const RESUME_MIN_SECONDS = 5
/** Positions this close to the end count as finished. */
const FINISHED_RATIO = 0.95
const FINISHED_TAIL_SECONDS = 10
const MAX_ENTRIES = 200

function storage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null
  } catch {
    return null
  }
}

/** Whether `time` is near enough to the end (or the trim's end) to count as done. */
export function isNearEnd(time: number, duration: number, endTime?: number | null): boolean {
  const end = endTime && endTime > 0 && (!duration || endTime < duration) ? endTime : duration
  if (!end || !Number.isFinite(end) || end <= 0) return false
  return time >= end * FINISHED_RATIO || time >= end - FINISHED_TAIL_SECONDS
}

/**
 * The position to resume from, or null to play from the start. Respects the
 * trim: never before `startTime` + a few seconds, never past the end.
 */
export function resumePosition(
  saved: number | null,
  opts: { duration?: number | null; startTime?: number | null; endTime?: number | null } = {},
): number | null {
  if (saved == null || !Number.isFinite(saved) || saved <= 0) return null
  const start = opts.startTime && opts.startTime > 0 ? opts.startTime : 0
  if (saved < start + RESUME_MIN_SECONDS) return null
  if (opts.endTime && opts.endTime > 0 && saved >= opts.endTime) return null
  if (opts.duration && opts.duration > 0 && isNearEnd(saved, opts.duration, opts.endTime)) return null
  return Math.floor(saved)
}

export function readSavedPosition(key: string | null | undefined): number | null {
  if (!key) return null
  const s = storage()
  if (!s) return null
  try {
    const raw = s.getItem(POSITION_PREFIX + key)
    if (!raw) return null
    const value = JSON.parse(raw)
    const t = typeof value === 'number' ? value : value?.t
    return typeof t === 'number' && Number.isFinite(t) && t > 0 ? t : null
  } catch {
    return null
  }
}

function prune(s: Storage) {
  const entries: { key: string; at: number }[] = []
  for (let i = 0; i < s.length; i++) {
    const key = s.key(i)
    if (!key || !key.startsWith(POSITION_PREFIX)) continue
    try {
      entries.push({ key, at: Number(JSON.parse(s.getItem(key) || '{}')?.at) || 0 })
    } catch {
      entries.push({ key, at: 0 })
    }
  }
  if (entries.length <= MAX_ENTRIES) return
  entries.sort((a, b) => a.at - b.at)
  for (const e of entries.slice(0, entries.length - MAX_ENTRIES)) s.removeItem(e.key)
}

/** Remember `time`; forget the video once it is (nearly) finished. */
export function savePosition(key: string | null | undefined, time: number, duration: number, endTime?: number | null): void {
  if (!key || !Number.isFinite(time)) return
  const s = storage()
  if (!s) return
  try {
    if (time < RESUME_MIN_SECONDS || isNearEnd(time, duration, endTime)) {
      s.removeItem(POSITION_PREFIX + key)
      return
    }
    s.setItem(POSITION_PREFIX + key, JSON.stringify({ t: Math.floor(time), at: Date.now() }))
    prune(s)
  } catch {
    /* storage full or blocked */
  }
}

export function clearSavedPosition(key: string | null | undefined): void {
  if (!key) return
  try {
    storage()?.removeItem(POSITION_PREFIX + key)
  } catch {
    /* blocked */
  }
}

const validRate = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0.25 && n <= 4

/** The playback speed the learner last picked, if it isn't 1×. */
export function readPlaybackRate(): number | null {
  try {
    const n = Number(storage()?.getItem(RATE_KEY))
    return validRate(n) && n !== 1 ? n : null
  } catch {
    return null
  }
}

export function savePlaybackRate(rate: number): void {
  if (!validRate(rate)) return
  try {
    const s = storage()
    if (!s) return
    if (rate === 1) s.removeItem(RATE_KEY)
    else s.setItem(RATE_KEY, String(rate))
  } catch {
    /* blocked */
  }
}

/** Calls `fn` at most once per `ms` (the last call in a window is dropped). */
export function throttle<A extends unknown[]>(fn: (..._args: A) => void, ms: number): (..._args: A) => void {
  let last = 0
  return (...args: A) => {
    const now = Date.now()
    if (now - last < ms) return
    last = now
    fn(...args)
  }
}
