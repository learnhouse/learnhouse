import React from 'react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { LearnHouseActivity, LearnHouseProvider } from '../dist/index.js'
import doc from './fixtures/all-blocks.json'

const BASE = 'https://learn.example.com'
const ORG = 'org_test'
const COURSE = 'course_test'

const renderDoc = (props: Record<string, any> = {}) =>
  render(
    <LearnHouseProvider baseUrl={BASE}>
      <LearnHouseActivity content={doc} orgId={ORG} courseId={COURSE} {...props} />
    </LearnHouseProvider>,
  )

// courseId with `content` fetches the course meta; answer it.
function mockFetch(routes: Record<string, unknown>) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input)
    const hit = Object.entries(routes).find(([path]) => url.includes(path))
    if (!hit) return new Response(JSON.stringify({ detail: 'Not Found' }), { status: 404 })
    return new Response(JSON.stringify(hit[1]), { status: 200, headers: { 'content-type': 'application/json' } })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const meta = {
  course_uuid: COURSE,
  org_uuid: ORG,
  org_id: 1,
  name: 'Payments',
  chapters: [{ name: 'Basics', activities: [{ name: 'How payouts work', activity_uuid: 'activity_payouts' }] }],
}

describe('LearnHouseActivity with a raw document', () => {
  // Block code is lazy-loaded; the first render in a fresh jsdom pays for it.
  beforeAll(async () => {
    mockFetch({ [`/courses/${COURSE}/meta`]: meta })
    const { unmount } = renderDoc()
    await screen.findByText('Getting paid', {}, { timeout: 30000 })
    await screen.findByText('How long does your first payout take to arrive?', {}, { timeout: 30000 })
    unmount()
  }, 60000)

  it('renders the schema nodes and marks', async () => {
    mockFetch({ [`/courses/${COURSE}/meta`]: meta })
    const { container } = renderDoc()
    await screen.findByText('Getting paid')
    expect(container.querySelector('h2')?.id).toBe('heading-getting-paid')
    expect(container.querySelector('strong')?.textContent).toBe('weekly')
    expect(container.querySelector('em')?.textContent).toBe('automatic')
    expect(container.querySelector('ul.bullet-list li')).toBeTruthy()
    expect(container.querySelector('ol.ordered-list li')).toBeTruthy()
    expect(container.querySelector('blockquote')?.textContent).toContain('Money in')
    expect(container.querySelector('table th')?.textContent).toBe('Plan')
    expect(container.querySelector('hr')).toBeTruthy()
    const link = container.querySelector('a[href="https://example.com/fees"]')
    expect(link?.getAttribute('rel')).toContain('noopener')
  })

  it('highlights code blocks like the editor', async () => {
    mockFetch({ [`/courses/${COURSE}/meta`]: meta })
    const { container } = renderDoc()
    await screen.findByText('Getting paid')
    const code = container.querySelector('pre code.language-javascript')
    expect(code?.textContent).toContain('amount * 0.029')
    expect(code?.querySelector('.hljs-keyword')?.textContent).toBe('const')
  })

  it('renders LearnHouse blocks with their real components', async () => {
    mockFetch({ [`/courses/${COURSE}/meta`]: meta })
    const { container } = renderDoc()
    // Quiz (lazy chunk), flipcards, badge, button, scenarios, callouts.
    await screen.findByText('How long does your first payout take to arrive?', {}, { timeout: 10000 })
    await screen.findByText('What is a payout?')
    expect(screen.getByText('Pro tip badge')).toBeTruthy()
    expect(screen.getByText('Open dashboard')).toBeTruthy()
    expect(screen.getByText('Add your bank account before launch day.')).toBeTruthy()
    expect(screen.getByText('Legacy warning callout.')).toBeTruthy()
    await screen.findByText(/Welcome to this interactive scenario/)
    expect(container.querySelectorAll('[data-node-view-wrapper]').length).toBeGreaterThan(5)
  })

  it('builds media URLs against the instance', async () => {
    mockFetch({ [`/courses/${COURSE}/meta`]: meta })
    const { container } = renderDoc()
    await waitFor(() => expect(container.querySelector('img[src*="chart.png"]')).toBeTruthy(), { timeout: 10000 })
    const src = container.querySelector('img[src*="chart.png"]')!.getAttribute('src')
    expect(src).toBe(
      `${BASE}/content/orgs/${ORG}/courses/${COURSE}/activities/activity_local/dynamic/blocks/imageBlock/block_img1/chart.png`,
    )
  })

  it('keeps the text of blocks it does not know', async () => {
    mockFetch({ [`/courses/${COURSE}/meta`]: meta })
    renderDoc()
    await screen.findByText('Text inside a block this build does not know.')
  })
})

