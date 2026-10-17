'use client'
import { useSyncExternalStore } from 'react'
import { urlEmbedSandboxFor } from './embedSanitize'

/** Nothing to subscribe to: the page origin never changes after hydration. */
const subscribe = () => () => {}

/**
 * The sandbox for a URL-mode iframe (see urlEmbedSandboxFor), or null until the
 * page origin is known, i.e. during SSR and the hydrating render.
 *
 * Callers must not render the iframe while this is null. A changed sandbox
 * attribute only applies on the frame's next navigation, so an iframe rendered
 * before we can tell whether its src is our own origin would keep a sandbox
 * that lets a same-origin page script the parent.
 */
export function useUrlEmbedSandbox(src: string | null | undefined): string | null {
  const origin = useSyncExternalStore(
    subscribe,
    () => window.location.origin,
    () => null,
  )
  return origin ? urlEmbedSandboxFor(src, origin) : null
}
