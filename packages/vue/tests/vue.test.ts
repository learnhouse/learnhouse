import { defineComponent, h, nextTick, ref } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { LearnHouseActivity, LearnHouseProvider, VERSION, useActivity, useLearnHouseClient } from '../dist/index.js'
import doc from '../../react/tests/fixtures/all-blocks.json'

const BASE = 'https://learn.example.com'
const COURSE = 'course_test'

const meta = {
  course_uuid: COURSE,
  org_uuid: 'org_test',
  org_id: 1,
  name: 'Payments',
  chapters: [{ name: 'Basics', activities: [{ name: 'How payouts work', activity_uuid: 'activity_payouts' }] }],
}
const activity = {
  activity_uuid: 'activity_payouts',
  name: 'How payouts work',
  activity_type: 'TYPE_DYNAMIC',
  activity_sub_type: 'SUBTYPE_DYNAMIC_PAGE',
  published: true,
  course_id: 11,
  org_id: 1,
  content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Fetched body' }] }] },
}

function mockFetch(routes: Record<string, unknown> = { [`/courses/${COURSE}/meta`]: meta, '/activities/activity_payouts': activity }) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input)
    const hit = Object.entries(routes).find(([p]) => url.includes(p))
    if (!hit) return new Response(JSON.stringify({ detail: 'Not Found' }), { status: 404 })
    return new Response(JSON.stringify(hit[1]), { status: 200, headers: { 'content-type': 'application/json' } })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

async function until(check: () => unknown, timeout = 10000) {
  const start = Date.now()
  for (;;) {
    await flushPromises()
    try {
      if (check()) return
    } catch {}
    if (Date.now() - start > timeout) throw new Error('timed out waiting for condition')
    await new Promise((r) => setTimeout(r, 20))
  }
}

const withProvider = (providerProps: Record<string, any>, child: () => any) =>
  defineComponent({ setup: () => () => h(LearnHouseProvider, providerProps as any, { default: child }) })

describe('LearnHouseActivity (Vue)', () => {
  // The renderer and its block chunks load lazily; the first mount pays for it.
  beforeAll(async () => {
    mockFetch()
    const w = mount(LearnHouseActivity, { props: { content: doc }, attachTo: document.body })
    await until(() => w.find('h2').exists(), 30000)
    w.unmount()
  }, 60000)

  it('renders every block of the fixture with the React renderer', async () => {
    mockFetch()
    const w = mount(withProvider({ baseUrl: BASE }, () => h(LearnHouseActivity, { content: doc, courseId: COURSE, orgId: 'org_test' })), { attachTo: document.body })
    await until(() => w.find('h2').exists())
    expect(w.find('learnhouse-activity .lh-activity').exists()).toBe(true)
    expect(w.find('h2').attributes('id')).toBe('heading-getting-paid')
    expect(w.find('strong').text()).toBe('weekly')
    expect(w.find('table th').text()).toBe('Plan')
    expect(w.find('pre code.language-javascript .hljs-keyword').text()).toBe('const')
    await until(() => w.text().includes('How long does your first payout take to arrive?'))
    await until(() => w.text().includes('What is a payout?'))
    expect(w.text()).toContain('Open dashboard')
    expect(w.findAll('[data-node-view-wrapper]').length).toBeGreaterThan(5)
    await until(() => w.find('img[src*="chart.png"]').exists())
    expect(w.find('img[src*="chart.png"]').attributes('src')).toContain(`${BASE}/content/orgs/org_test/courses/${COURSE}/`)
  })

  it('emits load, ready and event, and @link-click returning false cancels navigation', async () => {
    mockFetch()
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    const onLinkClick = vi.fn(() => false)
    const w = mount(LearnHouseActivity, { props: { content: doc, onLinkClick }, attachTo: document.body })
    await until(() => w.emitted('ready'))
    expect(w.emitted('load')![0][0]).toMatchObject({ activity_type: 'TYPE_DYNAMIC' })
    expect((w.emitted('event') as any[][]).map(([e]) => e.type)).toEqual(expect.arrayContaining(['load', 'ready']))
    const link = w.findAll('a').find((a) => a.text() === 'fee guide')!
    ;(link.element as HTMLAnchorElement).click()
    expect(onLinkClick).toHaveBeenCalledWith(expect.objectContaining({ href: 'https://example.com/fees', external: true }))
    expect(open).not.toHaveBeenCalled()
    expect((w.emitted('event') as any[][]).some(([e]) => e.type === 'link_click')).toBe(true)
  })

  it('passes props through to the renderer and reacts to changes', async () => {
    mockFetch()
    const showTitle = ref(false)
    const hide = ref<string[]>([])
    const w = mount(
      defineComponent({
        setup: () => () => h(LearnHouseActivity, { activity, showTitle: showTitle.value, hideBlocks: hide.value, dir: 'rtl' }),
      }),
      { attachTo: document.body },
    )
    await until(() => w.text().includes('Fetched body'))
    const el = w.find('learnhouse-activity').element as any
    expect(w.find('h1').exists()).toBe(false)
    expect(el.getAttribute('dir')).toBe('rtl')
    showTitle.value = true
    hide.value = ['paragraph']
    await until(() => w.find('h1').exists())
    expect(w.find('h1').text()).toBe('How payouts work')
    await until(() => !w.text().includes('Fetched body'))
    // Same element and React root the whole time.
    expect(w.find('learnhouse-activity').element).toBe(el)
  })

  it('renders header and footer slots with the activity, and fallback while loading', async () => {
    mockFetch()
    const w = mount(
      withProvider({ baseUrl: BASE }, () =>
        h(
          LearnHouseActivity,
          { activityId: 'activity_payouts', courseId: COURSE },
          {
            header: ({ activity }: any) => h('p', { class: 'hdr' }, `Lesson: ${activity.name}`),
            footer: ({ activity }: any) => h('p', { class: 'ftr' }, `End of ${activity.activity_uuid}`),
            fallback: () => h('p', { class: 'loading' }, 'Loading…'),
          },
        ),
      ),
      { attachTo: document.body },
    )
    expect(w.find('.loading').exists()).toBe(true)
    expect(w.find('.hdr').exists()).toBe(false)
    await until(() => w.text().includes('Fetched body'))
    expect(w.find('.loading').exists()).toBe(false)
    expect(w.find('.hdr').text()).toBe('Lesson: How payouts work')
    expect(w.find('.ftr').text()).toBe('End of activity_payouts')
    // Slots sit around the element, which keeps its place.
    const kids = [...w.find('.lh-activity-vue').element.children].map((c) => c.className || c.tagName.toLowerCase())
    expect(kids).toEqual(['hdr', 'learnhouse-activity', 'ftr'])
  })

  it('renders the error slot instead of the built-in message, with a working retry', async () => {
    mockFetch({})
    const w = mount(
      LearnHouseActivity,
      {
        props: { baseUrl: BASE, activityId: 'activity_missing' },
        slots: { error: ({ error, retry }: any) => h('button', { class: 'err', onClick: retry }, `failed: ${!!error.message}`) },
        attachTo: document.body,
      },
    )
    await until(() => w.find('.err').exists())
    expect(w.find('.err').text()).toBe('failed: true')
    expect(w.emitted('error')).toHaveLength(1)
    expect(w.find('[role="alert"]').exists()).toBe(false)
    mockFetch({ '/activities/activity_missing': activity, '/courses/id/11': { course_uuid: COURSE }, [`/courses/${COURSE}/meta`]: meta })
    await w.find('.err').trigger('click')
    await until(() => w.text().includes('Fetched body'))
    expect(w.find('.err').exists()).toBe(false)
  })
})

