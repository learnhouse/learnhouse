import { abortReason } from './http'

export interface PageContext {
  /** 1-based page number. */
  page: number
  pageSize: number
  signal?: AbortSignal
}

export interface PaginateOptions {
  /** Items per page. Default 20. */
  pageSize?: number
  /** First page to fetch. Default 1. */
  startPage?: number
  /** Stops the iteration between pages; pass it to your own call too. */
  signal?: AbortSignal
}

/**
 * Yields pages from `fetchPage` until `isLast` says the page was the final one.
 * Nothing is fetched after the last page, or after the consumer stops.
 * @internal
 */
export async function* pageLoop<P>(
  fetchPage: (ctx: PageContext) => Promise<P>,
  isLast: (page: P, pageSize: number) => boolean,
  options: PaginateOptions = {},
): AsyncGenerator<P, void, undefined> {
  const { pageSize = 20, startPage = 1, signal } = options
  if (!Number.isInteger(pageSize) || pageSize < 1) throw new RangeError('pageSize must be a positive integer')
  if (!Number.isInteger(startPage) || startPage < 1) throw new RangeError('startPage must be a positive integer')
  for (let page = startPage; ; page++) {
    if (signal?.aborted) throw abortReason(signal)
    const result = await fetchPage({ page, pageSize, signal })
    yield result
    if (isLast(result, pageSize)) return
  }
}

/**
 * Iterates every item of a page/limit endpoint. Stops after the first page
 * shorter than `pageSize` (an empty one included), so it never requests past
 * the end. `break` out of the loop to stop early.
 *
 * ```ts
 * for await (const c of paginate(({ page, pageSize, signal }) => lh.courses.list(slug, { page, limit: pageSize, signal }))) {}
 * ```
 */
export async function* paginate<T>(
  fetchPage: (ctx: PageContext) => Promise<readonly T[]>,
  options: PaginateOptions = {},
): AsyncGenerator<T, void, undefined> {
  for await (const items of pageLoop(fetchPage, (items, size) => items.length < size, options)) {
    yield* items
  }
}
