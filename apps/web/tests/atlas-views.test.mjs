import { describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'

// Atlas generative views (render_view): the client re-checks every spec
// before rendering (closed component list, cleaned strings, safe links) and
// each component renders from its validated props. Plus the pure helpers of
// the speed work: the live activity line and the block-split Markdown.
// EE is a separate checkout (absent in OSS CI), so the suite skips there.
const webRoot = path.resolve(import.meta.dirname, '..')
const atlas = path.join(webRoot, 'ee/components/Atlas')
const hasEE = fs.existsSync(path.join(atlas, 'blocks/views/spec.ts'))
const spec = hasEE ? await import(path.join(atlas, 'blocks/views/spec.ts')) : null
const React = hasEE ? (await import('react')).default : null
const { renderToStaticMarkup } = hasEE ? await import('react-dom/server') : {}
const ctx = hasEE ? await import(path.join(atlas, 'blocks/views/ViewContext.tsx')) : null
const comps = hasEE ? await import(path.join(atlas, 'blocks/views/components.tsx')) : null
const body = hasEE ? await import(path.join(atlas, 'blocks/views/ViewBody.tsx')) : null
const live = hasEE ? await import(path.join(atlas, 'activityLine.ts')) : null
const md = hasEE ? await import(path.join(atlas, 'markdownBlocks.ts')) : null

const h = (...a) => React.createElement(...a)
const render = (el, env = {}) =>
  renderToStaticMarkup(h(ctx.ViewEnvProvider, { env: { href: (l) => (l?.uuid ? `/x/${l.kind}/${l.uuid}` : l?.path || null), ...env } }, el))

const ALL = [
  { type: 'kpis', items: [{ label: 'Learners', value: 1234, delta: 4.5, unit: 'people' }] },
  { type: 'table', columns: [{ key: 'n', label: 'Name' }, { key: 'v', label: 'Views', format: 'number' }], rows: [{ n: 'Algebra', v: 3, _link: { kind: 'course', uuid: 'course_a' } }, { n: 'Bio', v: 9 }] },
  { type: 'chart', kind: 'donut', x_key: 'n', series: [{ key: 'v', label: 'V' }], data: [{ n: 'A', v: 2 }] },
  { type: 'timeline', items: [{ time: 'Mon', title: 'Kickoff', detail: 'All hands' }] },
  { type: 'steps', items: [{ title: 'Enroll' }, { title: 'Wait a week' }] },
  { type: 'comparison', columns: [{ title: 'Drip', items: ['Paced'] }, { title: 'Open', items: ['All at once'], highlight: true, badge: 'Default' }] },
  { type: 'checklist', items: [{ label: 'Cover', checked: true }, { label: 'SEO' }] },
  { type: 'progress', items: [{ label: 'Chapters', value: 3, max: 4 }] },
  { type: 'kanban', columns: [{ title: 'To do', cards: [{ title: 'Fix covers', badge: '3' }] }] },
  { type: 'flow', nodes: [{ id: 'a', label: 'Enroll', shape: 'start' }, { id: 'b', label: 'Chapter 1' }, { id: 'c', label: 'Done?', shape: 'decision' }], edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'c', label: '7 days' }] },
  { type: 'outline', title: 'Composting', chapters: [{ name: 'Basics', activities: [{ name: 'Intro', type: 'page' }, { name: 'Check', type: 'quiz' }] }] },
  { type: 'page', title: 'Draft', markdown: '# Hello' },
  { type: 'diff', before: 'the old title', after: 'the new title', fields: [{ field: 'Name', before: 'A', after: 'B' }] },
  { type: 'quiz', questions: [{ text: '2+2?', options: [{ text: '4', correct: true }, { text: '5' }] }] },
  { type: 'flashcards', cards: [{ front: 'TTL', back: 'Time to live' }] },
  { type: 'gallery', images: [{ kind: 'course', uuid: 'course_a', caption: 'Algebra', image: 'cover.png' }] },
  { type: 'callout', tone: 'warning', title: 'Heads up', text: 'Careful' },
  { type: 'choices', options: [{ label: 'Apply to all', prompt: 'Apply it to every course' }] },
  { type: 'cards', items: [{ kind: 'course', uuid: 'course_a', name: 'Algebra', badges: ['Draft'] }] },
  { type: 'text', markdown: 'Some **text**' },
]

