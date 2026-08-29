import * as Sentry from '@sentry/nextjs'

/**
 * Failure handling for data fetches inside `generateMetadata`.
 *
 * `generateMetadata` runs during SSR with no error boundary above it, so a
 * rejected service call fails the whole render. Two very different things end
 * up in that one rejection and they must NOT be treated the same way:
 *
 *   - An authorization outcome (401 / 403 / 404). A private or unpublished
 *     course answers 403 "Resource is not public or not published" to an
 *     anonymous visitor; a deleted org answers 404. Nothing is broken. The page
 *     should degrade, the event should not reach Sentry, and the URL must NOT
 *     be indexed — we would be publishing a placeholder for a resource the
 *     visitor was never allowed to see.
 *
 *   - A backend failure (5xx, timeout, DNS/socket error, unparseable body).
 *     Something IS broken. It has to reach Sentry, and the response must not
 *     carry `noindex`: Googlebot treats a 5xx as "retry later" but treats
 *     200 + noindex as a removal signal, so emitting noindex during an API blip
 *     de-indexes healthy public pages — a fix strictly worse than the crash it
 *     replaced. In that case we emit the fallback title with NO robots
 *     directive at all and let the crawler keep what it already has.
 */

const ACCESS_STATUSES = new Set([401, 403, 404])

/** True for a rejection that is a normal authorization / absence outcome. */
export function isAccessOutcome(error: unknown): boolean {
  const status = (error as any)?.status
  return typeof status === 'number' && ACCESS_STATUSES.has(status)
}

export type SsrFetch<T> = { data: T | null; error: unknown }

/**
 * Await a service call for `generateMetadata` without letting it fail the
 * render, keeping the rejection so the caller can tell the two cases apart.
 *
 * Anything that is not an access outcome is reported to Sentry at ERROR level.
 * Swallowing it would trade a noisy-but-truthful signal for silence: a backend
 * regression that 500s every course would render titleless pages with no
 * server-side telemetry whatsoever. WARNING would not do — the Sentry logging
 * integration only captures at ERROR.
 */
export async function ssrMetadataFetch<T>(
  route: string,
  what: string,
  promise: Promise<T>
): Promise<SsrFetch<T>> {
  try {
    return { data: await promise, error: null }
  } catch (error) {
    if (!isAccessOutcome(error)) {
      Sentry.captureException(error, {
        level: 'error',
        tags: { ssr_metadata: route, ssr_metadata_fetch: what },
        extra: { status: (error as any)?.status ?? null },
      })
    }
    return { data: null, error }
  }
}

/**
 * The `robots` half of a fallback Metadata object, meant to be spread into it.
 *
 * `noindex` only when every failure handed in is an access outcome (or when
 * there was no failure at all and the resource is genuinely absent). If any of
 * them is an unexplained backend failure, returns `{}` — no robots directive —
 * so a transient outage cannot remove a published page from the index.
 */
export function fallbackRobots(
  ...errors: unknown[]
): { robots?: { index: false; follow: false } } {
  if (errors.some((error) => error != null && !isAccessOutcome(error))) return {}
  return { robots: { index: false, follow: false } }
}
