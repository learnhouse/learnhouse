import { describe, expect, it, vi } from 'vitest'
import { createClient, paginate, type PageContext } from '../src'
import { json, mockFetch } from './helpers'

const BASE = 'http://api.test'

/** A fetchPage over fixed pages that records which pages were asked for. */
function pages<T>(...data: T[][]) {
  const asked: PageContext[] = []
  const fetchPage = vi.fn(async (ctx: PageContext) => {
    asked.push(ctx)
    return data[ctx.page - 1] ?? []
  })
  return { fetchPage, asked }
}

async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = []
  for await (const x of it) out.push(x)
  return out
}

describe('paginate', () => {
  it('walks pages until a short one', async () => {
    const p = pages([1, 2], [3, 4], [5])
    expect(await collect(paginate(p.fetchPage, { pageSize: 2 }))).toEqual([1, 2, 3, 4, 5])
    expect(p.asked.map((c) => [c.page, c.pageSize])).toEqual([
      [1, 2],
      [2, 2],
      [3, 2],
    ])
  })

  it('stops on an empty page after a full one', async () => {
    const p = pages([1, 2], [3, 4], [], [99])
    expect(await collect(paginate(p.fetchPage, { pageSize: 2 }))).toEqual([1, 2, 3, 4])
    expect(p.fetchPage).toHaveBeenCalledTimes(3)
  })

  it('makes one request for an empty first page', async () => {
    const p = pages<number>()
    expect(await collect(paginate(p.fetchPage))).toEqual([])
    expect(p.asked).toEqual([{ page: 1, pageSize: 20, signal: undefined }])
  })

  it('fetches nothing more after an early break', async () => {
    const p = pages([1, 2], [3, 4], [5])
    const seen: number[] = []
    for await (const n of paginate(p.fetchPage, { pageSize: 2 })) {
      seen.push(n)
      if (n === 2) break
    }
    expect(seen).toEqual([1, 2])
    expect(p.fetchPage).toHaveBeenCalledTimes(1)
  })

  it('starts at startPage and hands the signal to fetchPage', async () => {
    const ac = new AbortController()
    const p = pages([1], [2], [])
    expect(await collect(paginate(p.fetchPage, { pageSize: 1, startPage: 2, signal: ac.signal }))).toEqual([2])
    expect(p.asked.map((c) => c.page)).toEqual([2, 3])
    expect(p.asked[0].signal).toBe(ac.signal)
  })

  it('stops between pages when the signal aborts', async () => {
    const ac = new AbortController()
    const p = pages([1, 2], [3, 4])
    const it = paginate(p.fetchPage, { pageSize: 2, signal: ac.signal })
    expect((await it.next()).value).toBe(1)
    expect((await it.next()).value).toBe(2)
    ac.abort()
    await expect(it.next()).rejects.toMatchObject({ name: 'AbortError' })
    expect(p.fetchPage).toHaveBeenCalledTimes(1)
  })

  it('rejects a bad pageSize or startPage', async () => {
    const p = pages([1])
    await expect(paginate(p.fetchPage, { pageSize: 0 }).next()).rejects.toThrow(RangeError)
    await expect(paginate(p.fetchPage, { pageSize: 1.5 }).next()).rejects.toThrow(RangeError)
    await expect(paginate(p.fetchPage, { startPage: 0 }).next()).rejects.toThrow(RangeError)
    expect(p.fetchPage).not.toHaveBeenCalled()
  })
})

const urls = (m: ReturnType<typeof mockFetch>) => m.calls.map((c) => c.url.slice(BASE.length))
const course = (n: number) => ({ course_uuid: `course_${n}`, name: `C${n}` })

describe('courses.listAll', () => {
  it('pages through every course with 100 per page by default', async () => {
    const full = Array.from({ length: 100 }, (_, i) => course(i))
    const m = mockFetch(json(full), json([course(100)]))
    const client = createClient({ baseUrl: BASE, fetch: m.fetch })
    const all = []
    for await (const c of client.courses.listAll('acme')) all.push(c)
    expect(all).toHaveLength(101)
    expect(urls(m)).toEqual([
      '/api/v1/courses/org_slug/acme/page/1/limit/100',
      '/api/v1/courses/org_slug/acme/page/2/limit/100',
    ])
  })

  it('caps pageSize at the API limit and forwards includeUnpublished and the signal', async () => {
    const m = mockFetch(json([course(1)]))
    const client = createClient({ baseUrl: BASE, fetch: m.fetch })
    const ac = new AbortController()
    const { listAll } = client.courses // still works destructured
    const all = []
    for await (const c of listAll('acme', { pageSize: 250, includeUnpublished: true, signal: ac.signal })) all.push(c)
    expect(all).toEqual([course(1)])
    expect(urls(m)).toEqual(['/api/v1/courses/org_slug/acme/page/1/limit/100?include_unpublished=true'])
  })

  it('stops at a short page of a custom size', async () => {
    const m = mockFetch(json([course(1), course(2)]), json([course(3)]))
    const client = createClient({ baseUrl: BASE, fetch: m.fetch })
    const names = []
    for await (const c of client.courses.listAll('acme', { pageSize: 2 })) names.push(c.name)
    expect(names).toEqual(['C1', 'C2', 'C3'])
    expect(m.calls).toHaveLength(2)
  })
})

describe('search.orgPages', () => {
  const empty = { courses: [], activities: [], folders: [], users: [], communities: [], discussions: [], playgrounds: [], podcasts: [], total_courses: 0 }

  it('yields pages until every result type is short', async () => {
    const m = mockFetch(
      json({ ...empty, courses: [1, 2], users: [1] }),
      json({ ...empty, courses: [3], users: [] }),
    )
    const client = createClient({ baseUrl: BASE, fetch: m.fetch })
    const got = []
    for await (const page of client.search.orgPages('acme', 'react', { pageSize: 2 })) got.push(page.courses.length)
    expect(got).toEqual([2, 1])
    expect(urls(m)).toEqual([
      '/api/v1/search/org_slug/acme?query=react&page=1&limit=2',
      '/api/v1/search/org_slug/acme?query=react&page=2&limit=2',
    ])
  })

  it('defaults to and caps at 50 per page', async () => {
    const m = mockFetch(json(empty))
    const client = createClient({ baseUrl: BASE, fetch: m.fetch })
    const { orgPages } = client.search
    for await (const _ of orgPages('acme', 'react')) void _
    for await (const _ of orgPages('acme', 'react', { pageSize: 500 })) void _
    expect(urls(m)).toEqual([
      '/api/v1/search/org_slug/acme?query=react&page=1&limit=50',
      '/api/v1/search/org_slug/acme?query=react&page=1&limit=50',
    ])
  })
})
