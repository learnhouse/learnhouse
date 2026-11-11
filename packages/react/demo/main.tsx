import React, { useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { LearnHouseActivity, LearnHouseProvider, SUPPORTED_LOCALES } from '../dist/index.js'
import type { BlockOverrideProps, LearnHouseEvent } from '../dist/index.js'
import '../dist/styles.css'
import allBlocks from '../tests/fixtures/all-blocks.json'

// Local LearnHouse API (the dev stack). Override with ?api=...&activity=...&course=...
const params = new URLSearchParams(location.search)
const API = params.get('api') ?? 'http://localhost:1338'
const LIVE_ACTIVITY = params.get('activity') ?? 'activity_05103e3e-ca3c-4d43-b916-b56d38aaf204'
const LIVE_COURSE = params.get('course') ?? 'course_b56430c1-301a-4d2d-856c-4dbca0b4df3c'

function BrandedCallout({ Default, ...props }: BlockOverrideProps) {
  return (
    <div style={{ outline: '2px dashed #7c3aed', outlineOffset: 4, borderRadius: 12 }}>
      <Default {...props} />
    </div>
  )
}

function App() {
  const [source, setSource] = useState<'json' | 'live' | 'name'>((params.get('source') as any) ?? 'json')
  const [locale, setLocale] = useState(params.get('locale') ?? 'en')
  const [dark, setDark] = useState(false)
  const [accent, setAccent] = useState('#7c3aed')
  const [width, setWidth] = useState('760')
  const [showTitle, setShowTitle] = useState(true)
  const [hideQuiz, setHideQuiz] = useState(false)
  const [override, setOverride] = useState(false)
  const [log, setLog] = useState<string[]>([])

  const onEvent = (e: LearnHouseEvent) =>
    setLog((l) => [`${e.type}${'action' in e ? `:${e.action}` : ''}${'href' in e ? ` ${e.href}` : ''}${'height' in e ? ` ${e.width}x${e.height}` : ''}`, ...l].slice(0, 40))

  const theme = useMemo(
    () => ({ mode: dark ? ('dark' as const) : ('light' as const), accent, contentWidth: Number(width) || 'none', background: dark ? '#09090b' : undefined }),
    [dark, accent, width],
  )

  const common = {
    theme,
    locale,
    showTitle,
    hideBlocks: hideQuiz ? ['blockQuiz'] : undefined,
    components: override ? { callout: BrandedCallout } : undefined,
    onEvent,
    trackCompletion: true,
    fallback: <p style={{ color: '#a1a1aa' }}>Loading…</p>,
  }

  return (
    <div className="shell">
      <aside>
        <div>
          <h1>&lt;LearnHouseActivity&gt;</h1>
          <small>@learnhouse/react, built from apps/web</small>
        </div>
        <label>
          Source
          <select value={source} onChange={(e) => setSource(e.target.value as any)}>
            <option value="json">JSON document (all blocks)</option>
            <option value="live">Live: by activity id</option>
            <option value="name">Live: by name in a course</option>
          </select>
        </label>
        <label>
          Locale
          <select value={locale} onChange={(e) => setLocale(e.target.value)}>
            {SUPPORTED_LOCALES.map((l) => (
              <option key={l}>{l}</option>
            ))}
          </select>
        </label>
        <label>
          Accent
          <input type="text" value={accent} onChange={(e) => setAccent(e.target.value)} />
        </label>
        <label>
          Content width (px, 0 = full)
          <input type="text" value={width} onChange={(e) => setWidth(e.target.value)} />
        </label>
        <label className="row"><input type="checkbox" checked={dark} onChange={(e) => setDark(e.target.checked)} /> Dark</label>
        <label className="row"><input type="checkbox" checked={showTitle} onChange={(e) => setShowTitle(e.target.checked)} /> Show title</label>
        <label className="row"><input type="checkbox" checked={hideQuiz} onChange={(e) => setHideQuiz(e.target.checked)} /> Hide quizzes</label>
        <label className="row"><input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} /> Wrap callouts (override)</label>
        <label>
          Events
          <div className="log">{log.join('\n')}</div>
        </label>
      </aside>
      <main>
        <div className="card" style={dark ? { background: '#09090b' } : undefined}>
          <LearnHouseProvider baseUrl={API}>
            {source === 'json' && <LearnHouseActivity key="json" content={allBlocks} {...common} />}
            {source === 'live' && <LearnHouseActivity key="live" activityId={LIVE_ACTIVITY} courseId={LIVE_COURSE} {...common} />}
            {source === 'name' && <LearnHouseActivity key="name" activityName="How payouts work" courseId={LIVE_COURSE} {...common} />}
          </LearnHouseProvider>
        </div>
      </main>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<App />)
