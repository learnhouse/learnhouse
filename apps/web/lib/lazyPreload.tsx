'use client'
import { lazy, useState, type ComponentProps, type ComponentType } from 'react'

/**
 * `React.lazy` that can be started early and, once its chunk is in, renders
 * without suspending.
 *
 * Plain `lazy` suspends on its first render even when the chunk is already
 * downloaded, because it only learns that from a resolved promise. When the
 * nearest Suspense boundary wraps a whole page, that one suspension swaps the
 * page for its fallback for a frame or more: the "skeleton, then white, then
 * content" flicker. Call `preload()` as soon as you know the component will be
 * needed (it is idempotent); a mount after the chunk arrived renders the
 * module directly, a mount before it suspends as usual. Each mount picks one
 * of the two and keeps it, so a mounted tree never remounts.
 */
export function lazyPreload<C extends ComponentType<any>>(load: () => Promise<{ default: C }>) {
  type P = ComponentProps<C>
  let loaded: C | null = null
  let pending: Promise<{ default: C }> | null = null

  const preload = () => {
    if (!pending) {
      pending = load().then(
        (mod) => {
          loaded = mod.default
          return mod
        },
        (error) => {
          // A failed chunk (deploy, flaky network) may be retried later.
          pending = null
          throw error
        },
      )
    }
    return pending
  }

  const Lazy = lazy(preload)

  function Preloaded(props: P) {
    const [Component] = useState<ComponentType<P>>(() => (loaded ?? Lazy) as ComponentType<P>)
    return <Component {...props} />
  }

  return Object.assign(Preloaded, { preload })
}
