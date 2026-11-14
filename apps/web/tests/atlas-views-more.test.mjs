import { describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'

// The newer Atlas view components (heatmap ... whatif): client guards drop
// malformed parts, the pure helpers (formula parser, blanks, shuffle, scales)
// behave, and every renderer draws its sample on the dark and light
// surfaces, in RTL, without crashing. EE is a separate checkout (absent in
// OSS CI), so the suite skips there.
const webRoot = path.resolve(import.meta.dirname, '..')
const views = path.join(webRoot, 'ee/components/Atlas/blocks/views')
const hasEE = fs.existsSync(path.join(views, 'specMore.ts'))
const spec = hasEE ? await import(path.join(views, 'spec.ts')) : null
const samples = hasEE ? await import(path.join(views, 'gallerySamples.ts')) : null
const React = hasEE ? (await import('react')).default : null
const { renderToStaticMarkup } = hasEE ? await import('react-dom/server') : {}
const ctx = hasEE ? await import(path.join(views, 'ViewContext.tsx')) : null
const body = hasEE ? await import(path.join(views, 'ViewBody.tsx')) : null
const data = hasEE ? await import(path.join(views, 'moreData.tsx')) : null
const structure = hasEE ? await import(path.join(views, 'moreStructure.tsx')) : null
const content = hasEE ? await import(path.join(views, 'moreContent.tsx')) : null
const exercises = hasEE ? await import(path.join(views, 'moreExercises.tsx')) : null

const h = (...a) => React.createElement(...a)
const render = (el, env = {}) =>
  renderToStaticMarkup(h(ctx.ViewEnvProvider, { env: { href: (l) => (l?.uuid ? `/x/${l.kind}/${l.uuid}` : l?.path || null), ...env } }, el))
const md = (t) => h('div', { className: 'md' }, t)

const NEW_TYPES = hasEE ? Object.keys(samples.NEW_SAMPLES) : []

const RENDERERS = hasEE
  ? {
      heatmap: data.HeatmapView, funnel: data.FunnelView, cohort: data.CohortView, radar: data.RadarView, gauge: data.GaugeView,
      leaderboard: data.LeaderboardView, sparklines: data.SparklinesView, geo: data.GeoView, matrix: data.MatrixView,
      tree: structure.TreeView, mindmap: structure.MindmapView, gantt: structure.GanttView,
      email: content.EmailView, profile: content.ProfileView, rubric: content.RubricView, glossary: content.GlossaryView,
      matching: exercises.MatchingView, ordering: exercises.OrderingView, fill_blanks: exercises.FillBlanksView, whatif: exercises.WhatIfView,
    }
  : {}

// What each sample must show once rendered (text that proves the data made it).
const EXPECT = {
  heatmap: ['Mon', 'Sun', 'Peak'], funnel: ['Enrolled', '4,820', 'drop'], cohort: ['Week 8', '71%', 'Sep 15'],
  radar: ['Syntax', 'Ana Silva', '<polygon'], gauge: ['82%', 'Target 90%', 'role="meter"'], leaderboard: ['Ana Silva', 'Rank 1', '42'],
  sparklines: ['Daily active learners', '182', '<path'], geo: ['France', '🇫🇷', '31.5%'], matrix: ['Quick wins', 'Effort', 'Add captions to videos'],
  tree: ['Python 101', 'role="tree"', 'aria-expanded="true"'], mindmap: ['Photosynthesis', 'Calvin cycle'], gantt: ['Write chapters 1-4', 'Week', 'Milestone'],
  email: ['Chapter 3 of Python 101 is open', 'Learners of Python 101', 'Start chapter 3'], profile: ['Ana Silva', 'Python 101', '82%'],
  rubric: ['Thesis', 'Excellent', '4 pts', 'Weight 30%'], glossary: ['Latency', 'Bandwidth'], matching: ['H₂O', 'Table salt', 'Check'],
  ordering: ['Ask a question', 'Move up', 'Check'], fill_blanks: ['Gap 1', 'Word bank', 'Celsius'], whatif: ['Monthly revenue', '$6,370.00', 'type="range"'],
}

describe.skipIf(!hasEE)('newer view specs', () => {
  test('22 newer types, after the original 20, each with a sample', () => {
    expect(spec.MORE_COMPONENT_TYPES.length).toBe(22)
    expect(spec.VIEW_COMPONENT_TYPES.length).toBe(42)
    expect(spec.VIEW_COMPONENT_TYPES.slice(20)).toEqual([...spec.MORE_COMPONENT_TYPES])
    expect(new Set(NEW_TYPES)).toEqual(new Set(spec.MORE_COMPONENT_TYPES))
    for (const t of Object.keys(samples.LEGACY_SAMPLES)) expect(spec.parseComponent(samples.LEGACY_SAMPLES[t])?.type).toBe(t)
  })

  test('every sample parses to its own type', () => {
    for (const t of NEW_TYPES) expect(spec.parseComponent(samples.NEW_SAMPLES[t])?.type).toBe(t)
    for (const r of samples.REPAIR_SAMPLES) expect(spec.parseComponent(r.drawn)).not.toBeNull()
  })

  test('malformed or empty newer components are dropped, never rendered', () => {
    for (const bad of [
      { type: 'heatmap', x_labels: ['a'], y_labels: ['b'], values: [[null]] },
      { type: 'funnel', stages: [{ label: 'one', value: 1 }] },
      { type: 'funnel', stages: [{ label: 'a', value: -1 }, { label: 'b', value: 2 }] },
      { type: 'cohort', periods: [], rows: [] },
      { type: 'radar', axes: ['a', 'b'], series: [{ label: 'x', values: [1, 2] }] },
      { type: 'gauge', value: 5, min: 10, max: 10 },
      { type: 'gauge', value: 'lots' },
      { type: 'leaderboard', entries: [{ name: 'A', value: 'many' }] },
      { type: 'sparklines', items: [{ label: 'x', value: 1, points: [1] }] },
      { type: 'geo', items: [{ country: 'france', value: 3 }] },
      { type: 'matrix', x_label: 'X', items: [{ label: 'a', x: 0, y: 0 }] },
      { type: 'tree', nodes: [{ children: [] }] },
      { type: 'mindmap', center: 'x', branches: [] },
      { type: 'gantt', tasks: [{ label: 'a', start: 'soon' }] },
      { type: 'math', blocks: [] },
      { type: 'code', code: '' },
      { type: 'email', subject: 'x' },
      { type: 'profile', stats: [] },
      { type: 'rubric', levels: [{ label: 'only' }], criteria: [{ label: 'c' }] },
      { type: 'glossary', terms: [{ term: 'x' }] },
      { type: 'matching', pairs: [{ left: 'a', right: 'b' }] },
      { type: 'ordering', items: ['one'] },
      { type: 'fill_blanks', text: 'no gaps here' },
      { type: 'whatif', variables: [{ key: 'x', label: 'X', min: 0, max: 1 }], outputs: [{ label: 'r', formula: 'alert(1)' }] },
      { type: 'whatif', variables: [{ key: 'Bad Key', label: 'X', min: 0, max: 1 }], outputs: [{ label: 'r', formula: '1' }] },
    ])
      expect(spec.parseComponent(bad)).toBeNull()
  })

  test('pictures and links stay safe', () => {
    const lb = spec.parseComponent({ type: 'leaderboard', entries: [{ name: 'A', value: 1, image: '../../etc/passwd', link: { kind: 'user', uuid: 'user_1', path: 'javascript:x' } }] })
    expect(lb.entries[0].image).toBeUndefined()
    expect(lb.entries[0].link).toEqual({ kind: 'user', uuid: 'user_1' })
    const em = spec.parseComponent({ type: 'email', subject: 's', body: 'b', cta_label: 'Go', cta_path: 'https://evil.example' })
    expect(em.cta_path).toBeUndefined()
    const p = spec.parseComponent({ type: 'profile', name: 'A', user_uuid: 'bad uuid', image: 'ok.png' })
    expect(p.user_uuid).toBeUndefined()
    expect(p.image).toBe('ok.png')
  })

  test('values are clamped and ragged grids padded', () => {
    const c = spec.parseComponent({ type: 'cohort', periods: ['1', '2', '3'], rows: [{ label: 'a', values: [140, -3] }] })
    expect(c.rows[0].values).toEqual([100, 0, null])
    const hm = spec.parseComponent({ type: 'heatmap', x_labels: ['a', 'b'], y_labels: ['r', 's'], values: [[1]] })
    expect(hm.values).toEqual([[1, null], [null, null]])
    const g = spec.parseComponent({ type: 'gantt', tasks: [{ label: 'a', start: 3, end: 1 }] })
    expect(g.scale).toBe('number')
    expect(g.tasks[0].end).toBe(3)
    const d = spec.parseComponent({ type: 'gantt', scale: 'date', tasks: [{ label: 'a', start: '2026-11-02', end: '2026-11-09' }] })
    expect(d.tasks[0].end - d.tasks[0].start).toBe(7)
    expect(spec.isoFromDay(d.tasks[0].start)).toBe('2026-11-02')
  })
})

describe.skipIf(!hasEE)('newer view helpers', () => {
  test('formulas: arithmetic, precedence, functions, no eval', () => {
    const f = (src, vars = {}) => spec.compileFormula(src, new Set(Object.keys(vars)))(vars)
    expect(f('1 + 2 * 3')).toBe(7)
    expect(f('(1 + 2) * 3')).toBe(9)
    expect(f('2 ^ 3 ^ 2')).toBe(512)
    expect(f('2 ** 3')).toBe(8)
    expect(f('-2 ^ 2')).toBe(-4)
    expect(f('10 % 4 + abs(-3)')).toBe(5)
    expect(f('round(2.345, 2) + min(1, 4) + max(2, 3)')).toBeCloseTo(6.35)
    expect(f('sqrt(16) + floor(1.9) + ceil(1.1)')).toBe(7)
    expect(f('price * buyers', { price: 49, buyers: 130 })).toBe(6370)
    expect(Number.isNaN(f('1 / 0'))).toBe(true)
    for (const bad of ['alert(1)', 'x.y', 'constructor', '1 +', '(1', '1 2', 'a = 1', '"s"', 'price[0]', '__proto__'])
      expect(() => spec.compileFormula(bad, new Set(['price']))).toThrow()
  })

  test('fill in the blanks: gaps, alternatives, lenient answers', () => {
    const parts = spec.parseBlanks('Water boils at [[100]] °[[Celsius|C]].')
    expect(parts.filter((p) => p.kind === 'gap').map((p) => p.answers)).toEqual([['100'], ['Celsius', 'C']])
    expect(parts[0]).toEqual({ kind: 'text', text: 'Water boils at ' })
    expect(spec.answerMatches(' celsius ', ['Celsius'])).toBe(true)
    expect(spec.answerMatches('Café.', ['cafe'])).toBe(true)
    expect(spec.answerMatches('', ['x'])).toBe(false)
    expect(spec.answerMatches('Kelvin', ['Celsius', 'C'])).toBe(false)
  })

  test('seeded shuffle is stable and never the identity', () => {
    const a = spec.seededShuffle([1, 2, 3, 4], 'seed')
    expect(a).toEqual(spec.seededShuffle([1, 2, 3, 4], 'seed'))
    expect(a).not.toEqual([1, 2, 3, 4])
    expect([...a].sort()).toEqual([1, 2, 3, 4])
    expect(spec.seededShuffle([1, 2], 'x')).toEqual([2, 1])
  })

  test('scales, paths and labels', () => {
    expect(spec.shade(5, 0, 10)).toBe(0.5)
    expect(spec.shade(null, 0, 10)).toBeNull()
    expect(spec.shade(3, 3, 3)).toBe(1)
    expect(spec.niceMax(73)).toBe(100)
    expect(spec.niceMax(0.3)).toBe(0.5)
    expect(spec.niceMax(0)).toBe(1)
    expect(spec.sparkPath([1, 1], 96, 32)).toBe('M2.0 16.0 L94.0 16.0')
    expect(spec.sparkPath([1], 96, 32)).toBe('')
    const [x, y] = spec.radarPoint(0, 4, 1, 50, 50, 10)
    expect([Math.round(x), Math.round(y)]).toEqual([50, 40])
    expect(spec.flagEmoji('FR')).toBe('🇫🇷')
    expect(spec.flagEmoji('fr')).toBe('')
    expect(spec.ganttTicks(1, 13, 'number')).toEqual([1, 4, 7, 10, 13])
    expect(spec.weekdayName(1, 'en')).toBe('Mon')
    expect(spec.weekdayName(7, 'fr')).toContain('dim')
    expect(spec.countryName('DE', 'en')).toBe('Germany')
    expect(spec.arcPath(100, 100, 80, 0, Math.PI)).toBe('M20.00 100.00 A80 80 0 0 1 180.00 100.00')
  })
})

describe.skipIf(!hasEE)('newer view components render', () => {
  for (const type of Object.keys(EXPECT)) {
    if (!RENDERERS[type] && type !== 'math' && type !== 'code') continue
    test(`${type} renders its data on dark, light and RTL`, () => {
      const c = spec.parseComponent(samples.NEW_SAMPLES[type])
      const Comp = RENDERERS[type]
      for (const env of [{}, { surface: 'light' }, { rtl: true, locale: 'ar' }]) {
        const out = render(h(Comp, { c, render: md }), env)
        if (!env.locale) for (const s of EXPECT[type]) expect(out).toContain(s)
        expect(out.length).toBeGreaterThan(200)
      }
    })
  }

  test('math and code render lazily inside a view, then for real', async () => {
    const v = spec.parseView({ type: 'view', components: [samples.NEW_SAMPLES.math, samples.NEW_SAMPLES.code] })
    const lazy = render(h(body.default, { spec: v, renderMarkdown: md }))
    expect(lazy).toContain('animate-pulse') // the skeleton while the chunk loads
    const code = await import(path.join(views, 'ViewCode.tsx'))
    const out = render(h(code.default, { c: spec.parseComponent(samples.NEW_SAMPLES.code) }))
    expect(out).toContain('hljs-keyword')
    expect(out).toContain('Average: 79.0')
    expect(out).toContain('aria-label="Copy code"')
    expect(code.toLines([{ type: 'text', value: 'a\nb' }])).toEqual([[['', 'a']], [['', 'b']]])
  })

  test('the whole view lays every newer component out, with expand for wide ones', () => {
    const comps = NEW_TYPES.filter((t) => t !== 'math' && t !== 'code').map((t) => samples.NEW_SAMPLES[t])
    for (let i = 0; i < comps.length; i += 10) {
      const v = spec.parseView({ type: 'view', title: 'All', components: comps.slice(i, i + 10) })
      const out = render(h(body.default, { spec: v, renderMarkdown: md, onExpand: () => {} }))
      expect(out).not.toContain('could not be shown')
      expect(out).toContain('aria-label="Expand"')
    }
  })

  test('hostile-but-typed input is cleaned before it reaches a renderer', () => {
    const g = spec.parseComponent({ type: 'gauge', value: 1, min: 0, max: 2, bands: null, target: 'x' })
    expect(g.bands).toEqual([])
    expect(g.target).toBeUndefined()
    const out = render(h(body.default, { spec: spec.parseView({ type: 'view', components: [g] }), renderMarkdown: md }))
    expect(out).toContain('role="meter"')
    expect(out).not.toContain('could not be shown')
  })
})
