import { describe, expect, test } from 'bun:test'

import { neighboursInIds, scanForNeighbours } from '../components/Dashboard/Pages/Users/UserPanel/neighbours.ts'

// A fake members API over ids 1..n, in list order, paged like the real one.
function fakeApi(n) {
  const ids = Array.from({ length: n }, (_, i) => i + 1)
  const calls = []
  const fetchPage = async (page, limit) => {
    calls.push(page)
    return { items: ids.slice((page - 1) * limit, page * limit).map((id) => ({ user: { id } })), total: n }
  }
  return { fetchPage, calls }
}

describe('neighboursInIds', () => {
  test('finds prev and next inside the loaded page', () => {
    expect(neighboursInIds([5, 6, 7], 6)).toEqual({ status: 'found', prev: 5, next: 7, index: 1, total: 3 })
    expect(neighboursInIds([5, 6, 7], 5)).toMatchObject({ prev: null, next: 6 })
    expect(neighboursInIds([5, 6, 7], 7)).toMatchObject({ prev: 6, next: null })
  })
  test('returns null when the member is not on the page', () => {
    expect(neighboursInIds([5, 6, 7], 42)).toBeNull()
  })
})

describe('scanForNeighbours (member not on the loaded page)', () => {
  test('finds a member deep in the list', async () => {
    const api = fakeApi(250)
    expect(await scanForNeighbours(api.fetchPage, 150, { pageSize: 100 })).toEqual({
      status: 'found', prev: 149, next: 151, index: 149, total: 250,
    })
    expect(api.calls).toEqual([1, 2])
  })

  test('crosses page boundaries for prev and next', async () => {
    const first = fakeApi(250)
    expect(await scanForNeighbours(first.fetchPage, 101, { pageSize: 100 })).toMatchObject({ prev: 100, next: 102 })
    const last = fakeApi(250)
    expect(await scanForNeighbours(last.fetchPage, 200, { pageSize: 100 })).toMatchObject({ prev: 199, next: 201 })
    expect(last.calls).toEqual([1, 2, 3])
  })

  test('the ends of the list have no neighbour on that side', async () => {
    expect(await scanForNeighbours(fakeApi(3).fetchPage, 1)).toMatchObject({ prev: null, next: 2 })
    expect(await scanForNeighbours(fakeApi(3).fetchPage, 3)).toMatchObject({ prev: 2, next: null })
  })

  test('a member filtered out of the list is reported as outside', async () => {
    const api = fakeApi(150)
    expect(await scanForNeighbours(api.fetchPage, 999, { pageSize: 100 })).toEqual({ status: 'outside' })
    expect(api.calls).toEqual([1, 2])
  })

  test('stops scanning a very long list', async () => {
    const api = fakeApi(5000)
    expect(await scanForNeighbours(api.fetchPage, 4999, { pageSize: 100, maxPages: 3 })).toEqual({ status: 'too_large', total: 5000 })
    expect(api.calls).toEqual([1, 2, 3])
  })
})