describe.skipIf(!hasEE)('view spec guards', () => {
  test('every component type parses', () => {
    for (const c of ALL) expect(spec.parseComponent(c)?.type).toBe(c.type)
    // The 20 original types come first; the newer ones are tested in atlas-views-more.test.mjs.
    expect(spec.VIEW_COMPONENT_TYPES.slice(0, ALL.length)).toEqual(ALL.map((c) => c.type))
    const v = spec.parseView({ type: 'view', title: 'T', layout: 'grid', components: ALL })
    expect(v.components.length).toBe(12) // at most 12 components
    expect(v.layout).toBe('grid')
  })

  test('unknown types, scripts and junk are dropped, never rendered', () => {
    for (const bad of [
      { type: 'html', html: '<script>alert(1)</script>' },
      { type: 'script', src: 'x.js' },
      { type: '__proto__' },
      { type: 'constructor' },
      { type: 'toString' },
      { type: 'kpis', items: [] },
      { type: 'comparison', columns: [{ title: 'one' }] },
      { type: 'page' },
      { type: 'diff' },
      null,
      'kpis',
      [],
    ])
      expect(spec.parseComponent(bad)).toBeNull()
    expect(spec.parseView({ type: 'view', components: [{ type: 'html' }] })).toBeNull()
    expect(spec.parseView({ type: 'table' })).toBeNull()
    expect(spec.parseView(null)).toBeNull()
  })

  test('links are only entities or relative in-app paths', () => {
    for (const p of ['javascript:alert(1)', '//evil.example', 'https://evil.example', '/\tx', '/a\\b', 'data:text/html,x', '/ok"x'])
      expect(spec.safePath(p)).toBeUndefined()
    expect(spec.safePath('/dash/courses')).toBe('/dash/courses')
    expect(spec.parseLink({ kind: 'evil', uuid: 'x', path: 'javascript:x' })).toBeUndefined()
    expect(spec.parseLink({ kind: 'course', uuid: 'course_a b' })).toBeUndefined()
    expect(spec.parseLink({ kind: 'course', uuid: 'course_a' })).toEqual({ kind: 'course', uuid: 'course_a' })
    const t = spec.parseComponent({ type: 'table', columns: [{ key: 'a', label: 'A' }], rows: [{ a: 'x', _link: { path: 'javascript:1' } }] })
    expect(t.rows[0].link).toBeUndefined()
    // Gallery images: only file names the server set (no URLs).
    const g = spec.parseComponent({ type: 'gallery', images: [{ kind: 'course', uuid: 'course_a', image: 'https://evil/x.png' }] })
    expect(g.images[0].image).toBeUndefined()
  })

  test('strings are cleaned and clipped', () => {
    const c = spec.parseComponent({ type: 'callout', text: 'a\u0000b‮c' + 'z'.repeat(3000) })
    expect(c.text.startsWith('abc')).toBe(true)
    expect(c.text.length).toBe(2000)
    expect(spec.cleanText(5, 10)).toBe('5')
    expect(spec.cleanText({}, 10)).toBeUndefined()
  })

  test('flow drops dangling edges and duplicate nodes', () => {
    const f = spec.parseComponent({ type: 'flow', nodes: [{ id: 'a', label: 'A' }, { id: 'a', label: 'dup' }, { id: 'b', label: 'B' }], edges: [{ from: 'a', to: 'b' }, { from: 'a', to: 'zz' }, { from: 'a', to: 'a' }] })
    expect(f.nodes.length).toBe(2)
    expect(f.edges).toEqual([{ from: 'a', to: 'b', label: undefined }])
  })
})

