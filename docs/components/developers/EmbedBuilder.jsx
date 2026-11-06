'use client'

import { useMemo, useState } from 'react'
import './developers.css'

const strip = (value, prefix) => value.trim().replace(new RegExp(`^${prefix}`), '')

/**
 * Builds the same iframe the activity's Share → Embed menu copies, plus the
 * optional look parameters, so readers can try them before pasting.
 */
export default function EmbedBuilder() {
  const [site, setSite] = useState('https://learn.your-school.com')
  const [org, setOrg] = useState('your-school')
  const [course, setCourse] = useState('course_9f2a…')
  const [activity, setActivity] = useState('activity_0b3c…')
  const [height, setHeight] = useState('600')
  const [useBg, setUseBg] = useState(false)
  const [bg, setBg] = useState('#ffffff')
  const [useText, setUseText] = useState(false)
  const [text, setText] = useState('#09090b')
  const [logo, setLogo] = useState(true)
  const [copied, setCopied] = useState(false)

  const code = useMemo(() => {
    const params = new URLSearchParams()
    if (useBg) params.set('bgcolor', bg.replace('#', ''))
    if (useText) params.set('textcolor', text.replace('#', ''))
    if (!logo) params.set('showlearnhouselogo', 'false')
    const query = params.toString() ? `?${params}` : ''
    const base = site.trim().replace(/\/+$/, '')
    const src = `${base}/embed/${org.trim()}/course/${strip(course, 'course_')}/activity/${strip(activity, 'activity_')}${query}`
    return `<iframe\n  src="${src}"\n  width="100%"\n  height="${height || 600}"\n  frameborder="0"\n  allowfullscreen\n></iframe>`
  }, [site, org, course, activity, height, useBg, bg, useText, text, logo])

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
        <label>
          Height (px)
          <input type="text" value={height} onChange={(e) => setHeight(e.target.value.replace(/\D/g, ''))} />
        </label>
        <div className="lhd-row">
          <label className="lhd-check">
            <input type="checkbox" checked={useBg} onChange={(e) => setUseBg(e.target.checked)} /> Background
          </label>
          <span className="lhd-swatch">
            <input type="color" value={bg} disabled={!useBg} onChange={(e) => setBg(e.target.value)} aria-label="Background colour" />
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
