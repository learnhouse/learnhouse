import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import { LearnHouseActivity, LearnHouseProvider, useCourseProgress, useTrail } from '../dist/index.js'

const BASE = 'https://learn.example.com'

function jwt(claims: Record<string, unknown>) {
  const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
  return `${b64({ alg: 'HS256' })}.${b64(claims)}.sig`
}
const inMinutes = (m: number) => Math.floor(Date.now() / 1000) + m * 60
const LEA = jwt({ sub: 'lea@example.com', exp: inMinutes(15) })
const BOB = jwt({ sub: 'bob@example.com', exp: inMinutes(15) })

const activity = {
  id: 5,
  activity_uuid: 'activity_x',
  name: 'Lesson',
  activity_type: 'TYPE_DYNAMIC',
  activity_sub_type: 'SUBTYPE_DYNAMIC_PAGE',
  published: true,
  course_id: 3,
  org_id: 1,
  content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello learner' }] }] },
}
const meta = { id: 3, org_id: 1, course_uuid: 'course_test', org_uuid: 'org_test', name: 'C', chapters: [] }

interface Call {
  method: string
  url: string
  auth: string | null
}

/** A tiny fake API holding one learner's trail in org 1, course 3 (2 activities). */
function fakeApi(opts: { enrolled?: boolean; failTrail?: number } = {}) {
  let enrolled = opts.enrolled ?? true
  let steps: number[] = []
  const trail = () => ({
    id: 1,
    runs: enrolled ? [{ course_id: 3, course: { course_uuid: 'course_test' }, course_total_steps: 2, steps: steps.map((activity_id) => ({ activity_id })) }] : [],
  })
  const calls: Call[] = []
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input instanceof Request ? input.url : input)
    const method = (init.method ?? 'GET').toUpperCase()
    calls.push({ method, url, auth: new Headers(init.headers).get('authorization') })
    const send = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
    if (url.includes('/users/session')) return send({ user: { id: 9 }, roles: [] })
    if (url.includes('/trail/org/1/trail')) return opts.failTrail ? send({ detail: 'nope' }, opts.failTrail) : send(trail())
    if (method === 'POST' && url.includes('/trail/add_course/course_test')) {
      enrolled = true
      return send(trail())
    }
    if (method === 'DELETE' && url.includes('/trail/remove_course/course_test')) {
      enrolled = false
      steps = []
      return send(trail())
    }
    if (method === 'POST' && url.includes('/trail/add_activity/activity_x')) {
      steps = [...new Set([...steps, 5])]
      return send(trail())
    }
    if (method === 'DELETE' && url.includes('/trail/remove_activity/activity_x')) {
      steps = steps.filter((s) => s !== 5)
      return send(trail())
    }
    if (url.includes('/courses/course_test/meta')) return send(meta)
    if (url.endsWith('/activities/activity_x')) return send(activity)
    return send({ detail: 'Not Found' }, 404)
  })
  vi.stubGlobal('fetch', fetchMock)
  const trailGets = () => calls.filter((c) => c.method === 'GET' && c.url.includes('/trail/org/1/trail')).length
  return { calls, trailGets }
}

const wrapper =
  (session: string | null = LEA) =>
  ({ children }: { children: React.ReactNode }) => (
    <LearnHouseProvider baseUrl={BASE} session={session}>
      {children}
    </LearnHouseProvider>
  )

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useTrail', () => {
  it('throws outside a provider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => renderHook(() => useTrail(1))).toThrow(/inside <LearnHouseProvider>/)
    spy.mockRestore()
  })

  it('loads the trail once with the learner session', async () => {
    const api = fakeApi()
    const { result } = renderHook(() => useTrail(1), { wrapper: wrapper() })
    await waitFor(() => expect(result.current.trail).toBeTruthy())
    expect(result.current.loading).toBe(false)
    expect(api.trailGets()).toBe(1)
    expect(api.calls.find((c) => c.url.includes('/trail/'))?.auth).toBe(`Bearer ${LEA}`)
  })

  it('waits for an org id before loading', async () => {
    const api = fakeApi()
    const { result, rerender } = renderHook(({ org }: { org: number | null }) => useTrail(org), {
      wrapper: wrapper(),
      initialProps: { org: null },
    })
    expect(result.current.trail).toBeUndefined()
    expect(api.trailGets()).toBe(0)
    rerender({ org: 1 })
    await waitFor(() => expect(result.current.trail).toBeTruthy())
  })

  it('is null and loads nothing when signed out', async () => {
    const api = fakeApi()
    const { result } = renderHook(() => useTrail(1), { wrapper: wrapper(null) })
    await new Promise((r) => setTimeout(r, 50))
    expect(result.current.trail).toBeNull()
    expect(api.trailGets()).toBe(0)
  })

  it('reports the API error with a null trail', async () => {
    fakeApi({ failTrail: 403 })
    const { result } = renderHook(() => useTrail(1), { wrapper: wrapper() })
    await waitFor(() => expect(result.current.error).toBeTruthy())
    expect(result.current.trail).toBeNull()
    expect(result.current.error?.message).toBe('nope')
  })

  it('refresh() loads it again', async () => {
    const api = fakeApi()
    const { result } = renderHook(() => useTrail(1), { wrapper: wrapper() })
    await waitFor(() => expect(result.current.trail).toBeTruthy())
    await act(() => result.current.refresh())
    expect(api.trailGets()).toBe(2)
  })
})

