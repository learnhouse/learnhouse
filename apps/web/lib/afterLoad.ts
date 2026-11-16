// Run non-critical work (lazy widgets, analytics, warm-ups) once the page has
// finished loading AND the browser is idle. "Idle" alone isn't enough: the
// main thread idles while the page still waits on its own chunks and data, and
// work started then competes with them for the network. Returns a cancel
// function. Browser-only.
export function onAfterLoad(
  callback: () => void,
  { timeout = 4000, maxWait = 8000 }: { timeout?: number; maxWait?: number } = {}
): () => void {
  let cancelled = false
  let idleId: number | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  const w = window as any

  const runWhenIdle = () => {
    if (cancelled) return
    if (typeof w.requestIdleCallback === 'function') {
      idleId = w.requestIdleCallback(() => { if (!cancelled) callback() }, { timeout })
    } else {
      timer = setTimeout(() => { if (!cancelled) callback() }, 200)
    }
  }

  // A page whose load event never comes (a stalled image, a hung embed) still
  // gets its widgets after `maxWait`.
  let ceiling: ReturnType<typeof setTimeout> | null = null
  const onLoad = () => {
    if (ceiling) clearTimeout(ceiling)
    runWhenIdle()
  }
  if (document.readyState === 'complete') runWhenIdle()
  else {
    window.addEventListener('load', onLoad, { once: true })
    ceiling = setTimeout(() => {
      window.removeEventListener('load', onLoad)
      runWhenIdle()
    }, maxWait)
  }

  return () => {
    cancelled = true
    window.removeEventListener('load', onLoad)
    if (ceiling) clearTimeout(ceiling)
    if (idleId !== null) w.cancelIdleCallback?.(idleId)
    if (timer) clearTimeout(timer)
  }
}
