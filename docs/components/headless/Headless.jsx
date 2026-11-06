'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Copy, Check, GithubLogo, ArrowRight } from '@phosphor-icons/react/dist/ssr'
import { SECTION_ICONS } from './sections'
import catalog from './demos.json'
import '../developers/developers.css'
import './headless.css'

const DEMOS_REPO = 'https://github.com/learnhouse/headless-examples'

export { SECTION_ICONS }

/**
 * The LearnHouse Headless demo catalog: real screenshots of apps built on the
 * API (synced from headless-examples by scripts/sync-headless-demos.mjs).
 */
export function DemoGallery({ limit, filters = true }) {
  const [section, setSection] = useState('all')
  const all = useMemo(
    () => (section === 'all' ? catalog.demos : catalog.demos.filter((d) => d.section === section)),
    [section],
  )
  const demos = limit ? all.slice(0, limit) : all
  const note = catalog.sections.find((s) => s.id === section)?.note

  return (
    <div className="lhx-gallery">
      {filters && (
      <div className="lhx-filters" role="group" aria-label="Demo categories">
        {[{ id: 'all', title: `All ${catalog.demos.length}` }, ...catalog.sections].map((s) => {
          const Icon = SECTION_ICONS[s.id]
          return (
            <button
              key={s.id}
              type="button"
              aria-pressed={section === s.id}
              className={`lhx-filter ${section === s.id ? 'lhx-filter-active' : ''}`}
              onClick={() => setSection(s.id)}
            >
              {Icon && <Icon size={14} weight={section === s.id ? 'fill' : 'regular'} />}
              {s.title}
            </button>
          )
        })}
        <a href={DEMOS_REPO} target="_blank" rel="noopener noreferrer" className="lhx-source">
          <GithubLogo size={14} weight="fill" /> Source
        </a>
      </div>
      )}
      {filters && note && <p className="lhx-note">{note}</p>}
      <div className="lhx-grid">
        {demos.map((demo) => (
          <Link key={demo.id} href={`/demos/${demo.id}`} className="lhx-card lhd-card">
            <div className="lhx-shot">
              <img src={`/img/headless/thumbs/${demo.id}.webp`} alt={`${demo.name} demo`} loading="lazy" decoding="async" width="640" height="400" />
            </div>
            <span className="lhx-body">
              <span className="lhx-name">{demo.name}</span>
              <span className="lhx-blurb">{demo.blurb}</span>
              <span className="lhx-features">
                {demo.features.map((f) => (
                  <span key={f} className="lhx-feature">{f}</span>
                ))}
              </span>
            </span>
          </Link>
        ))}
      </div>
      {limit && all.length > limit && (
        <Link href="/demos" className="lhx-more">
          See all {catalog.demos.length} demos <ArrowRight size={13} weight="bold" />
        </Link>
      )}
    </div>
  )
}

/** A block of text with a copy button, for prompts and commands. */
export function CopyBlock({ label, children }) {
  const [copied, setCopied] = useState(false)
  const text = typeof children === 'string' ? children : String(children)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text.trim())
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      setCopied(false)
    }
  }
  return (
    <div className="lhx-copy lhd-card">
      <div className="lhx-copy-bar">
        <span className="lhd-label">{label}</span>
        <button type="button" onClick={copy} className="lhx-copy-btn">
          {copied ? <Check size={13} weight="bold" /> : <Copy size={13} weight="bold" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="lhx-copy-pre">{text.trim()}</pre>
    </div>
  )
}
