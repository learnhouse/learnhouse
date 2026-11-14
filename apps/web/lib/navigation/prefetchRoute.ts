import type { AppRouterInstance, PrefetchOptions } from 'next/dist/shared/lib/app-router-context.shared-runtime'

/**
 * Prefetch a route in full, page included. A bare `router.prefetch(href)`
 * on a dynamic route (every dashboard page) only fetches down to the nearest
 * loading.tsx, so the click still waits on a server round trip and flashes the
 * skeleton. Dashboard pages are client components that load their own data,
 * so their payload is tiny and safe to keep for Next's 5-minute prefetch
 * window. No-op in development, like every Next prefetch.
 */
export function prefetchRouteFull(router: AppRouterInstance, href: string) {
  // 'full' is PrefetchKind.FULL; the enum lives in an internal module, so
  // only its type is imported.
  router.prefetch(href, { kind: 'full' as PrefetchOptions['kind'] })
}
