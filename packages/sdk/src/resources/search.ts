import type { HttpCore } from '../core/http'
import type { BaseRequestOptions } from '../core/types'
import type { SearchResult } from '../models'

export interface SearchOptions extends BaseRequestOptions {
  /** 1-based. Default 1 (server side). */
  page?: number
  /** 1..50. Default 10 (server side). */
  limit?: number
}

export function createSearchResource(http: HttpCore) {
  return {
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
  }
}

export type SearchResource = ReturnType<typeof createSearchResource>