describe.skipIf(!hasEE)('view helpers', () => {
  test('CSV quotes and defuses formulas', () => {
    const csv = spec.toCSV([{ key: 'a', label: 'A' }, { key: 'b', label: 'B, b' }], [{ a: '=1+1', b: 'say "hi"' }, { a: null, b: 3 }])
    expect(csv).toBe('A,"B, b"\n\'=1+1,"say ""hi"""\n,3')
  })

  test('rows sort numerically and by text, nulls last', () => {
    const rows = [{ cells: { v: 2, n: 'b' } }, { cells: { v: null, n: 'a' } }, { cells: { v: 10, n: 'c' } }]
    expect(spec.sortRows(rows, 'v', 'desc').map((r) => r.cells.v)).toEqual([10, 2, null])
    expect(spec.sortRows(rows, 'v', 'asc').map((r) => r.cells.v)).toEqual([2, 10, null])
    expect(spec.sortRows(rows, 'n', 'asc').map((r) => r.cells.n)).toEqual(['a', 'b', 'c'])
  })

  test('flow layout puts each node below what points to it', () => {
    const l = spec.layoutFlow([{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }], [{ from: 'a', to: 'b' }, { from: 'a', to: 'c' }, { from: 'b', to: 'd' }, { from: 'c', to: 'd' }, { from: 'd', to: 'a' }])
    const at = Object.fromEntries(l.nodes.map((n) => [n.id, n]))
    expect([at.a.layer, at.b.layer, at.c.layer, at.d.layer]).toEqual([0, 1, 1, 2])
    expect(at.b.y).toBe(at.c.y)
    expect(l.edges.length).toBe(5)
    const r = spec.layoutFlow([{ id: 'a' }, { id: 'b' }], [{ from: 'a', to: 'b' }], 'right')
    expect(r.nodes[1].x).toBeGreaterThan(r.nodes[0].x)
    expect(r.width).toBeGreaterThan(r.height)
  })

  test('word diff', () => {
    expect(spec.diffWords('the old title', 'the new title')).toEqual([
      { op: 'same', text: 'the ' },
      { op: 'del', text: 'old' },
      { op: 'add', text: 'new' },
      { op: 'same', text: ' title' },
    ])
    expect(spec.diffWords('', 'x')).toEqual([{ op: 'add', text: 'x' }])
  })
})

describe.skipIf(!hasEE)('view components render', () => {
  test('every component renders its content', () => {
    const md = (t) => h('div', { className: 'md' }, t)
    const out = render(h(body.default, { spec: spec.parseView({ type: 'view', title: 'All', components: ALL.slice(0, 12) }), renderMarkdown: md, onExpand: () => {} }))
    for (const s of ['1,234', 'Algebra', 'Kickoff', 'Wait a week', 'All at once', 'Default', 'Cover', '3 / 4', 'Fix covers', 'Enroll', 'Composting', '1 chapters · 2 lessons'])
      expect(out).toContain(s)
    expect(out).toContain('href="/x/course/course_a"') // table row link
    expect(out).toContain('<svg') // flow diagram
    expect(out).toContain('role="img"')
    expect(out).toContain('aria-label="Expand"')
    const rest = render(h(body.default, { spec: spec.parseView({ type: 'view', components: ALL.slice(12) }), renderMarkdown: md }), { image: (k, u, f) => `/media/${u}/${f}`, onSuggest: () => {} })
    for (const s of ['<del', '<ins', '2+2?', 'TTL', '/media/course_a/cover.png', 'Heads up', 'Apply to all', 'Some **text**'])
      expect(rest).toContain(s)
    expect(rest).not.toContain('Time to live') // the card's back stays hidden until flipped
  })

  test('a phone-width table also renders stacked rows', () => {
    const t = spec.parseComponent(ALL[1])
    const out = render(h(comps.TableView, { c: t }))
    expect(out).toContain('<table')
    expect(out).toContain('<dl') // the stacked cards for narrow containers
    expect(out).toContain('aria-label="Download CSV"')
  })

  test('the light surface and RTL are honoured', () => {
    const out = render(h(body.default, { spec: spec.parseView({ type: 'view', components: [ALL[9]] }), renderMarkdown: (t) => t }), { surface: 'light', rtl: true })
    expect(out).toContain('av-light')
    expect(out).toContain('--av-fg:#0b0a14')
  })

  test('choices are disabled without a follow-up handler', () => {
    const out = render(h(comps.ChoicesView, { c: spec.parseComponent(ALL[17]) }))
    expect(out).toContain('disabled')
  })

  test('numbers, percents, currencies and dates format by locale', () => {
    expect(comps.formatValue(1234.5, 'number', 'en')).toBe('1,234.5')
    expect(comps.formatValue(12.345, 'percent', 'en')).toBe('12.3%')
    expect(comps.formatValue(3725, 'duration', 'en')).toBe('1h 2m')
    expect(comps.formatValue(9, 'currency', 'en', 'EUR')).toBe('€9.00')
    expect(comps.formatValue(null, 'number', 'en')).toBe('–')
    expect(comps.formatValue(true, 'text', 'en')).toBe('✓')
    expect(comps.formatValue('2026-11-09', 'date', 'en')).toContain('2026')
  })
})

