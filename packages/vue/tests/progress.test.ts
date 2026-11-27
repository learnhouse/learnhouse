import { defineComponent, h, nextTick, ref } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LearnHouseActivity, LearnHouseProvider, useCourseProgress, useTrail } from '../dist/index.js'

const BASE = 'https://learn.example.com'
function jwt(claims: Record<string, unknown>) {
  const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
  return `${b64({ alg: 'HS256' })}.${b64(claims)}.sig`
}
const exp = Math.floor(Date.now() / 1000) + 900
const LEA = jwt({ sub: 'lea@example.com', exp })
const BOB = jwt({ sub: 'bob@example.com', exp })

function fakeApi(opts: { enrolled?: boolean; failTrail?: number } = {}) {
  let enrolled = opts.enrolled ?? true
  let steps: number[] = []
  const trail = () => ({
    id: 1,
    runs: enrolled ? [{ course_id: 3, course: { course_uuid: 'course_test' }, course_total_steps: 2, steps: steps.map((activity_id) => ({ activity_id })) }] : [],
  })
  const calls: Array<{ method: string; url: string; auth: string | null }> = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input instanceof Request ? input.url : input)
      const method = (init.method ?? 'GET').toUpperCase()
      calls.push({ method, url, auth: new Headers(init.headers).get('authorization') })
      const send = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
      if (url.includes('/trail/org/1/trail')) return opts.failTrail ? send({ detail: 'nope' }, opts.failTrail) : send(trail())
      if (method === 'POST' && url.includes('/trail/add_course/course_test')) {
        enrolled = true
        return send(trail())
      }
      if (method === 'DELETE' && url.includes('/trail/remove_course/course_test')) {
        enrolled = false
        return send(trail())
      }
      if (method === 'POST' && url.includes('/trail/add_activity/activity_x')) {
        steps = [5]
        return send(trail())
      }
      if (method === 'DELETE' && url.includes('/trail/remove_activity/activity_x')) {
        steps = []
        return send(trail())
      }
      return send({ detail: 'Not Found' }, 404)
    }),
  )
  return { calls, trailGets: () => calls.filter((c) => c.method === 'GET' && c.url.includes('/trail/org/1/trail')).length }
}

/** Mounts `setup` under a provider and hands back what it returns. */
function withProvider<T>(setup: () => T, session: string = LEA) {
  let out!: T
  const Child = defineComponent({
    setup() {
      out = setup()
      return () => null
    },
  })
  const sessionRef = ref(session)
  const wrapper = mount(
    defineComponent({
      setup: () => () => h(LearnHouseProvider, { baseUrl: BASE, session: sessionRef.value }, { default: () => h(Child) }),
    }),
  )
  return { get: () => out, wrapper, sessionRef }
}

afterEach(() => vi.unstubAllGlobals())

describe('useTrail', () => {
  it('throws without a provider', () => {
    const Bad = defineComponent({
      setup() {
        useTrail(1)
        return () => null
      },
    })
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(() => mount(Bad)).toThrow(/LearnHouseProvider/)
    spy.mockRestore()
  })

  it('loads once with the learner session', async () => {
    const api = fakeApi()
    const t = withProvider(() => useTrail(1))
    await flushPromises()
    expect(t.get().trail.value).toBeTruthy()
    expect(t.get().loading.value).toBe(false)
    expect(api.trailGets()).toBe(1)
    expect(api.calls[0].auth).toBe(`Bearer ${LEA}`)
  })

  it('follows a reactive org id and waits while it is null', async () => {
    const api = fakeApi()
    const org = ref<number | null>(null)
    const t = withProvider(() => useTrail(org))
    await flushPromises()
    expect(t.get().trail.value).toBeUndefined()
    expect(api.trailGets()).toBe(0)
    org.value = 1
    await flushPromises()
    expect(t.get().trail.value).toBeTruthy()
  })

  it('exposes an API error with a null trail', async () => {
    fakeApi({ failTrail: 401 })
    const t = withProvider(() => useTrail(1))
    await flushPromises()
    expect(t.get().trail.value).toBeNull()
    expect(t.get().error.value?.message).toBe('nope')
  })

  it('refresh() reloads', async () => {
    const api = fakeApi()
    const t = withProvider(() => useTrail(1))
    await flushPromises()
    await t.get().refresh()
    expect(api.trailGets()).toBe(2)
  })

  it('starts over when another learner signs in', async () => {
    const api = fakeApi()
    const t = withProvider(() => useTrail(1))
    await flushPromises()
    t.sessionRef.value = BOB
    await nextTick()
    await flushPromises()
    expect(api.calls.some((c) => c.url.includes('/trail/') && c.auth === `Bearer ${BOB}`)).toBe(true)
  })
})