describe('useCourseProgress', () => {
  it('computes progress and shares one load between hooks', async () => {
    const api = fakeApi()
    const { result } = renderHook(() => ({ a: useCourseProgress(1, 'course_test'), b: useCourseProgress(1, 3) }), {
      wrapper: wrapper(),
    })
    await waitFor(() => expect(result.current.a.progress).toBeTruthy())
    expect(result.current.a.progress).toMatchObject({ enrolled: true, completed: 0, total: 2, percent: 0 })
    expect(result.current.b.progress).toEqual(result.current.a.progress)
    expect(api.trailGets()).toBe(1)
  })

  it('complete/uncomplete update every hook from the response, without reloading', async () => {
    const api = fakeApi()
    const { result } = renderHook(() => ({ a: useCourseProgress(1, 'course_test'), b: useCourseProgress(1, 'test') }), {
      wrapper: wrapper(),
    })
    await waitFor(() => expect(result.current.a.progress).toBeTruthy())
    await act(() => result.current.a.complete('activity_x'))
    expect(result.current.b.progress).toMatchObject({ completed: 1, percent: 50 })
    expect(result.current.b.isCompleted(5)).toBe(true)
    await act(() => result.current.b.uncomplete('activity_x'))
    expect(result.current.a.isCompleted(5)).toBe(false)
    expect(api.trailGets()).toBe(1)
  })

  it('enroll and leave, with a bare course uuid', async () => {
    const api = fakeApi({ enrolled: false })
    const { result } = renderHook(() => useCourseProgress(1, 'test'), { wrapper: wrapper() })
    await waitFor(() => expect(result.current.progress).toBeTruthy())
    expect(result.current.progress?.enrolled).toBe(false)
    await act(() => result.current.enroll())
    expect(result.current.progress?.enrolled).toBe(true)
    expect(api.calls.some((c) => c.method === 'POST' && c.url.endsWith('/trail/add_course/course_test'))).toBe(true)
    // Already enrolled: no second request (the API would answer 400).
    await act(() => result.current.enroll())
    expect(api.calls.filter((c) => c.url.includes('/add_course/')).length).toBe(1)
    await act(() => result.current.leave())
    expect(result.current.progress?.enrolled).toBe(false)
  })

  it('enroll needs the course uuid and a known org', async () => {
    fakeApi()
    const { result } = renderHook(() => ({ byId: useCourseProgress(1, 3), noOrg: useCourseProgress(null, 'course_test') }), {
      wrapper: wrapper(),
    })
    await waitFor(() => expect(result.current.byId.progress).toBeTruthy())
    await expect(result.current.byId.enroll()).rejects.toThrow(/course uuid/)
    await expect(result.current.byId.leave()).rejects.toThrow(/course uuid/)
    await expect(result.current.noOrg.complete('activity_x')).rejects.toThrow(/orgId/)
    expect(result.current.noOrg.progress).toBeNull()
  })

  it('a failed action rejects and keeps the progress', async () => {
    fakeApi()
    const { result } = renderHook(() => useCourseProgress(1, 'course_test'), { wrapper: wrapper() })
    await waitFor(() => expect(result.current.progress).toBeTruthy())
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ detail: 'Forbidden' }), { status: 403, headers: { 'content-type': 'application/json' } })))
    await expect(result.current.complete('activity_x')).rejects.toMatchObject({ status: 403 })
    expect(result.current.progress?.completed).toBe(0)
  })

  it('starts over for a different learner', async () => {
    const api = fakeApi()
    // Switching the session clears the shared trail and loads it as the new learner.
    let seen: ReturnType<typeof useTrail> | null = null
    function Probe() {
      seen = useTrail(1)
      return null
    }
    const view = render(
      <LearnHouseProvider baseUrl={BASE} session={LEA}>
        <Probe />
      </LearnHouseProvider>,
    )
    await waitFor(() => expect(seen?.trail).toBeTruthy())
    view.rerender(
      <LearnHouseProvider baseUrl={BASE} session={BOB}>
        <Probe />
      </LearnHouseProvider>,
    )
    await waitFor(() => expect(api.calls.some((c) => c.url.includes('/trail/') && c.auth === `Bearer ${BOB}`)).toBe(true))
  }, 20000)
})

describe('hooks and the completion button share the trail', () => {
  it('marking an activity complete in the component updates a progress hook elsewhere', async () => {
    const api = fakeApi()
    function Header() {
      const { progress } = useCourseProgress(1, 'course_test')
      return <p data-testid="percent">{progress ? `${progress.percent}%` : '…'}</p>
    }
    render(
      <LearnHouseProvider baseUrl={BASE} session={LEA}>
        <Header />
        <LearnHouseActivity activityId="activity_x" courseId="course_test" />
      </LearnHouseProvider>,
    )
    await screen.findByText('Hello learner', {}, { timeout: 30000 })
    await waitFor(() => expect(screen.getByTestId('percent').textContent).toBe('0%'))
    fireEvent.click(await screen.findByRole('button', { name: /mark as complete/i }))
    await waitFor(() => expect(screen.getByTestId('percent').textContent).toBe('50%'))
    await screen.findByRole('button', { name: /completed/i })
    // One trail load for the header and the button together.
    expect(api.trailGets()).toBe(1)
  }, 60000)

  it('completing through the hook flips the component button', async () => {
    fakeApi()
    let complete: ((uuid: string) => Promise<void>) | null = null
    function Driver() {
      complete = useCourseProgress(1, 'course_test').complete
      return null
    }
    render(
      <LearnHouseProvider baseUrl={BASE} session={LEA}>
        <Driver />
        <LearnHouseActivity activityId="activity_x" courseId="course_test" />
      </LearnHouseProvider>,
    )
    await screen.findByRole('button', { name: /mark as complete/i }, { timeout: 30000 })
    await act(() => complete!('activity_x'))
    await screen.findByRole('button', { name: /completed/i })
  }, 60000)
})