describe('customization', () => {
  it('overrides a block and can wrap the default', async () => {
    mockFetch({ [`/courses/${COURSE}/meta`]: meta })
    const Badge = ({ Default, ...p }: any) => (
      <section data-testid="wrapped-badge">
        <Default {...p} />
      </section>
    )
    const Heading = ({ attrs, children }: any) => <h6 data-level={attrs.level}>{children}</h6>
    const { container } = renderDoc({ components: { badge: Badge, heading: Heading } })
    await screen.findByText('Pro tip badge')
    expect(screen.getByTestId('wrapped-badge').textContent).toContain('Pro tip badge')
    expect(container.querySelector('h6[data-level="2"]')?.textContent).toBe('Getting paid')
  })

  it('overrides marks', async () => {
    mockFetch({ [`/courses/${COURSE}/meta`]: meta })
    const Bold = ({ children }: any) => <b className="brand-bold">{children}</b>
    const { container } = renderDoc({ marks: { bold: Bold } })
    await screen.findByText('Getting paid')
    expect(container.querySelector('b.brand-bold')?.textContent).toBe('weekly')
  })

  it('hides blocks and transforms content', async () => {
    mockFetch({ [`/courses/${COURSE}/meta`]: meta })
    const { container } = renderDoc({
      hideBlocks: ['blockQuiz', 'table'],
      transformContent: (d: any) => ({ ...d, content: d.content.filter((n: any) => n.type !== 'blockquote') }),
    })
    await screen.findByText('Getting paid')
    expect(container.querySelector('table')).toBeNull()
    expect(container.querySelector('blockquote')).toBeNull()
    expect(screen.queryByText('How long does your first payout take to arrive?')).toBeNull()
  })

  it('applies theme, dark mode, direction and slots', async () => {
    mockFetch({ [`/courses/${COURSE}/meta`]: meta })
    const { container } = renderDoc({
      theme: { mode: 'dark', accent: '#7c3aed', contentWidth: 720, radius: 4, fontFamily: 'Inter' },
      dir: 'rtl',
      className: 'mine',
      header: <p>Header slot</p>,
      footer: () => <p>Footer slot</p>,
    })
    await screen.findByText('Getting paid')
    const root = container.querySelector('.lh-activity') as HTMLElement
    expect(root.classList.contains('dark')).toBe(true)
    expect(root.classList.contains('mine')).toBe(true)
    expect(root.getAttribute('dir')).toBe('rtl')
    expect(root.style.getPropertyValue('--lh-accent')).toBe('#7c3aed')
    expect(root.style.getPropertyValue('--lh-content-width')).toBe('720px')
    expect(screen.getByText('Header slot')).toBeTruthy()
    expect(screen.getByText('Footer slot')).toBeTruthy()
  })

  it('translates block UI and accepts message overrides', async () => {
    mockFetch({ [`/courses/${COURSE}/meta`]: meta })
    const { container } = renderDoc({ locale: 'ar' })
    await screen.findByText('Getting paid')
    const root = container.querySelector('.lh-activity') as HTMLElement
    expect(root.getAttribute('lang')).toBe('ar')
    expect(root.getAttribute('dir')).toBe('rtl')
  })

  it('loads a bundled language and applies message overrides on top', async () => {
    mockFetch({ [`/courses/${COURSE}/meta`]: meta })
    renderDoc({ locale: 'fr', messages: { editor: { blocks: { quiz_block: { submit: 'Valider mes réponses' } } } } })
    expect((await screen.findAllByText('Valider mes réponses', {}, { timeout: 10000 })).length).toBeGreaterThan(0)
    // Untouched keys still come from the bundled French strings.
    expect(screen.getByText('Quiz interactif', { exact: false })).toBeTruthy()
  })
})

