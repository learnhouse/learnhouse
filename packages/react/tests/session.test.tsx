import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { LearnHouseActivity, LearnHouseProvider, useLearnHouseSession } from '../dist/index.js'
import { isCompletedInTrail } from '../src/completion'

const BASE = 'https://learn.example.com'

/** An unsigned JWT-shaped token: the components only read `exp` and `sub`. */
function jwt(claims: Record<string, unknown>) {
  const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
  return `${b64({ alg: 'HS256' })}.${b64(claims)}.sig`
}
const inMinutes = (m: number) => Math.floor(Date.now() / 1000) + m * 60

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

type Handler = (req: { method: string; url: string; auth: string | null }) => { status?: number; body: unknown } | undefined

function mockApi(handler: Handler) {
  const calls: { method: string; url: string; auth: string | null }[] = []
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input instanceof Request ? input.url : input)
    const method = (init.method ?? 'GET').toUpperCase()
    const auth = new Headers(init.headers).get('authorization')
    const req = { method, url, auth }
    calls.push(req)
    const res = handler(req)
    if (!res) return new Response(JSON.stringify({ detail: 'Not Found' }), { status: 404 })
    return new Response(JSON.stringify(res.body), {
      status: res.status ?? 200,
      headers: { 'content-type': 'application/json' },
    })
  })
  vi.stubGlobal('fetch', fetchMock)
  return calls
}