describe('LearnHouseProvider', () => {
  it('applies theme, locale, token and event defaults to activities below it', async () => {
    const fetchMock = mockFetch()
    const events: any[] = []
    const w = mount(
      withProvider(
        { baseUrl: BASE, token: 'user-jwt', theme: { mode: 'dark', accent: '#7c3aed' }, locale: 'ar', onEvent: (e: any) => events.push(e) },
        () => h(LearnHouseActivity, { activityId: 'activity_payouts', courseId: COURSE, theme: { radius: 4 } }),
      ),
      { attachTo: document.body },
    )
    await until(() => w.text().includes('Fetched body'))
    const root = w.find('.lh-activity').element as HTMLElement
    expect(root.classList.contains('dark')).toBe(true)
    expect(root.style.getPropertyValue('--lh-accent')).toBe('#7c3aed')
    expect(root.style.getPropertyValue('--lh-radius')).toBe('4px')
    expect(root.getAttribute('lang')).toBe('ar')
    expect(root.getAttribute('dir')).toBe('rtl')
    const [input, init] = fetchMock.mock.calls[0] as any[]
    expect(new Headers(input instanceof Request ? input.headers : init?.headers).get('authorization')).toBe('Bearer user-jwt')
    expect(events.map((e) => e.type)).toContain('load')
  })

  it('gives composables the SDK client, and useActivity fetches reactively', async () => {
    mockFetch({ '/activities/activity_payouts': activity, '/activities/activity_other': { ...activity, activity_uuid: 'activity_other', name: 'Other' } })
    const id = ref('activity_payouts')
    let api: any
    const Child = defineComponent({
      setup() {
        const client = useLearnHouseClient()
        const result = useActivity(id)
        api = { client, ...result }
        return () => h(LearnHouseActivity, { activity: result.activity.value ?? undefined })
      },
    })
    const w = mount(withProvider({ baseUrl: BASE }, () => h(Child)), { attachTo: document.body })
    expect(api.client.baseUrl).toBe(BASE)
    expect(api.loading.value).toBe(true)
    await until(() => api.activity.value?.name === 'How payouts work')
    expect(api.loading.value).toBe(false)
    await until(() => w.text().includes('Fetched body'))
    id.value = 'activity_other'
    await until(() => api.activity.value?.name === 'Other')
    id.value = 'activity_nope'
    await until(() => api.error.value)
    expect(api.activity.value).toBeNull()
  })

  it('throws a clear error when useLearnHouseClient has no provider', () => {
    const Lonely = defineComponent({ setup: () => (useLearnHouseClient(), () => null) })
    expect(() => mount(Lonely)).toThrow(/LearnHouseProvider/)
  })
})

describe('package', () => {
  it('reports the OSS version it ships with', async () => {
    const web = JSON.parse(readFileSync(path.join(import.meta.dirname, '../../../apps/web/package.json'), 'utf8'))
    expect(VERSION).toBe(web.version)
    await nextTick()
  })

  it('ships the renderer stylesheet', () => {
    const css = readFileSync(path.join(import.meta.dirname, '../dist/styles.css'), 'utf8')
    expect(css).toBe(readFileSync(path.join(import.meta.dirname, '../../react/dist/styles.css'), 'utf8'))
    expect(css).toContain('.lh-activity')
  })
})
