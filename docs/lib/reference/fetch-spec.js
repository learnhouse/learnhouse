import { API_BASE_URL, SPEC_REVALIDATE_SECONDS } from './config'

/**
 * Fetch the live OpenAPI spec with ISR caching. The Next data cache dedupes
 * this across every reference page, so the (~700 KB) document is fetched at
 * most once per revalidation window.
 *
 * Falls back to the committed snapshot so builds never fail when the API is
 * unreachable and `next dev` works offline. Refresh the snapshot with
 * `node scripts/update-openapi-snapshot.mjs`.
 */
export async function getSpec() {
  try {
    const res = await fetch(`${API_BASE_URL}/openapi.json`, {
      next: { revalidate: SPEC_REVALIDATE_SECONDS, tags: ['openapi-spec'] },
    })
    if (!res.ok) throw new Error(`spec fetch returned ${res.status}`)
    return await res.json()
  } catch (err) {
    console.warn('[reference] falling back to bundled OpenAPI snapshot:', err?.message)
    const { default: snapshot } = await import('./openapi.snapshot.json')
    return snapshot
  }
}
