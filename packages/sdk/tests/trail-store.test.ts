import { describe, expect, it, vi } from 'vitest'
import { createClient, TrailStore, type Trail } from '../src'
import { json, mockFetch } from './helpers'

const BASE = 'http://api.test'
const trailWith = (steps: number[]) => ({ id: 1, runs: [{ course_id: 3, course: { course_uuid: 'course_c' }, course_total_steps: 2, steps: steps.map((activity_id) => ({ activity_id })) }] }) as unknown as Trail

function setup(...responses: Parameters<typeof mockFetch>) {
  const m = mockFetch(...responses)
  const client = createClient({ baseUrl: BASE, fetch: m.fetch, token: 't', retry: false })
  return { m, store: new TrailStore(client) }
}

describe('TrailStore', () => {
  it('starts empty, loads once and shares concurrent loads', async () => {
    const { m, store } = setup(json(trailWith([1])))
    expect(store.get(1)).toEqual({ trail: undefined, loading: false, error: null })
    const [a, b] = await Promise.all([store.load(1), store.load(1)])
    expect(a).toBe(b)
    expect(m.calls).toHaveLength(1)
    expect(m.calls[0].url).toBe(`${BASE}/api/v1/trail/org/1/trail`)
    await store.load(1)
    expect(m.calls).toHaveLength(1)
    await store.load(1, { force: true })
    expect(m.calls).toHaveLength(2)
  })

  it('reports loading and notifies subscribers with the org id', async () => {
    const { store } = setup(json(trailWith([])))
    const seen: Array<[number, boolean]> = []
    const off = store.subscribe((org) => seen.push([org, store.get(org).loading]))
    await store.load(7)
    off()
    await store.load(7, { force: true })
    expect(seen).toEqual([
      [7, true],
      [7, false],
    ])
  })

  it('keeps the state object stable until it changes', async () => {
    const { store } = setup(json(trailWith([])))
    await store.load(1)
    expect(store.get(1)).toBe(store.get(1))
  })

  it('turns a failed load into trail null with the error', async () => {
    const { store } = setup(json({ detail: 'Not authenticated' }, 401))
    await expect(store.load(1)).resolves.toBeNull()
    expect(store.get(1).trail).toBeNull()
    expect(store.get(1).error?.message).toBe('Not authenticated')
  })

  it.each([
    ['enroll', (s: TrailStore) => s.enroll(1, 'course_c'), 'POST', '/api/v1/trail/add_course/course_c'],
    ['leave', (s: TrailStore) => s.leave(1, 'course_c'), 'DELETE', '/api/v1/trail/remove_course/course_c'],
    ['complete', (s: TrailStore) => s.complete(1, 'activity_a'), 'POST', '/api/v1/trail/add_activity/activity_a'],
    ['uncomplete', (s: TrailStore) => s.uncomplete(1, 'activity_a'), 'DELETE', '/api/v1/trail/remove_activity/activity_a'],
  ])('%s calls the API and shares the returned trail without reloading', async (_n, run, method, path) => {
    const returned = trailWith([1, 2])
    const { m, store } = setup(json(returned))
    const listener = vi.fn()
    store.subscribe(listener)
    await expect(run(store)).resolves.toEqual(returned)
    expect(m.calls.map((c) => `${c.method} ${c.url.slice(BASE.length)}`)).toEqual([`${method} ${path}`])
    expect(store.get(1).trail).toEqual(returned)
    expect(listener).toHaveBeenCalledWith(1)
  })

  it('reloads when a mutation answers without runs', async () => {
    const { m, store } = setup(json({ ok: true }), json(trailWith([1])))
    await store.complete(1, 'activity_a')
    expect(m.calls.map((c) => c.method)).toEqual(['POST', 'GET'])
    expect(store.get(1).trail).toEqual(trailWith([1]))
  })

  it('a failed mutation throws and leaves the state alone', async () => {
    const { store } = setup(json(trailWith([1])), json({ detail: 'nope' }, 403))
    await store.load(1)
    const before = store.get(1)
    await expect(store.complete(1, 'activity_a')).rejects.toMatchObject({ status: 403 })
    expect(store.get(1)).toBe(before)
  })

  it('reload() loads again only the orgs already loaded', async () => {
    const { m, store } = setup(json(trailWith([])))
    await store.load(1)
    await store.load(2)
    await store.reload()
    expect(m.calls.map((c) => c.url.slice(BASE.length))).toEqual([
      '/api/v1/trail/org/1/trail',
      '/api/v1/trail/org/2/trail',
      '/api/v1/trail/org/1/trail',
      '/api/v1/trail/org/2/trail',
    ])
    store.clear()
    await expect(store.reload()).resolves.toEqual([])
  })

  it('set() and clear()', () => {
    const { store } = setup(json({}))
    const listener = vi.fn()
    store.subscribe(listener)
    store.set(2, trailWith([]))
    expect(store.get(2).trail).toEqual(trailWith([]))
    store.clear()
    expect(store.get(2).trail).toBeUndefined()
    expect(listener).toHaveBeenCalledTimes(2)
  })
})
