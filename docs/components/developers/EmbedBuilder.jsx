'use client'

import { useMemo, useState } from 'react'
import './developers.css'

const strip = (value, prefix) => value.trim().replace(new RegExp(`^${prefix}`), '')

// The UI languages LearnHouse ships (apps/web/locales).
const LANGUAGES = [
  ['en', 'English'], ['ar', 'Arabic'], ['bn', 'Bengali'], ['de', 'German'], ['es', 'Spanish'], ['fa', 'Persian'],
  ['fr', 'French'], ['hi', 'Hindi'], ['id', 'Indonesian'], ['it', 'Italian'], ['ja', 'Japanese'], ['ko', 'Korean'],
  ['nl', 'Dutch'], ['pl', 'Polish'], ['pt', 'Portuguese'], ['ru', 'Russian'], ['sk', 'Slovak'], ['th', 'Thai'],
  ['tr', 'Turkish'], ['uk', 'Ukrainian'], ['vi', 'Vietnamese'], ['zh', 'Chinese'],
]

/**
 * Builds the same code the activity's Share → Embed menu copies (the iframe and
 * the embed.js helper), plus the optional URL parameters, so readers can try
 * them before pasting.
 */
export default function EmbedBuilder() {
  const [site, setSite] = useState('https://learn.your-school.com')
  const [org, setOrg] = useState('your-school')
  const [course, setCourse] = useState('course_9f2a…')
  const [activity, setActivity] = useState('activity_0b3c…')
  const [height, setHeight] = useState('600')
  const [bgMode, setBgMode] = useState('default')
  const [bg, setBg] = useState('#ffffff')
  const [useText, setUseText] = useState(false)
  const [text, setText] = useState('#09090b')
  const [logo, setLogo] = useState(true)
  const [locale, setLocale] = useState('')
  const [autoResize, setAutoResize] = useState(true)
  const [copied, setCopied] = useState(false)

  const code = useMemo(() => {
    const params = new URLSearchParams()
    if (bgMode === 'color') params.set('bgcolor', bg.replace('#', ''))
    if (bgMode === 'transparent') params.set('bgcolor', 'transparent')
    if (useText) params.set('textcolor', text.replace('#', ''))
    if (!logo) params.set('showlearnhouselogo', 'false')
    if (locale) params.set('locale', locale)
    const query = params.toString() ? `?${params}` : ''
    const base = site.trim().replace(/\/+$/, '')
    const src = `${base}/embed/${org.trim()}/course/${strip(course, 'course_')}/activity/${strip(activity, 'activity_')}${query}`
    const iframe = `<iframe\n  src="${src}"\n  width="100%"\n  height="${height || 600}"\n  style="border:0"\n  allow="fullscreen; autoplay"\n  allowfullscreen${autoResize ? '\n  data-learnhouse-embed' : ''}\n></iframe>`
    return autoResize ? `${iframe}\n<script src="${base}/embed.js" async></script>` : iframe
  }, [site, org, course, activity, height, bgMode, bg, useText, text, logo, locale, autoResize])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className="lhd-builder lhd-card">
      <div className="lhd-builder-fields">
        <label>
          LearnHouse site
          <input type="text" value={site} onChange={(e) => setSite(e.target.value)} />
        </label>
        <label>
          Org slug
          <input type="text" value={org} onChange={(e) => setOrg(e.target.value)} />
        </label>
        <div className="lhd-row">
          <label>
            Course
            <input type="text" value={course} onChange={(e) => setCourse(e.target.value)} />
          </label>
          <label>
            Activity
            <input type="text" value={activity} onChange={(e) => setActivity(e.target.value)} />
          </label>
        </div>
        <div className="lhd-row">
          <label>
            {autoResize ? 'Starting height (px)' : 'Height (px)'}
            <input type="text" value={height} onChange={(e) => setHeight(e.target.value.replace(/\D/g, ''))} />
          </label>
          <label>
            Language
            <select value={locale} onChange={(e) => setLocale(e.target.value)}>
              <option value="">Organization default</option>
              {LANGUAGES.map(([code, name]) => (
                <option key={code} value={code}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="lhd-row">
          <label>
            Background
            <select value={bgMode} onChange={(e) => setBgMode(e.target.value)}>
              <option value="default">Default</option>
              <option value="color">Colour</option>
              <option value="transparent">Transparent</option>
            </select>
          </label>
          <span className="lhd-swatch">
            <input type="color" value={bg} disabled={bgMode !== 'color'} onChange={(e) => setBg(e.target.value)} aria-label="Background colour" />
          </span>
        </div>
        <div className="lhd-row">
          <label className="lhd-check">
            <input type="checkbox" checked={useText} onChange={(e) => setUseText(e.target.checked)} /> Text colour
          </label>
          <span className="lhd-swatch">
            <input type="color" value={text} disabled={!useText} onChange={(e) => setText(e.target.value)} aria-label="Text colour" />
          </span>
        </div>
        <label className="lhd-check">
          <input type="checkbox" checked={logo} onChange={(e) => setLogo(e.target.checked)} /> Show the LearnHouse badge
        </label>
        <label className="lhd-check">
          <input type="checkbox" checked={autoResize} onChange={(e) => setAutoResize(e.target.checked)} /> Fit the height to the content
        </label>
      </div>
      <div className="lhd-builder-out">
        <pre>
          <code>{code}</code>
        </pre>
        <button type="button" onClick={copy}>
          {copied ? 'Copied' : 'Copy embed code'}
        </button>
      </div>
    </div>
  )
}
