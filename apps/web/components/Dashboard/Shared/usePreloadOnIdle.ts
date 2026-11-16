'use client'
import { useEffect } from 'react'
import { onAfterLoad } from '@/lib/afterLoad'

/**
 * Load code-split chunks once the browser is idle, so the first switch to a
 * tab whose body is a `next/dynamic` chunk doesn't wait on a download (and
 * flash its skeleton). The route prefetch already covers the page payload;
 * this covers the code. Skipped when the user asked to save data, and in
 * development, where each chunk would be compiled on demand. Pass a
 * module-level array: the loaders are the same `() => import(...)` calls the
 * page hands to `dynamic`, which the bundler dedupes into one chunk request.
 */
export function usePreloadOnIdle(loaders: ReadonlyArray<() => Promise<unknown>>) {
  useEffect(() => {
    if (process.env.NODE_ENV === 'development' || (navigator as any).connection?.saveData) return
    return onAfterLoad(() => loaders.forEach((load) => void load().catch(() => {})))
  }, [loaders])
}