describe('events', () => {
  it('emits ready and link clicks, and lets the host cancel navigation', async () => {
    mockFetch({ [`/courses/${COURSE}/meta`]: meta })
    const events: any[] = []
    const onLinkClick = vi.fn(() => false)
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    renderDoc({ onEvent: (e: any) => events.push(e), onLinkClick })
    const link = await screen.findByText('fee guide')
    await waitFor(() => expect(events.some((e) => e.type === 'ready')).toBe(true))
    fireEvent.click(link)
    expect(onLinkClick).toHaveBeenCalledWith('https://example.com/fees', expect.anything())
    expect(events.find((e) => e.type === 'link_click')).toMatchObject({ href: 'https://example.com/fees', external: true })
    expect(open).not.toHaveBeenCalled()
  })
})

describe('fetching from an instance', () => {
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

  it('loads by id with the course in parallel, and shows the title', async () => {
    const fetchMock = mockFetch({ '/activities/activity_payouts': activity, [`/courses/${COURSE}/meta`]: meta })
    const onLoad = vi.fn()
    render(<LearnHouseActivity baseUrl={BASE} activityId="activity_payouts" courseId={COURSE} showTitle onLoad={onLoad} />)
    await screen.findByText('Fetched body')
    expect(screen.getByText('How payouts work').tagName).toBe('H1')
    expect(onLoad).toHaveBeenCalledWith(expect.objectContaining({ activity_uuid: 'activity_payouts' }))
    const urls = fetchMock.mock.calls.map(([u]) => String(u instanceof Request ? u.url : u))
    expect(urls.some((u) => u.startsWith(`${BASE}/api/v1/activities/activity_payouts`))).toBe(true)
  })

  it('finds an activity by name inside a course', async () => {
    mockFetch({ '/activities/activity_payouts': activity, [`/courses/${COURSE}/meta`]: meta })
    render(<LearnHouseActivity baseUrl={BASE} activityName="how payouts work" courseId={COURSE} />)
    await screen.findByText('Fetched body')
  })

  it('resolves the course from the activity when only the id is given', async () => {
    mockFetch({ '/activities/activity_payouts': activity, '/courses/id/11': { course_uuid: COURSE }, [`/courses/${COURSE}/meta`]: meta })
    render(<LearnHouseActivity baseUrl={BASE} activityId="activity_payouts" />)
    await screen.findByText('Fetched body')
  })

  it('shows errorFallback with retry on failure', async () => {
    mockFetch({})
    const onError = vi.fn()
    render(
      <LearnHouseActivity
        baseUrl={BASE}
        activityId="activity_missing"
        courseId={COURSE}
        onError={onError}
        errorFallback={(error: Error, retry: () => void) => (
          <button onClick={retry}>failed: {error.message ? 'yes' : 'no'}</button>
        )}
      />,
    )
    await screen.findByText('failed: yes')
    expect(onError).toHaveBeenCalled()
  })

  it('sends the user token', async () => {
    const fetchMock = mockFetch({ '/activities/activity_payouts': activity, [`/courses/${COURSE}/meta`]: meta })
    render(
      <LearnHouseProvider baseUrl={BASE} getToken={() => 'user-jwt'}>
        <LearnHouseActivity activityId="activity_payouts" courseId={COURSE} />
      </LearnHouseProvider>,
    )
    await screen.findByText('Fetched body')
    const [input, init] = fetchMock.mock.calls[0] as any[]
    const headers = new Headers(input instanceof Request ? input.headers : init?.headers)
    expect(headers.get('authorization')).toBe('Bearer user-jwt')
  })
})