function learnerApi(extra?: Handler): Handler {
  let completed = false
  return (req) => {
    const hit = extra?.(req)
    if (hit) return hit
    const { method, url } = req
    if (url.includes('/users/session')) return { body: { user: { id: 9, username: 'lea' }, roles: [] } }
    if (url.includes('/courses/course_test/meta')) return { body: meta }
    if (url.endsWith('/activities/activity_x')) return { body: activity }
    if (url.includes('/trail/org/1/trail')) return { body: { runs: [{ course_id: 3, steps: completed ? [{ activity_id: 5 }] : [] }] } }
    if (method === 'POST' && url.includes('/trail/add_activity/activity_x')) {
      completed = true
      return { body: { runs: [{ course_id: 3, steps: [{ activity_id: 5 }] }] } }
    }
    if (method === 'DELETE' && url.includes('/trail/remove_activity/activity_x')) {
      completed = false
      return { body: { runs: [{ course_id: 3, steps: [] }] } }
    }
    return undefined
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('completion helpers', () => {
  it('finds a completion in a trail', () => {
    const trail = { runs: [{ course_id: 3, steps: [{ activity_id: 5 }] }] }
    expect(isCompletedInTrail(trail, 3, 5)).toBe(true)
    expect(isCompletedInTrail(trail, 3, 6)).toBe(false)
    expect(isCompletedInTrail(trail, 4, 5)).toBe(false)
    expect(isCompletedInTrail(null, 3, 5)).toBe(false)
  })
})

describe('LearnHouseProvider with a learner session', () => {
  it('acts as the learner: bearer on every call, completion toggle saved to progress', async () => {
    const token = jwt({ sub: 'lea@example.com', exp: inMinutes(15) })
    const calls = mockApi(learnerApi())
    const onEvent = vi.fn()
    render(
      <LearnHouseProvider baseUrl={BASE} getSession={async () => ({ access_token: token, expires_at: inMinutes(15) })}>
        <LearnHouseActivity activityId="activity_x" courseId="course_test" onEvent={onEvent} />
      </LearnHouseProvider>,
    )

    await screen.findByText('Hello learner', {}, { timeout: 30000 })
    const button = await screen.findByRole('button', { name: /mark as complete/i })
    expect(button.getAttribute('aria-pressed')).toBe('false')

    fireEvent.click(button)
    await screen.findByRole('button', { name: /completed/i })
    expect(onEvent).toHaveBeenCalledWith({ type: 'progress', activityId: 'activity_x', completed: true })

    fireEvent.click(screen.getByRole('button', { name: /completed/i }))
    await screen.findByRole('button', { name: /mark as complete/i })
    expect(onEvent).toHaveBeenCalledWith({ type: 'progress', activityId: 'activity_x', completed: false })

    const api = calls.filter((c) => c.url.startsWith(BASE))
    expect(api.length).toBeGreaterThan(3)
    expect(api.every((c) => c.auth === `Bearer ${token}`)).toBe(true)
    expect(calls.some((c) => c.url.includes('/users/session'))).toBe(true)
  }, 60000)

  it('exposes the learner through useLearnHouseSession', async () => {
    mockApi(learnerApi())
    let seen: any = null
    function Probe() {
      seen = useLearnHouseSession()
      return null
    }
    render(
      <LearnHouseProvider baseUrl={BASE} session={jwt({ sub: 'lea@example.com', exp: inMinutes(15) })}>
        <Probe />
      </LearnHouseProvider>,
    )
    await waitFor(() => expect(seen?.data?.user?.id).toBe(9))
    expect(seen.status).toBe('authenticated')
  })

  it('fetches a new session and retries once when the API answers 401', async () => {
    const stale = jwt({ sub: 'lea@example.com', exp: inMinutes(15), n: 1 })
    const fresh = jwt({ sub: 'lea@example.com', exp: inMinutes(15), n: 2 })
    const getSession = vi.fn(async () => fresh)
    const calls = mockApi(
      learnerApi((req) =>
        req.auth === `Bearer ${stale}` && req.url.endsWith('/activities/activity_x') ? { status: 401, body: {} } : undefined,
      ),
    )
    render(
      <LearnHouseProvider baseUrl={BASE} session={stale} getSession={getSession}>
        <LearnHouseActivity activityId="activity_x" courseId="course_test" completion="none" />
      </LearnHouseProvider>,
    )
    await screen.findByText('Hello learner', {}, { timeout: 30000 })
    expect(getSession).toHaveBeenCalled()
    const activityCalls = calls.filter((c) => c.url.endsWith('/activities/activity_x'))
    expect(activityCalls.map((c) => c.auth)).toEqual([`Bearer ${stale}`, `Bearer ${fresh}`])
    expect(screen.queryByRole('button', { name: /mark as complete/i })).toBeNull()
  })

  it('stays anonymous and read-only without a session', async () => {
    const calls = mockApi(learnerApi())
    render(
      <LearnHouseProvider baseUrl={BASE}>
        <LearnHouseActivity activityId="activity_x" courseId="course_test" />
      </LearnHouseProvider>,
    )
    await screen.findByText('Hello learner', {}, { timeout: 30000 })
    expect(screen.queryByRole('button', { name: /mark as complete/i })).toBeNull()
    expect(calls.every((c) => c.auth === null)).toBe(true)
    expect(calls.some((c) => c.url.includes('/trail/'))).toBe(false)
  })

  it('takes the session on a standalone component too', async () => {
    const token = jwt({ sub: 'lea@example.com', exp: inMinutes(15) })
    const calls = mockApi(learnerApi())
    render(<LearnHouseActivity baseUrl={BASE} session={{ access_token: token }} activityId="activity_x" courseId="course_test" />)
    await screen.findByRole('button', { name: /mark as complete/i }, { timeout: 30000 })
    expect(calls.find((c) => c.url.endsWith('/activities/activity_x'))?.auth).toBe(`Bearer ${token}`)
  })

  it('drops an expired session it cannot renew and reports it', async () => {
    const token = jwt({ sub: 'lea@example.com', exp: Math.floor(Date.now() / 1000) + 1 })
    mockApi(learnerApi())
    const onEvent = vi.fn()
    let seen: any = null
    function Probe() {
      seen = useLearnHouseSession()
      return null
    }
    render(
      <LearnHouseProvider baseUrl={BASE} session={token} onEvent={onEvent}>
        <Probe />
      </LearnHouseProvider>,
    )
    expect(seen.status).toBe('authenticated')
    await waitFor(() => expect(onEvent).toHaveBeenCalledWith({ type: 'session_expired' }), { timeout: 3000 })
    expect(seen.status).toBe('unauthenticated')
  })

  it('refuses an org API token', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() =>
      render(
        <LearnHouseProvider baseUrl={BASE} session="lh_secret">
          <div />
        </LearnHouseProvider>,
      ),
    ).toThrow(/API token/)
  })

  it('asks for a session before rendering assignments, then loads the learner view', async () => {
    const assignment = vi.fn()
    mockApi(
      learnerApi((req) => {
        if (req.url.endsWith('/activities/activity_a')) {
          return { body: { ...activity, activity_uuid: 'activity_a', activity_type: 'TYPE_ASSIGNMENT', content: {} } }
        }
        if (req.url.includes('/assignments/activity/activity_a')) {
          assignment(req.auth)
          return { status: 404, body: { detail: 'Assignment not found' } }
        }
        return undefined
      }),
    )
    const { unmount } = render(
      <LearnHouseProvider baseUrl={BASE}>
        <LearnHouseActivity activityId="activity_a" courseId="course_test" />
      </LearnHouseProvider>,
    )
    await screen.findByText(/need a signed-in learner/i, {}, { timeout: 30000 })
    unmount()

    const token = jwt({ sub: 'lea@example.com', exp: inMinutes(15) })
    const onError = vi.fn()
    render(
      <LearnHouseProvider baseUrl={BASE} session={token}>
        <LearnHouseActivity activityId="activity_a" courseId="course_test" onError={onError} />
      </LearnHouseProvider>,
    )
    await screen.findByText(/assignment is not available/i, {}, { timeout: 30000 })
    expect(assignment).toHaveBeenCalledWith(`Bearer ${token}`)
    expect(onError).toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: /mark as complete/i })).toBeNull()
  }, 60000)
})
