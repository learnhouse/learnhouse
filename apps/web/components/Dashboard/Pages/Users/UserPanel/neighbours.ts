// Previous / next member for j/k when the open member is not on the page the
// table has loaded (a `?user=` deep link, a search result, another page).
// Pure: the fetcher is injected, so tests can drive it.

export type Neighbours =
  | { status: 'found'; prev: number | null; next: number | null; index: number; total: number }
  // The member is not in the list as it is filtered and sorted right now.
  | { status: 'outside' }
  // The list is longer than we are willing to scan from the browser.
  | { status: 'too_large'; total: number }

export type MembersPage = { items: { user: { id: number } }[]; total: number }

export const SCAN_PAGE_SIZE = 100 // the members API caps `limit` at 100
export const SCAN_MAX_PAGES = 10 // up to 1,000 members

/** Neighbours within one already-loaded page of ids, or null when absent. */
export function neighboursInIds(ids: number[], userId: number, offset = 0, total = ids.length): Extract<Neighbours, { status: 'found' }> | null {
  const i = ids.indexOf(userId)
  if (i < 0) return null
  return { status: 'found', prev: i > 0 ? ids[i - 1] : null, next: i < ids.length - 1 ? ids[i + 1] : null, index: offset + i, total }
}

/**
 * Walk the list (same filters and sort as the table) a page of 100 at a time
 * until the member turns up; the neighbours at a page boundary come from the
 * adjacent page.
 */
export async function scanForNeighbours(
  fetchPage: (_page: number, _limit: number) => Promise<MembersPage>,
  userId: number,
  { pageSize = SCAN_PAGE_SIZE, maxPages = SCAN_MAX_PAGES }: { pageSize?: number; maxPages?: number } = {}
): Promise<Neighbours> {
  let previousLast: number | null = null
  for (let page = 1; page <= maxPages; page++) {
    const res = await fetchPage(page, pageSize)
    const ids = (res.items || []).map((m) => m.user.id)
    const total = res.total ?? ids.length
    const i = ids.indexOf(userId)
    if (i >= 0) {
      const prev = i > 0 ? ids[i - 1] : previousLast
      let next: number | null = i < ids.length - 1 ? ids[i + 1] : null
      const index = (page - 1) * pageSize + i
      if (next == null && index < total - 1) {
        const after = await fetchPage(page + 1, pageSize)
        next = after.items?.[0]?.user.id ?? null
      }
      return { status: 'found', prev, next, index, total }
    }
    if (page * pageSize >= total || ids.length === 0) return { status: 'outside' }
    previousLast = ids[ids.length - 1] ?? null
    if (page === maxPages) return { status: 'too_large', total }
  }
  return { status: 'outside' }
}
