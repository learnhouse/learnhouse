/*
 A tiny haptic tap on touch devices when an answer is judged. Only on a
 coarse pointer (phones, tablets), never on desktop, and silently skipped
 where vibration is missing or blocked.
*/
export function buzz(kind: 'correct' | 'wrong' = 'correct') {
  try {
    if (typeof window === 'undefined' || !window.matchMedia?.('(pointer: coarse)').matches) return
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    navigator.vibrate?.(kind === 'wrong' ? [8, 40, 8] : 8)
  } catch {
    // no vibration API, or blocked by the browser
  }
}
