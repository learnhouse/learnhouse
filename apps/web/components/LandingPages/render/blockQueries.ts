// Query options for the landing page's data blocks, shared by the blocks and by
// the org home, which starts these fetches as soon as the page document says
// the blocks are there, instead of after the renderer and the blocks' own
// chunk have downloaded. Same key + same fetcher, so the block then reads the
// prefetched entry.
import { getOrgCourses } from '@services/courses/courses'

export const LANDING_BLOCK_STALE = 60_000

export const landingCoursesQuery = (orgslug: string, accessToken?: string) => ({
  queryKey: ['landing-block', 'courses', orgslug, !!accessToken] as const,
  queryFn: async () => {
    const res = await getOrgCourses(orgslug, null, accessToken)
    return Array.isArray(res) ? res : []
  },
  staleTime: LANDING_BLOCK_STALE,
})

// Block types whose component lives in a lazily loaded chunk of the renderer.
const DATA_BLOCKS = ['courses', 'course', 'paths', 'communities', 'podcasts', 'live_sessions', 'pricing']
const FORM_BLOCKS = ['newsletter', 'form']
const RICH_BLOCKS = ['richtext', 'embed', 'html']

/** Which lazy block groups a page document uses (any depth, symbols included). */
export function lazyBlockGroups(doc: unknown): { data: boolean; forms: boolean; rich: boolean; courses: boolean } {
  const types = new Set<string>()
  const seen = new Set<unknown>()
  const walk = (v: unknown, depth: number) => {
    if (!v || typeof v !== 'object' || depth > 64 || seen.has(v)) return
    seen.add(v)
    if (Array.isArray(v)) {
      for (const x of v) walk(x, depth + 1)
      return
    }
    const o = v as Record<string, unknown>
    if (typeof o.type === 'string') types.add(o.type)
    for (const k in o) walk(o[k], depth + 1)
  }
  walk(doc, 0)
  const has = (list: string[]) => list.some((t) => types.has(t))
  return { data: has(DATA_BLOCKS), forms: has(FORM_BLOCKS), rich: has(RICH_BLOCKS), courses: types.has('courses') || types.has('course') }
}