describe.skipIf(!hasEE)('live activity line', () => {
  const tool = (name, extra = {}) => ({ kind: 'tool', id: name, callId: name, name, status: 'running', ...extra })
  test('says what the running tool does, with its progress', () => {
    expect(live.activityLine([tool('list_courses', { args: { missing_thumbnail: true } })], true).key).toBe('courses_covers')
    const t = live.activityLine([tool('generate_course_thumbnails', { args: { courses: ['a', 'b'] }, progress: { done: 1, total: 2 } })], true)
    expect(t).toMatchObject({ key: 'thumbnails_n', opts: { count: 2 }, progress: { done: 1, total: 2 } })
    expect(live.activityLine([tool('search', { args: { query: 'x'.repeat(80) } })], true).opts.query.length).toBe(40)
    expect(live.activityLine([tool('update_course')], true).key).toBe('change')
    expect(live.activityLine([tool('list_widgets')], true)).toMatchObject({ key: 'reading', opts: { what: 'widgets' } })
    expect(live.activityLine([tool('frobnicate')], true).key).toBe('tool')
    const par = live.activityLine([tool('list_courses'), tool('run_analytics', { args: { query: 'top_courses' } })], true)
    expect(par).toMatchObject({ key: 'parallel', opts: { more: 1 }, inner: { key: 'courses' } })
  })
  test('thinking first, quiet while text streams, nothing when done', () => {
    expect(live.activityLine([], true).key).toBe('thinking')
    expect(live.activityLine([{ kind: 'text', id: 't', text: 'Hi' }], true)).toBeNull()
    expect(live.activityLine([{ ...tool('x'), status: 'ok' }], true).key).toBe('answer')
    expect(live.activityLine([tool('x')], false)).toBeNull()
  })
})

describe.skipIf(!hasEE)('streaming Markdown blocks', () => {
  test('splits on blank lines but keeps fences, continuations and loose lists whole', () => {
    const text = '# Title\n\nPara one\nstill one\n\n```js\na\n\nb\n```\n\n- a\n\n- b\n\n  more of b\n\nEnd'
    expect(md.splitMarkdownBlocks(text)).toEqual(['# Title', 'Para one\nstill one', '```js\na\n\nb\n```', '- a\n\n- b\n\n  more of b', 'End'])
    expect(md.splitMarkdownBlocks('')).toEqual([])
    expect(md.splitMarkdownBlocks('open fence\n\n```\nx')).toEqual(['open fence', '```\nx'])
  })
})