describe('useCourseProgress', () => {
  it('shares one load and updates every instance from action responses', async () => {
    const api = fakeApi()
    const t = withProvider(() => ({ a: useCourseProgress(1, 'course_test'), b: useCourseProgress(1, 3) }))
    await flushPromises()
    expect(t.get().a.progress.value).toMatchObject({ enrolled: true, completed: 0, total: 2 })
    await t.get().a.complete('activity_x')
    expect(t.get().b.progress.value).toMatchObject({ completed: 1, percent: 50 })
    expect(t.get().b.isCompleted(5)).toBe(true)
    await t.get().b.uncomplete('activity_x')
    expect(t.get().a.isCompleted(5)).toBe(false)
    expect(api.trailGets()).toBe(1)
  })

  it('enrolls once (bare uuid) and leaves', async () => {
    const api = fakeApi({ enrolled: false })
    const t = withProvider(() => useCourseProgress(1, 'test'))
    await flushPromises()
    expect(t.get().progress.value?.enrolled).toBe(false)
    await t.get().enroll()
    await t.get().enroll()
    expect(t.get().progress.value?.enrolled).toBe(true)
    expect(api.calls.filter((c) => c.url.endsWith('/trail/add_course/course_test'))).toHaveLength(1)
    await t.get().leave()
    expect(t.get().progress.value?.enrolled).toBe(false)
  })

  it('refuses enroll without a uuid and actions without an org', async () => {
    fakeApi()
    const t = withProvider(() => ({ byId: useCourseProgress(1, 3), noOrg: useCourseProgress(null, 'course_test') }))
    await flushPromises()
    await expect(t.get().byId.enroll()).rejects.toThrow(/course uuid/)
    await expect(t.get().noOrg.complete('activity_x')).rejects.toThrow(/orgId/)
    expect(t.get().noOrg.progress.value).toBeNull()
  })
})

describe('activities keep the composables in step', () => {
  it("an activity's progress event reloads the provider's trail", async () => {
    const api = fakeApi()
    let trail: ReturnType<typeof useTrail> | null = null
    const Probe = defineComponent({
      setup() {
        trail = useTrail(1)
        return () => null
      },
    })
    const onProgress = vi.fn()
    const content = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Body' }] }] }
    const w = mount(
      defineComponent({
        setup: () => () =>
          h(LearnHouseProvider, { baseUrl: BASE, session: LEA }, { default: () => [h(Probe), h(LearnHouseActivity, { content, onProgress })] }),
      }),
      { attachTo: document.body },
    )
    await flushPromises()
    expect(trail!.trail.value).toBeTruthy()
    const before = api.trailGets()
    w.find('learnhouse-activity').element.dispatchEvent(
      new CustomEvent('lh-progress', { detail: { type: 'progress', activityId: 'activity_x', completed: true } }),
    )
    await flushPromises()
    expect(api.trailGets()).toBe(before + 1)
    expect(onProgress).toHaveBeenCalledWith({ type: 'progress', activityId: 'activity_x', completed: true })
    w.unmount()
  })
})
