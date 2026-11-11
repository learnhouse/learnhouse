import type { HttpCore } from '../core/http'
import { pageLoop } from '../core/paginate'
import type { BaseRequestOptions } from '../core/types'
import type { SearchResult } from '../models'

export interface SearchOptions extends BaseRequestOptions {
  /** 1-based. Default 1 (server side). */
  page?: number
  /** 1..50. Default 10 (server side). */
  limit?: number
}

export interface SearchPagesOptions extends BaseRequestOptions {
  /** Results per type per request, 1..50 (the API's cap). Default 50. */
  pageSize?: number
}

/** The API serves at most this many results of each type per page. */
const MAX_SEARCH_PAGE = 50

// Each result type is paged on its own; the search is done once all are short.
function isLastSearchPage(result: SearchResult, pageSize: number): boolean {
  return Object.values(result).every((v) => !Array.isArray(v) || v.length < pageSize)
}

export function createSearchResource(http: HttpCore) {
  // Named so methods still work when destructured off the resource.
  const resource = {
    /**
     * Search courses, activities, folders, users, ... within an org. The query
     * must be 3-200 characters. `GET /api/v1/search/org_slug/{org_slug}`
     */
    org(orgSlug: string, query: string, options: SearchOptions = {}): Promise<SearchResult> {
      const { page, limit, ...rest } = options
      return http.GET('/api/v1/search/org_slug/{org_slug}', {
        ...rest,
        params: { path: { org_slug: orgSlug }, query: { query, page, limit } },
      })
    },
    /**
     * `org()` page by page: yields each SearchResult until every result type
     * comes back shorter than `pageSize`. Search is rate limited (60/min).
     */
    orgPages(orgSlug: string, query: string, options: SearchPagesOptions = {}): AsyncGenerator<SearchResult, void, undefined> {
      const { pageSize = MAX_SEARCH_PAGE, ...rest } = options
      const size = Math.min(pageSize, MAX_SEARCH_PAGE)
      return pageLoop(({ page }) => resource.org(orgSlug, query, { ...rest, page, limit: size }), isLastSearchPage, {
        pageSize: size,
        signal: rest.signal,
      })
    },
  }
  return resource
}

export type SearchResource = ReturnType<typeof createSearchResource>
